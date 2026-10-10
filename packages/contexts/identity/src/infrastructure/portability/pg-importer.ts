import { createHash } from 'node:crypto';
import { requireSqlExecutor } from '@pf/platform/api';
import { DomainError, type PortabilitySection } from '@pf/shared-kernel';
import type { ImportOutcome, WorkspaceImporter } from '../../application/portability/ports.js';
import { compareVerification, type ExportManifest } from '../../domain/export-manifest.js';
import { IdRemap, isUuid, type RandomBytes } from '../../domain/id-remap.js';
import { LocaleTag } from '../../domain/locale-tag.js';
import { inspectArchive, RecordValidators } from './archive-inspector.js';
import {
  computeVerification,
  idColumnsOf,
  insertColumns,
  loadColumns,
  quoteIdent,
  quoteTable,
  type ColumnInfo,
  type SqlExec,
} from './section-sql.js';
import { ZipFormatError, type ZipReader } from './zip.js';

type Row = Record<string, unknown>;

/** Filas ya remapeadas de otra sección, para ganchos que dependen de ellas (p. ej. el hash de un snapshot de cierre). */
export interface ImportHookContext {
  readonly section: PortabilitySection;
  /** Filas del lote, con ids ya remapeados y listas para insertarse; el gancho puede modificarlas. */
  readonly rows: Row[];
  /** Todas las filas (remapeadas) de otra sección del archivo. */
  related(sectionName: string): Row[];
}
export type ImportHook = (ctx: ImportHookContext) => void;

export interface PgImporterOptions {
  readonly sections: readonly PortabilitySection[];
  readonly hooks: Readonly<Record<string, ImportHook>>;
  /** Directorio de `contracts/export/v1` (esquemas JSON de los registros). */
  readonly schemaDir: string;
  readonly random: RandomBytes;
  readonly nowMillis?: () => number;
  /** `statement_timeout` de la transacción de importación (la única transacción larga del producto, D100). */
  readonly statementTimeout?: string;
  /** Locale de respaldo (`APP_DEFAULT_LOCALE`) para un locale del archivo que la aplicación no soporta (por defecto `es-BO`). */
  readonly defaultLocale?: string;
}

const BATCH_ROWS = 500;
const isIntegrityError = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (/^(22|23)/u.test(code) || /^PF/u.test(code) || code === 'P0001');
};

function* lines(buffer: Buffer): Generator<string> {
  let start = 0;
  for (;;) {
    const end = buffer.indexOf(0x0a, start);
    if (end < 0) {
      if (start < buffer.length) yield buffer.toString('utf8', start);
      return;
    }
    if (end > start) yield buffer.toString('utf8', start, end);
    start = end + 1;
  }
}

/** Reordena filas con referencias a su propia tabla: los padres antes que los hijos (estable respecto al archivo). */
export function sortByParents(rows: readonly Row[], idColumn: string, refs: readonly string[]): Row[] {
  const byId = new Map(rows.map((r) => [String(r[idColumn]), r]));
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const out: Row[] = [];
  const visit = (row: Row): void => {
    const id = String(row[idColumn]);
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const ref of refs) {
      const parent = row[ref] === null || row[ref] === undefined ? undefined : byId.get(String(row[ref]));
      if (parent) visit(parent);
    }
    visiting.delete(id);
    placed.add(id);
    out.push(row);
  };
  for (const row of rows) visit(row);
  return out;
}

/**
 * Importador de un `pfos-export` v1 a un workspace NUEVO (openspec add-workspace-export, design decisiones 8-13, D99-D101).
 * Se ejecuta dentro de la unidad de trabajo del llamador (UNA transacción):
 *   0. Validación previa (sin escribir): ZIP, manifiesto, SHA-256 por archivo, cada registro contra su esquema, conteos
 *      y siembra del mapa de ids. Fallo ⇒ `EXPORT_FILE_CORRUPTED`.
 *   1. Crea el workspace `RESTORING` con el importador como único OWNER (nunca escribe en uno existente).
 *   2. Inserta la historia TAL CUAL (asientos, postings, reversas, revisiones, auditoría, snapshots) con ids nuevos —sin
 *      re-ejecutar comandos ni emitir eventos de negocio— en el orden de las secciones; el workspace de las filas siempre
 *      es el nuevo, jamás el del archivo.
 *   3. Verifica contra el manifiesto (saldos por cuenta, balance de comprobación, conteos) y pasa a `ACTIVE`.
 * Cualquier fallo lanza y la transacción hace rollback completo: no queda ninguna fila.
 */
