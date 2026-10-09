import { createHash } from 'node:crypto';
import type { PortabilitySection } from '@pf/shared-kernel';
import type { Pool, PoolClient } from 'pg';
import type { BuiltArchive, ExportArchiveBuilder } from '../../application/portability/ports.js';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MANIFEST_FILE,
  serializeExportManifest,
  type ExportManifest,
  type ManifestCsv,
  type ManifestSection,
} from '../../domain/export-manifest.js';
import { CsvWriter } from './csv.js';
import { exportSchemaId } from './json-schema.js';
import {
  buildSectionQuery,
  computeVerification,
  loadColumns,
  moneyText,
  type SqlExec,
} from './section-sql.js';
import { ZipWriter } from './zip.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FETCH_ROWS = 2000;
const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export interface PgArchiveBuilderOptions {
  /** Pool con el rol del worker (`pf_worker`; hereda los grants y las políticas de `pf_app`). */
  readonly pool: Pool;
  /** Secciones de todos los contextos (la raíz de composición las agrega y ordena). */
  readonly sections: readonly PortabilitySection[];
  readonly pfosVersion: string;
  /**
   * Gancho de pruebas (TC-IDENTITY-EXPORT-004): se invoca DESPUÉS de tomar la instantánea y ANTES de leer ninguna
   * sección, para que un test confirme escrituras concurrentes que NO deben aparecer en el archivo.
   */
  readonly afterSnapshot?: () => Promise<void>;
}

/**
 * Constructor del archivo `pfos-export` v1 (openspec add-workspace-export, design decisiones 2-3): UNA transacción
 * `READ ONLY, ISOLATION LEVEL REPEATABLE READ` con el contexto RLS del solicitante lee todas las secciones del
 * `PortabilityRegistry` (misma instantánea), calcula saldos por cuenta y balance de comprobación, escribe `json/*.jsonl`,
 * `csv/*.csv` y `manifest.json` con la suma SHA-256 de cada archivo, y devuelve el ZIP en memoria (nunca toca disco: los
 * contenedores son de solo lectura). El ZIP se cifra aguas abajo; aquí es texto claro.
 */
export class PgExportArchiveBuilder implements ExportArchiveBuilder {
  private readonly sections: readonly PortabilitySection[];

  constructor(private readonly options: PgArchiveBuilderOptions) {
    this.sections = [...options.sections].sort((a, b) => a.order - b.order);
  }