export class PgWorkspaceImporter implements WorkspaceImporter {
  private readonly sections: readonly PortabilitySection[];
  private readonly validators: RecordValidators;
  private readonly names: ReadonlySet<string>;

  constructor(private readonly options: PgImporterOptions) {
    this.sections = [...options.sections].sort((a, b) => a.order - b.order);
    this.names = new Set(this.sections.map((s) => s.name));
    this.validators = new RecordValidators(options.schemaDir);
  }

  async importInto(input: Parameters<WorkspaceImporter['importInto']>[0]): Promise<ImportOutcome> {
    const { zip, userId, importId, newWorkspaceId, name } = input;
    const { manifest, reader } = inspectArchive(zip, this.names);
    const exec = requireSqlExecutor() as unknown as SqlExec;
    const remap = new IdRemap(this.options.random, this.options.nowMillis ?? (() => Date.now()));

    // ── 0. validación y siembra del mapa de ids (sin escribir) ──
    const columnsOf = new Map<string, readonly ColumnInfo[]>();
    for (const s of this.sections)
      columnsOf.set(s.name, await loadColumns(exec, s.table, this.options.random));
    const present = this.sections.filter((s) => manifest.sections.some((m) => m.name === s.name));
    let workspaceRow: Row | undefined;
    for (const s of present) {
      const declared = manifest.sections.find((m) => m.name === s.name) as ExportManifest['sections'][number];
      const idCols = idColumnsOf(s, columnsOf.get(s.name) as readonly ColumnInfo[]);
      let count = 0;
      for (const line of lines(this.read(reader, declared.file))) {
        let row: Row;
        try {
          row = JSON.parse(line) as Row;
        } catch {
          throw new DomainError('EXPORT_FILE_CORRUPTED', `export file: unreadable record in ${s.name}`);
        }
        const problem = this.validators.check(s.name, row);
        if (problem)
          throw new DomainError(
            'EXPORT_FILE_CORRUPTED',
            `export file: ${s.name} record invalid (${problem})`,
          );
        count += 1;
        if (s.name === 'workspace') workspaceRow = row;
        else {
          for (const c of idCols) {
            const id = row[c];
            if (isUuid(id)) remap.assign(id);
          }
        }
      }
      if (count !== declared.count) {
        throw new DomainError(
          'EXPORT_FILE_CORRUPTED',
          `export file: ${s.name} count does not match the manifest`,
        );
      }
    }
    if (!workspaceRow)
      throw new DomainError('EXPORT_FILE_CORRUPTED', 'export file: missing workspace section');
    remap.set(manifest.workspaceId, newWorkspaceId);

    // ── 1. workspace nuevo ──
    await exec.query(`SET LOCAL statement_timeout = '${this.options.statementTimeout ?? '30min'}'`);
    await exec.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      userId,
      newWorkspaceId,
    ]);
    await this.createWorkspace(exec, { newWorkspaceId, name, userId, importId, manifest, row: workspaceRow });

    // ── 2. historia ──
    const counts: Record<string, number> = { workspace: 1 };
    const relatedCache = new Map<string, Row[]>();
    const related = (sectionName: string): Row[] => {
      let cached = relatedCache.get(sectionName);
      if (!cached) {
        const s = this.sections.find((x) => x.name === sectionName);
        const declared = manifest.sections.find((m) => m.name === sectionName);
        cached =
          s && declared
            ? this.loadRemapped(reader, s, declared.file, columnsOf, remap, newWorkspaceId, userId)
            : [];
        relatedCache.set(sectionName, cached);
      }
      return cached;
    };
    input.onStep('IMPORTING');
    for (const s of present) {
      if (s.name === 'workspace') continue;
      const declared = manifest.sections.find((m) => m.name === s.name) as ExportManifest['sections'][number];
      let rows = this.loadRemapped(reader, s, declared.file, columnsOf, remap, newWorkspaceId, userId);
      if (s.selfRefs?.length)
        rows = sortByParents(
          rows,
          idColumnsOf(s, columnsOf.get(s.name) as readonly ColumnInfo[])[0] ?? 'id',
          s.selfRefs,
        );
      const hook = s.importHook ? this.options.hooks[s.importHook] : undefined;
      if (s.importHook && !hook) throw new Error(`gancho de importación no registrado: ${s.importHook}`);
      const cols = insertColumns(s, columnsOf.get(s.name) as readonly ColumnInfo[]);
      for (let i = 0; i < rows.length; i += BATCH_ROWS) {
        const batch = rows.slice(i, i + BATCH_ROWS);
        hook?.({ section: s, rows: batch, related });
        await this.insertBatch(exec, s, cols, batch);
      }
      counts[s.name] = rows.length;
      relatedCache.delete(s.name);
    }

    // ── 3. verificación contra el manifiesto ──
    input.onStep('VERIFYING');
    try {
      await exec.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (err) {
      if (isIntegrityError(err)) {
        throw new DomainError(
          'EXPORT_VERIFICATION_FAILED',
          'the imported data violates a ledger or transaction invariant',
        );
      }
      throw err;
    }
    const actual = await computeVerification(exec, newWorkspaceId);
    const expected = {
      accountBalances: manifest.verification.accountBalances.map((l) => ({
        ...l,
        accountId: remap.get(l.accountId) ?? l.accountId,
      })),
      trialBalance: manifest.verification.trialBalance.map((l) => ({
        ...l,
        ledgerAccountId: remap.get(l.ledgerAccountId) ?? l.ledgerAccountId,
      })),
    };
    const mismatches = compareVerification(expected, actual);
    if (mismatches.length > 0) {
      // Sin cifras ni nombres en el error: solo la cantidad y el tipo de diferencias.
      throw new DomainError(
        'EXPORT_VERIFICATION_FAILED',
        `balances do not match the manifest (${mismatches.length} difference(s): ${[...new Set(mismatches.map((m) => m.kind))].join(', ')})`,
      );
    }
    for (const s of present) {
      if (s.name === 'workspace') continue;
      const expectedCount = counts[s.name] ?? 0;
      const wsCol = quoteIdent(s.workspaceColumn ?? 'workspace_id');
      const { rows } = await exec.query(
        `SELECT count(*)::int AS n FROM ${quoteTable(s.table)} WHERE ${wsCol} = $1`,
        [newWorkspaceId],
      );
      if ((rows[0] as { n: number }).n !== expectedCount) {
        throw new DomainError(
          'EXPORT_VERIFICATION_FAILED',
          `row count of ${s.name} does not match the import`,
        );
      }
    }
    await exec.query(
      `UPDATE iam.workspace SET status = 'ACTIVE', version = version + 1, updated_at = now() WHERE id = $1`,
      [newWorkspaceId],
    );
    return {
      workspaceId: newWorkspaceId,
      workspaceName: name,
      report: {
        counts,
        idMapSize: remap.size,
        // Huella del mapa viejo→nuevo para trazabilidad (el mapa completo no se guarda: es del orden del volumen de datos).
        idMapFingerprint: fingerprint(remap),
        verified: {
          accounts: expected.accountBalances.length,
          ledgerAccounts: expected.trialBalance.length,
        },
      },
    };
  }

  // ------------------------------------------------------------------ helpers

  private read(reader: ZipReader, file: string): Buffer {
    try {
      return reader.read(file);
    } catch (err) {
      if (err instanceof ZipFormatError)
        throw new DomainError('EXPORT_FILE_CORRUPTED', `export file: ${err.message}`);
      throw err;
    }
  }

  /** Filas de una sección con ids remapeados, el workspace nuevo y solo lo que corresponde al importador. */
  private loadRemapped(
    reader: ZipReader,
    s: PortabilitySection,
    file: string,
    columnsOf: ReadonlyMap<string, readonly ColumnInfo[]>,
    remap: IdRemap,
    newWorkspaceId: string,
    userId: string,
  ): Row[] {
    const cols = insertColumns(s, columnsOf.get(s.name) as readonly ColumnInfo[]);
    const wsCol = s.workspaceColumn ?? 'workspace_id';
    const textRefs = new Set(s.textRefs ?? []);
    const out: Row[] = [];
    for (const line of lines(this.read(reader, file))) {
      const row = JSON.parse(line) as Row;
      if (s.importerColumn && row[s.importerColumn] !== userId) continue;
      const next: Row = {};
      for (const c of cols) {
        const v = row[c.name];
        if (c.name === wsCol) next[c.name] = newWorkspaceId;
        else if (v === null || v === undefined) next[c.name] = null;
        else if (c.kind === 'uuid') next[c.name] = typeof v === 'string' ? (remap.get(v) ?? v) : v;
        else if (c.kind === 'uuid[]') next[c.name] = (v as string[]).map((x) => remap.get(x) ?? x);
        else if (c.kind === 'jsonb') next[c.name] = remap.replaceDeep(v);
        // bytea viaja en base64 (formato del export); `jsonb_populate_recordset` lo lee en el formato hexadecimal de
        // PostgreSQL. add-basic-csv-import es la primera sección que exporta hashes binarios (checksum y huellas).
        else if (c.kind === 'bytea') next[c.name] = `\\x${Buffer.from(String(v), 'base64').toString('hex')}`;
        else if (c.kind === 'text' && textRefs.has(c.name)) next[c.name] = remap.replaceText(String(v));
        else next[c.name] = v;
      }
      out.push(next);
    }
    return out;
  }

  private async insertBatch(
    exec: SqlExec,
    s: PortabilitySection,
    cols: readonly ColumnInfo[],
    batch: readonly Row[],
  ): Promise<void> {
    const list = cols.map((c) => quoteIdent(c.name)).join(', ');
    const select = cols.map((c) => `r.${quoteIdent(c.name)}`).join(', ');
    const table = quoteTable(s.table);
    try {
      await exec.query(
        `INSERT INTO ${table} (${list})
         SELECT ${select} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) WITH ORDINALITY AS r
          ORDER BY r.ordinality`,
        [JSON.stringify(batch)],
      );
    } catch (err) {
      if (isIntegrityError(err)) {
        // Sin el valor ofensivo: solo la sección y la clase del error.
        throw new DomainError(
          'EXPORT_FILE_CORRUPTED',
          `export file: ${s.name} violates an integrity rule (${(err as { code: string }).code})`,
        );
      }
      throw err;
    }
  }

  private async createWorkspace(
    exec: SqlExec,
    input: {
      newWorkspaceId: string;
      name: string;
      userId: string;
      importId: string;
      manifest: ExportManifest;
      row: Row;
    },
  ): Promise<void> {
    const { row } = input;
    try {
      await exec.query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day,
                                    min_liquidity_reserve_amount, min_liquidity_reserve_currency, status,
                                    restored_from_export)
         VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, 'RESTORING', $9::jsonb)`,
        [
          input.newWorkspaceId,
          input.name,
          row['base_currency'],
          row['time_zone'],
          LocaleTag.fromStored(String(row['locale']), this.options.defaultLocale ?? 'es-BO').value,
          row['fiscal_month_start_day'],
          row['min_liquidity_reserve_amount'] ?? null,
          row['min_liquidity_reserve_currency'] ?? null,
          JSON.stringify({
            sourceWorkspaceId: input.manifest.workspaceId,
            exportedAt: input.manifest.exportedAt,
            importId: input.importId,
          }),
        ],
      );
    } catch (err) {
      if (isIntegrityError(err)) {
        throw new DomainError('EXPORT_FILE_CORRUPTED', 'export file: the workspace settings are not valid');
      }
      throw err;
    }
    await exec.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
      [input.newWorkspaceId, input.userId],
    );
  }
}

function fingerprint(remap: IdRemap): string {
  const hash = createHash('sha256');
  const pairs = [...remap.entries()].map(([a, b]) => `${a}>${b}`).sort();
  for (const p of pairs) hash.update(p);
  return hash.digest('hex');
}