  async build(input: Parameters<ExportArchiveBuilder['build']>[0]): Promise<BuiltArchive> {
    const { workspaceId, requestedBy, exportedAt, onProgress } = input;
    if (!UUID.test(workspaceId) || !UUID.test(requestedBy)) throw new Error('identificador inválido');
    const client = await this.options.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // La primera sentencia fija la instantánea; el contexto RLS del solicitante la acompaña.
      const first = await client.query<{ at: Date }>(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true),
                to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
        [requestedBy, workspaceId],
      );
      const snapshotAt = String((first.rows[0] as unknown as { at: string }).at);
      await this.options.afterSnapshot?.();
      return await this.buildFrom(client, {
        workspaceId,
        exportedAt: exportedAt.toString(),
        snapshotAt,
        onProgress,
      });
    } catch (err) {
      broken = true;
      throw err;
    } finally {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      client.release(broken);
    }
  }

  private async buildFrom(
    client: PoolClient,
    ctx: {
      readonly workspaceId: string;
      readonly exportedAt: string;
      readonly snapshotAt: string;
      readonly onProgress: ((pct: number) => Promise<void>) | undefined;
    },
  ): Promise<BuiltArchive> {
    const { workspaceId } = ctx;
    const zip = new ZipWriter(new Date(ctx.exportedAt));
    const sections: ManifestSection[] = [];
    const counts: Record<string, number> = {};
    const cacheKey = this.options.pool;
    const total = this.sections.length + 3;
    let done = 0;
    let workspace: { name: string; baseCurrency: string; timezone: string } | undefined;
    for (const section of this.sections) {
      const columns = await loadColumns(client, section.table, cacheKey);
      const query = buildSectionQuery(section, columns, `'${workspaceId}'::uuid`);
      const lines: string[] = [];
      await client.query(`DECLARE pfx_cur NO SCROLL CURSOR FOR ${query}`);
      for (;;) {
        const batch = await client.query(`FETCH FORWARD ${FETCH_ROWS} FROM pfx_cur`);
        if (batch.rows.length === 0) break;
        for (const row of batch.rows as Record<string, unknown>[]) {
          lines.push(JSON.stringify(row));
          if (section.name === 'workspace') {
            workspace = {
              name: String(row['name']),
              baseCurrency: String(row['base_currency']),
              timezone: String(row['time_zone']),
            };
          }
        }
      }
      await client.query('CLOSE pfx_cur');
      const body = Buffer.from(lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
      const file = `json/${section.name}.jsonl`;
      zip.add(file, body);
      sections.push({
        name: section.name,
        file,
        schema: exportSchemaId(section.name),
        count: lines.length,
        sha256: sha256Hex(body),
      });
      counts[section.name] = lines.length;
      done += 1;
      await ctx.onProgress?.((done / total) * 100);
    }
    if (!workspace) throw new Error('el workspace no es visible para el solicitante');

    const verification = await computeVerification(client as SqlExec, workspaceId);
    const csv: ManifestCsv[] = [];
    const transactionsCsv = await this.transactionsCsv(client, workspaceId);
    zip.add('csv/transactions.csv', transactionsCsv.body);
    csv.push({
      name: 'transactions',
      file: 'csv/transactions.csv',
      count: transactionsCsv.rows,
      sha256: sha256Hex(transactionsCsv.body),
    });
    const balancesCsv = await this.balancesCsv(client, workspaceId);
    zip.add('csv/account-balances.csv', balancesCsv.body);
    csv.push({
      name: 'account-balances',
      file: 'csv/account-balances.csv',
      count: balancesCsv.rows,
      sha256: sha256Hex(balancesCsv.body),
    });
    done += 2;
    await ctx.onProgress?.((done / total) * 100);

    // Nombres de los miembros (los usuarios no viajan: el manifiesto resuelve a quién pertenecen los ids de actor).
    const actors = await this.actors(client, workspaceId);
    const manifest: ExportManifest = {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      workspaceId,
      workspaceName: workspace.name,
      isDemo: await this.isDemo(client, workspaceId),
      exportedAt: ctx.exportedAt,
      snapshotAt: ctx.snapshotAt,
      pfosVersion: this.options.pfosVersion,
      baseCurrency: workspace.baseCurrency,
      timezone: workspace.timezone,
      sections,
      csv,
      verification,
      actors,
    };
    zip.add(MANIFEST_FILE, Buffer.from(serializeExportManifest(manifest), 'utf8'));
    return { zip: zip.finish(), manifest, counts };
  }

  /** ¿Es un workspace demo? (los exports demo llevan `isDemo: true` y no se pueden importar, D99). */
  private async isDemo(client: PoolClient, workspaceId: string): Promise<boolean> {
    const r = await client.query(`SELECT is_demo FROM iam.workspace WHERE id = $1`, [workspaceId]);
    return (r.rows[0] as { is_demo: boolean } | undefined)?.is_demo === true;
  }

  private async actors(
    client: PoolClient,
    workspaceId: string,
  ): Promise<{ userId: string; displayName: string }[]> {
    await client.query('SET LOCAL ROLE pf_workspace_directory');
    try {
      const r = await client.query(
        `SELECT u.id AS user_id, u.display_name
           FROM iam."user" u
          WHERE u.id IN (SELECT m.user_id FROM iam.workspace_membership m WHERE m.workspace_id = $1)
          ORDER BY u.id`,
        [workspaceId],
      );
      return (r.rows as { user_id: string; display_name: string }[]).map((x) => ({
        userId: x.user_id,
        displayName: x.display_name,
      }));
    } finally {
      await client.query('RESET ROLE');
    }
  }

  /**
   * Vista plana: una fila por split de la revisión vigente (`parte = split`) y una fila de la propia transacción
   * (`parte = transaccion`) cuando no tiene splits o es una transferencia/conversión (su monto principal no es un split).
   */
  private async transactionsCsv(
    client: PoolClient,
    workspaceId: string,
  ): Promise<{ body: Buffer; rows: number }> {
    const w = `'${workspaceId}'::uuid`;
    const amount = (value: string, ccy: string) => moneyText(value, ccy);
    const cols = [
      'transaction_id',
      'parte',
      'fecha',
      'tipo',
      'estado',
      'cuenta',
      'descripcion',
      'contraparte',
      'categoria',
      'etiquetas',
      'monto',
      'moneda',
      'memo',
      'campos_personalizados',
    ];
    const r = await client.query(
      `SELECT t.id AS transaction_id, 'split' AS parte, t.transaction_date::text AS fecha, t.kind AS tipo, t.status AS estado,
              a.name AS cuenta, t.description AS descripcion,
              cp.name AS contraparte, c.name AS categoria,
              (SELECT string_agg(tg.name, '; ' ORDER BY tg.name) FROM txn.split_tag st
                 JOIN classification.tag tg ON tg.id = st.tag_id WHERE st.split_id = s.id) AS etiquetas,
              ${amount('s.amount', 's.currency')} AS monto, s.currency AS moneda, s.memo AS memo,
              (SELECT string_agg(d.key || '=' || coalesce(v.value_text, v.value_number::text, v.value_date::text, v.value_bool::text, ''), '; ' ORDER BY d.key)
                 FROM txn.split_custom_field_value v JOIN classification.custom_field_definition d ON d.id = v.field_id
                WHERE v.split_id = s.id) AS campos_personalizados
         FROM txn.transaction t
         JOIN accounts.account a ON a.id = t.account_id
         JOIN txn.transaction_split s ON s.transaction_id = t.id AND s.revision = t.revision AND s.superseded_in_revision IS NULL
         LEFT JOIN classification.category c ON c.id = s.category_id
         LEFT JOIN classification.counterparty cp ON cp.id = coalesce(s.counterparty_id, t.counterparty_id)
        WHERE t.workspace_id = ${w}
       UNION ALL
       SELECT t.id, 'transaccion', t.transaction_date::text, t.kind, t.status, a.name, t.description, cp.name, NULL, NULL,
              ${amount('t.amount', 't.currency')}, t.currency, NULL, NULL
         FROM txn.transaction t
         JOIN accounts.account a ON a.id = t.account_id
         LEFT JOIN classification.counterparty cp ON cp.id = t.counterparty_id
        WHERE t.workspace_id = ${w}
          AND (t.kind IN ('TRANSFER', 'CONVERSION')
               OR NOT EXISTS (SELECT 1 FROM txn.transaction_split s WHERE s.transaction_id = t.id AND s.revision = t.revision AND s.superseded_in_revision IS NULL))
        ORDER BY fecha, transaction_id, parte`,
    );
    const csv = new CsvWriter(cols);
    for (const row of r.rows as Record<string, string | null>[]) {
      csv.row(cols.map((c) => (c === 'monto' ? { n: row[c] ?? null } : (row[c] ?? null))));
    }
    return { body: csv.toBuffer(), rows: r.rows.length };
  }

  private async balancesCsv(
    client: PoolClient,
    workspaceId: string,
  ): Promise<{ body: Buffer; rows: number }> {
    const r = await client.query(
      `SELECT a.id AS account_id, a.name AS nombre, s.currency AS moneda, s.balance AS saldo
         FROM accounts.account a
         JOIN (SELECT la.source_account_id AS account_id, p.currency,
                      ${moneyText('SUM(p.amount)', 'p.currency')} AS balance
                 FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
                WHERE p.workspace_id = '${workspaceId}'::uuid AND la.source_account_id IS NOT NULL
                GROUP BY la.source_account_id, p.currency) s ON s.account_id = a.id
        WHERE a.workspace_id = '${workspaceId}'::uuid
        ORDER BY a.name, s.currency, a.id`,
    );
    const csv = new CsvWriter(['account_id', 'nombre', 'moneda', 'saldo']);
    for (const row of r.rows as Record<string, string>[]) {
      csv.row([
        row['account_id'] as string,
        row['nombre'] as string,
        row['moneda'] as string,
        { n: row['saldo'] as string },
      ]);
    }
    return { body: csv.toBuffer(), rows: r.rows.length };
  }
}
