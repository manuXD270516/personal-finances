import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, dec } from '@pf/shared-kernel';
import { IMPORTS_EVENTS } from '../contracts/index.js';
import {
  matchProfile,
  resolveMapping,
  TABULAR_FORMATS,
  type ImportFailure,
  type ImportJob,
  type ImportJobState,
  type ImportRulesSummary,
  type ImportStage,
  type ImportStatementInfo,
  type MappingHelp,
  type ProfileMapping,
  type ImportPdfInfo,
  type StatementBalance,
  type StatementFormat,
  type StatementRecord,
} from '../domain/index.js';
import { publishJobEvent, recordJob, SYSTEM_ACTOR } from './job-recorder.js';
import type { PdfStatementReader } from './pdf/pdf-statement-reader.js';
import type { ImportsDeps, StagedInsert, StoredProfileVersion } from './ports/index.js';
import { countersOf } from './row-pipeline.js';
import { runStatementPipeline, type StageName } from './statement-pipeline.js';

/** Filas por bloque de lectura y de escritura (decisión 3: etapas por bloques de 1 000 con punto de control). */
export const IMPORT_BLOCK = 1000;

export type ProcessOutcome =
  'SKIPPED' | 'AWAITING_MAPPING' | 'AWAITING_REVIEW' | 'PARSE_FAILED' | 'CANCELLED';

/** El usuario canceló (o el job cambió de estado) mientras el worker procesaba: se detiene antes de la etapa siguiente. */
class Stopped extends Error {
  constructor() {
    super('import is no longer PROCESSING');
  }
}

/** Los primeros bytes son la firma de un PDF (la detección real y la inspección son de DOCUMENTS). */
const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

const toStatementInfo = (s: StatementBalance | null): ImportStatementInfo | null =>
  s === null
    ? null
    : {
        openingBalance: s.openingBalance,
        closingBalance: s.closingBalance,
        closingDate: s.closingDate,
        periodFrom: s.periodFrom,
        periodTo: s.periodTo,
      };

/**
 * `ProcessImport` (openspec add-import-pipeline, decisiones 3, 4, 5, 6, 8, 13 y 17; consumidor `imports.persist`, sin
 * consumidores nuevos D249): lee el documento de una importación `UPLOADED` y recorre las etapas lectura (PARSE) →
 * normalización → validación → clasificación → duplicados → coincidencias hasta `AWAITING_REVIEW`.
 *
 * Reanudable: la lectura inserta el staging en bloques de 1 000 con `ON CONFLICT DO NOTHING` y deja un punto de
 * control por bloque; una reentrega del evento retoma desde `progress.stage` sin duplicar filas, y las etapas
 * siguientes recalculan todo de forma determinista desde el staging. Cancelar marca el job y el worker lo verifica
 * entre bloques y etapas. Un error estructural o un límite excedido deja `PARSE_FAILED` sin filas. Los errores
 * transitorios (BD, red) se propagan: el consumidor reintenta con backoff.
 */
export class ProcessImportService {
  constructor(private readonly deps: ImportsDeps) {}

  async process(input: { readonly workspaceId: string; readonly importId: string }): Promise<ProcessOutcome> {
    const { deps } = this;
    const { workspaceId, importId } = input;

    const started = await deps.uow.runDetached(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, importId, { lock: 'update' });
      if (!job || !job.isDocumentJob) return null;
      if (job.state.status === 'UPLOADED') {
        job.beginProcessing(deps.clock.now().toString());
        await this.save(job);
        await recordJob(deps, job, 'processing_started', {
          actor: SYSTEM_ACTOR,
          changes: [{ field: 'status', before: 'UPLOADED', after: 'PROCESSING' }],
        });
      } else if (job.state.status !== 'PROCESSING') {
        return null;
      }
      return job.state;
    });
    if (!started) return 'SKIPPED';

    const deadline = deps.clock.now().epochMillis + deps.settings.processingTimeoutMs;
    try {
      if ((started.progress.stage ?? 'PARSE') === 'PARSE') {
        const read = await this.readStage(started, deadline);
        if (read !== 'CONTINUE') return read;
      }
      return await this.enrichStage(started, deadline);
    } catch (err) {
      if (err instanceof Stopped) return 'CANCELLED';
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────── lectura (PARSE)

  private async readStage(
    state: ImportJobState,
    deadline: number,
  ): Promise<'CONTINUE' | 'AWAITING_MAPPING' | 'PARSE_FAILED' | 'CANCELLED'> {
    const { deps } = this;
    const { workspaceId } = state;
    const documentId = state.documentId as string;

    const account = await deps.uow.run(workspaceId, () =>
      deps.accounts.getAccount(workspaceId, state.accountId),
    );
    if (!account) return this.fail(state, { code: 'IMPORT_PARSE_FAILED', pointer: 'account' }, 'PARSE');
    const scale = (await deps.uow.run(workspaceId, () => deps.currencies.scaleOf(account.currency))) ?? 2;
    const timeZone = await deps.uow.run(workspaceId, () => deps.calendar.timeZoneOf(workspaceId));

    let bytes: Uint8Array;
    try {
      const document = await deps.documents.getForProcessing(workspaceId, documentId);
      if (!document || document.status !== 'AVAILABLE') {
        return this.fail(state, { code: 'IMPORT_PARSE_FAILED', pointer: 'document' }, 'PARSE');
      }
      bytes = await deps.documents.readBytes(workspaceId, documentId, deps.settings.documentMaxBytes);
    } catch {
      // Contenido alterado o inaccesible: no es transitorio para esta importación.
      return this.fail(state, { code: 'IMPORT_PARSE_FAILED', pointer: 'document' }, 'PARSE');
    }

    if (isPdf(bytes)) {
      // Extracto PDF (add-pdf-statement-parser): sin el lector configurado sigue siendo un formato no importable.
      if (!deps.pdf) return this.fail(state, { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null }, 'PARSE');
      return this.readPdf(state, bytes, { account, scale, deadline });
    }
    const sniffed = deps.readers.sniff(bytes.subarray(0, 4096));
    if (sniffed === null) {
      return this.fail(state, { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null }, 'PARSE');
    }
    const format = sniffed.format;

    // Perfil: el elegido al crear la importación (si lo hay) o, en los autodescritos, el de la cuenta o institución.
    const institutionId = await deps.uow.run(workspaceId, () =>
      deps.institutions.institutionOf(workspaceId, state.accountId),
    );
    const profiles = await deps.uow.run(workspaceId, () =>
      deps.profiles.latestForMatching(workspaceId, { accountId: state.accountId, institutionId, format }),
    );
    const selfDescribed = !TABULAR_FORMATS.includes(format);
    const selfMatch = selfDescribed
      ? matchProfile({ header: [], format, accountId: state.accountId, institutionId, profiles })
      : null;
    const dateOrder =
      state.readOptions?.dateOrder ??
      (selfMatch?.kind === 'APPLIED' ? (selfMatch.profile.options.dateOrder ?? undefined) : undefined);

    const read = deps.readers.read(format, bytes, {
      timeZone,
      maxRows: deps.settings.maxRows,
      maxColumns: deps.settings.maxColumns,
      accountCurrency: account.currency,
      currencyScale: scale,
      dateOrder,
    });
    if (read.kind === 'FAILED') return this.fail(state, read.failure, 'PARSE');

    if (read.kind === 'RECORDS') {
      const parsed = read.parsed;
      if (parsed.failure) {
        return this.fail(state, { code: parsed.failure.code, pointer: parsed.failure.pointer }, 'PARSE');
      }
      if (parsed.needsMapping.length > 0) {
        return this.awaitMapping(state, {
          help: {
            profileCandidates: [],
            missingColumns: [],
            needs: parsed.needsMapping.map((n) => n.code),
          },
          rowCount: parsed.records.length,
          columnCount: 1,
          header: [],
          encoding: 'utf-8',
          delimiter: ',',
          statement: toStatementInfo(parsed.statement),
        });
      }
      const inserts = this.toInserts(parsed.records);
      const stopped = await this.insertBlocks(state, inserts, deadline, toStatementInfo(parsed.statement));
      if (stopped !== 'CONTINUE') return stopped;
      if (selfMatch?.kind === 'APPLIED') {
        await this.pinProfile(state, { id: selfMatch.profileId, version: selfMatch.version }, null);
      }
      await this.moveToStage(state, 'NORMALIZE');
      return 'CONTINUE';
    }

    // Tabular (CSV/XLSX): se guardan TODAS las celdas (encabezado y preámbulo incluidos) y luego se elige el mapeo.
    const inserts: StagedInsert[] = read.records.map((r) => ({
      id: deps.ids.next(),
      rowNumber: r.line,
      raw: r.cells,
    }));
    const stopped = await this.insertBlocks(state, inserts, deadline, null);
    if (stopped !== 'CONTINUE') return stopped;

    const header = read.records[0]?.cells ?? [];
    const rowCount = Math.max(0, read.records.length - 1);
    const explicit = state.mappingProfile;
    const result = explicit
      ? await this.resolveExplicitProfile(state, explicit.id, explicit.version, header)
      : matchProfile({ header, format, accountId: state.accountId, institutionId, profiles });
    if (result.kind === 'APPLIED' && result.mapping !== null) {
      await this.pinProfile(state, { id: result.profileId, version: result.version }, result.mapping);
      await this.moveToStage(state, 'NORMALIZE');
      return 'CONTINUE';
    }
    const help: MappingHelp =
      result.kind === 'AWAITING_MAPPING'
        ? {
            profileCandidates: result.candidates.map((c) => ({
              profileId: c.profileId,
              version: c.version,
              name: c.name,
              missingColumns: c.missingColumns,
            })),
            missingColumns: result.missingColumns,
            needs: [],
          }
        : { profileCandidates: [], missingColumns: [], needs: [] };
    return this.awaitMapping(state, {
      help,
      rowCount,
      columnCount: read.columnCount,
      header,
      encoding: read.encoding,
      delimiter: read.delimiter,
      statement: null,
    });
  }

  private toInserts(records: readonly StatementRecord[]): StagedInsert[] {
    return records.map((r) => ({
      id: this.deps.ids.next(),
      rowNumber: r.line,
      raw: [],
      record: {
        bookingDate: r.bookingDate,
        bookingTime: r.time,
        valueDate: r.valueDate,
        signedAmount: r.amount,
        currency: r.currency,
        description: r.description,
        externalId: r.externalId,
        reference: r.reference,
        counterpartyText: r.counterparty,
        runningBalance: r.runningBalance,
        issues: r.issues,
      },
    }));
  }

  /**
   * Lectura de un extracto PDF (add-pdf-statement-parser, decisión 4): la etapa es atómica (extracción en el hilo
   * aislado, reconstrucción y coherencia completas) y el staging se escribe DESPUÉS, por bloques con
   * `ON CONFLICT DO NOTHING`; una reentrega vuelve a extraer sin dejar filas a medias.
   */
  private async readPdf(
    state: ImportJobState,
    bytes: Uint8Array,
    ctx: {
      readonly account: { readonly currency: string };
      readonly scale: number;
      readonly deadline: number;
    },
  ): Promise<'CONTINUE' | 'PARSE_FAILED' | 'CANCELLED'> {
    const { deps } = this;
    const pdfReader = deps.pdf as PdfStatementReader;
    const { workspaceId } = state;
    const institutionId = await deps.uow.run(workspaceId, () =>
      deps.institutions.institutionOf(workspaceId, state.accountId),
    );
    const last4Of = deps.institutions.accountNumberLast4Of?.bind(deps.institutions);
    const accountLast4 = last4Of
      ? await deps.uow.run(workspaceId, () => last4Of(workspaceId, state.accountId))
      : null;
    // Diseño: el perfil elegido al crear la importación, o el de la cuenta, o el de su institución.
    let chosen: StoredProfileVersion | null;
    if (state.mappingProfile) {
      const ref = state.mappingProfile;
      const versions = await deps.uow.run(workspaceId, () => deps.profiles.versionsOf(workspaceId, ref.id));
      chosen = versions.find((v) => v.version === ref.version) ?? null;
    } else {
      const profiles = await deps.uow.run(workspaceId, () =>
        deps.profiles.latestForMatching(workspaceId, {
          accountId: state.accountId,
          institutionId,
          format: 'PDF',
        }),
      );
      const match = matchProfile({
        header: [],
        format: 'PDF',
        accountId: state.accountId,
        institutionId,
        profiles,
      });
      chosen =
        match.kind === 'APPLIED'
          ? (profiles.find((p) => p.id === match.profileId && p.version === match.version) ?? null)
          : null;
    }

    const outcome = await pdfReader.read({
      bytes,
      accountCurrency: ctx.account.currency,
      scale: ctx.scale,
      maxRows: deps.settings.maxRows,
      accountLast4,
      pinned: chosen?.options.pdfLayout ?? null,
    });
    if (outcome.kind === 'FAILED') return this.fail(state, outcome.failure, 'PARSE', outcome.pdf);

    await deps.uow.runDetached(workspaceId, async () => {
      const job = await this.lockProcessing(state);
      job.setPdf(outcome.pdf, deps.clock.now().toString());
      await this.save(job);
    });
    const stopped = await this.insertBlocks(
      state,
      this.toInserts(outcome.parsed.records),
      ctx.deadline,
      toStatementInfo(outcome.parsed.statement),
    );
    if (stopped !== 'CONTINUE') return stopped;
    if (chosen && !state.mappingProfile) {
      await this.pinProfile(state, { id: chosen.id, version: chosen.version }, null);
    }
    await this.moveToStage(state, 'NORMALIZE');
    return 'CONTINUE';
  }

  /** El perfil elegido por el usuario al crear la importación: se resuelve contra el encabezado real. */
  private async resolveExplicitProfile(
    state: ImportJobState,
    profileId: string,
    version: number,
    header: readonly string[],
  ) {
    const { deps } = this;
    const versions: readonly StoredProfileVersion[] = await deps.uow.run(state.workspaceId, () =>
      deps.profiles.versionsOf(state.workspaceId, profileId),
    );
    const chosen = versions.find((v) => v.version === version);
    if (!chosen || chosen.options.mapping === null) return { kind: 'NONE' as const };
    const resolved = resolveMapping(chosen.options.mapping, header);
    if (!resolved.ok) {
      return {
        kind: 'AWAITING_MAPPING' as const,
        candidates: [{ profileId, version, name: chosen.name, missingColumns: resolved.missing }],
        missingColumns: resolved.missing,
      };
    }
    return { kind: 'APPLIED' as const, profileId, version, mapping: resolved.mapping, profile: chosen };
  }

  /** Inserta el staging por bloques, con punto de control y verificación de cancelación y de plazo en cada uno. */
  private async insertBlocks(
    state: ImportJobState,
    inserts: readonly StagedInsert[],
    deadline: number,
    statement: ImportStatementInfo | null,
  ): Promise<'CONTINUE' | 'PARSE_FAILED'> {
    const { deps } = this;
    const { workspaceId } = state;
    const total = inserts.length;
    if (total === 0) {
      await this.stillProcessing(state);
      return 'CONTINUE';
    }
    for (let i = 0; i < total; i += IMPORT_BLOCK) {
      if (deps.clock.now().epochMillis > deadline) {
        await this.fail(state, { code: 'IMPORT_PARSE_FAILED', pointer: 'timeout' }, 'PARSE');
        return 'PARSE_FAILED';
      }
      const block = inserts.slice(i, i + IMPORT_BLOCK);
      await deps.uow.runDetached(workspaceId, async () => {
        const job = await this.lockProcessing(state);
        await deps.staging.insertRecords(workspaceId, state.id, block);
        job.checkpoint({
          stage: 'PARSE',
          processedRows: Math.min(total, i + block.length),
          totalRows: total,
          now: deps.clock.now().toString(),
        });
        if (i === 0 && statement !== null) job.setStatement(statement, deps.clock.now().toString());
        await this.save(job);
      });
    }
    return 'CONTINUE';
  }

  private async pinProfile(
    state: ImportJobState,
    profile: { id: string; version: number },
    profileMapping: ProfileMapping | null,
  ): Promise<void> {
    const { deps } = this;
    await deps.uow.runDetached(state.workspaceId, async () => {
      const job = await this.lockProcessing(state);
      job.applyProfileAutomatically({ profileMapping, profile, now: deps.clock.now().toString() });
      await this.save(job);
      await recordJob(deps, job, 'profile_applied', {
        actor: SYSTEM_ACTOR,
        changes: [{ field: 'mappingProfile', before: null, after: `${profile.id}@${profile.version}` }],
        detailRefs: { profileId: profile.id, profileVersion: profile.version },
      });
    });
  }

  private async moveToStage(state: ImportJobState, stage: ImportStage): Promise<void> {
    const { deps } = this;
    await deps.uow.runDetached(state.workspaceId, async () => {
      const job = await this.lockProcessing(state);
      job.checkpoint({
        stage,
        processedRows: job.state.progress.processedRows ?? 0,
        totalRows: job.state.progress.totalRows ?? 0,
        now: deps.clock.now().toString(),
      });
      await this.save(job);
    });
  }

  private async stillProcessing(state: ImportJobState): Promise<void> {
    await this.deps.uow.runDetached(state.workspaceId, async () => {
      await this.lockProcessing(state);
    });
  }

  // ───────────────────────────────────────────────────────────── normalización → coincidencias

  private async enrichStage(
    state: ImportJobState,
    deadline: number,
  ): Promise<'AWAITING_REVIEW' | 'PARSE_FAILED' | 'CANCELLED'> {
    const { deps } = this;
    const { workspaceId } = state;
    const fresh = await deps.uow.run(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, state.id);
      return job ? job.state : null;
    });
    if (!fresh || fresh.status !== 'PROCESSING') return 'CANCELLED';

    const account = await deps.uow.run(workspaceId, () =>
      deps.accounts.getAccount(workspaceId, state.accountId),
    );
    if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
    const scale = await deps.uow.run(workspaceId, () => deps.currencies.scaleOf(account.currency));
    if (scale === null) throw new DomainError('VALIDATION_FAILED', 'the account currency is not active');
    const timeZone = await deps.uow.run(workspaceId, () => deps.calendar.timeZoneOf(workspaceId));
    const closedPeriods = await deps.uow.run(workspaceId, () => deps.periods.listClosed(workspaceId));
    const staged = await deps.uow.run(workspaceId, () => deps.staging.loadAll(workspaceId, state.id));
    const format = (fresh.format ?? 'CSV') as StatementFormat;

    const tabular = TABULAR_FORMATS.includes(format);
    if (tabular && fresh.profileMapping === null) {
      // Sin mapeo efectivo no hay nada que normalizar: vuelve a esperar el mapeo (p. ej. perfil sin columnas).
      return this.awaitMapping(fresh, {
        help: { profileCandidates: [], missingColumns: [], needs: [] },
        rowCount: Math.max(0, staged.length - 1),
        columnCount: fresh.columnCount,
        header: fresh.header,
        encoding: fresh.encoding,
        delimiter: fresh.delimiter,
        statement: null,
      }) as Promise<'AWAITING_REVIEW' | 'PARSE_FAILED' | 'CANCELLED'>;
    }

    const cleanup = await this.profileCleanup(fresh);
    // PDF: fragmentos variables del diseño (solo para la huella) y diferencia del saldo inicial con la cuenta.
    const layoutRef = fresh.pdf?.layout ?? null;
    const volatileFragments = layoutRef ? (deps.pdf?.layoutOf(layoutRef)?.volatileFragments ?? []) : [];
    const openingDifference = await this.openingDifference(fresh, account, scale);
    const output = await runStatementPipeline(
      deps,
      {
        workspaceId,
        accountId: state.accountId,
        currencyCode: account.currency,
        scale,
        timeZone,
        format,
        mapping: tabular ? fresh.profileMapping : null,
        descriptionCleanup: cleanup,
        volatileFragments,
        closedPeriods,
        openingBalance: fresh.statement?.openingBalance ?? null,
      },
      staged,
      {
        onStage: async (stage: StageName, processedRows: number) => {
          if (deps.clock.now().epochMillis > deadline) throw new TimedOut();
          await deps.uow.runDetached(workspaceId, async () => {
            const job = await this.lockProcessing(state);
            job.checkpoint({
              stage,
              processedRows,
              totalRows: Math.max(0, staged.length),
              now: deps.clock.now().toString(),
            });
            await this.save(job);
          });
        },
      },
    ).catch(async (err: unknown) => {
      if (err instanceof TimedOut) {
        await this.fail(state, { code: 'IMPORT_PARSE_FAILED', pointer: 'timeout' }, 'NORMALIZE');
        return null;
      }
      throw err;
    });
    if (output === null) return 'PARSE_FAILED';

    const rulesSummary = this.coverageOf(
      output.items.filter((i) => i.classification !== 'INVALID'),
      output.rulesUnavailable,
    );
    await deps.uow.runDetached(workspaceId, async () => {
      const job = await this.lockProcessing(state);
      if (output.supersededFingerprints.length > 0) {
        await deps.links.supersede(
          workspaceId,
          state.accountId,
          output.supersededFingerprints,
          deps.clock.now().toString(),
        );
      }
      await deps.staging.applyPipeline(workspaceId, state.id, output.items, output.resetIds);
      const summary = await deps.staging.summary(workspaceId, state.id);
      const now = deps.clock.now();
      if (job.state.pdf !== null) {
        job.setPdf({ ...job.state.pdf, openingDifference }, now.toString());
      }
      job.readyForReview({
        counters: countersOf(summary),
        rowCount: summary.rows,
        statement: job.state.statement,
        rulesSummary,
        expiresAt: now.plusMillis(deps.settings.reviewTtlMs).toString(),
        now: now.toString(),
      });
      await this.save(job);
      const event = await publishJobEvent(deps, job, IMPORTS_EVENTS.previewReady, {
        counts: {
          rows: summary.rows,
          newRows: summary.byClassification.NEW,
          alreadyImported: summary.byClassification.DUPLICATE_EXACT,
          probableDuplicates: summary.byClassification.DUPLICATE_PROBABLE,
          invalid: summary.byClassification.INVALID,
        },
      });
      await recordJob(deps, job, 'preview_ready', {
        actor: SYSTEM_ACTOR,
        events: [event],
        changes: [
          { field: 'status', before: 'PROCESSING', after: 'AWAITING_REVIEW' },
          { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ],
      });
    });
    return 'AWAITING_REVIEW';
  }

  /**
   * Diferencia entre el saldo inicial del extracto PDF y el saldo de la cuenta al cierre del día anterior al periodo
   * (decisión 10, Should): meses faltantes o movimientos manuales sin importar. Solo se muestra; no bloquea.
   */
  private async openingDifference(
    state: ImportJobState,
    account: { readonly currency: string; readonly nature: string },
    scale: number,
  ): Promise<{ readonly amount: string; readonly currency: string } | null> {
    const opening = state.statement?.openingBalance ?? null;
    const from = state.statement?.periodFrom ?? null;
    if (state.format !== 'PDF' || opening === null || from === null || account.nature !== 'ASSET')
      return null;
    const dayBefore = LocalDate.parse(from).plusDays(-1).toString();
    const balance = await this.deps.uow.run(state.workspaceId, () =>
      this.deps.balances.presentedBalance(state.workspaceId, state.accountId, dayBefore),
    );
    if (balance === null) return null;
    return { amount: dec(opening).minus(dec(balance)).toFixed(scale), currency: account.currency };
  }

  private coverageOf(
    items: readonly {
      readonly proposal: { readonly category: { readonly origin: { readonly type: string } } | null } | null;
    }[],
    rulesUnavailable: boolean,
  ): ImportRulesSummary {
    const rows = items.length;
    const byRule = items.filter((i) => i.proposal?.category?.origin.type === 'RULE').length;
    const without = items.filter((i) => (i.proposal?.category ?? null) === null).length;
    return {
      rows,
      classifiedByRule: byRule,
      withoutCategory: without,
      ratio: ratio(byRule, rows),
      rulesUnavailable,
    };
  }

  /** Limpieza de descripción del perfil aplicado a un formato autodescrito (el CSV la lleva en su mapeo). */
  private async profileCleanup(state: ImportJobState): Promise<readonly string[]> {
    const ref = state.mappingProfile;
    if (!ref) return [];
    const versions = await this.deps.uow.run(state.workspaceId, () =>
      this.deps.profiles.versionsOf(state.workspaceId, ref.id),
    );
    return versions.find((v) => v.version === ref.version)?.options.descriptionCleanup ?? [];
  }

  // ───────────────────────────────────────────────────────────── transiciones del worker

  private async awaitMapping(
    state: ImportJobState,
    input: {
      readonly help: MappingHelp;
      readonly rowCount: number;
      readonly columnCount: number;
      readonly header: readonly string[];
      readonly encoding: ImportJobState['encoding'];
      readonly delimiter: ImportJobState['delimiter'];
      readonly statement: ImportStatementInfo | null;
    },
  ): Promise<'AWAITING_MAPPING' | 'CANCELLED'> {
    const { deps } = this;
    try {
      await deps.uow.runDetached(state.workspaceId, async () => {
        const job = await this.lockProcessing(state);
        const now = deps.clock.now();
        job.awaitMapping({
          ...input,
          expiresAt: now.plusMillis(deps.settings.reviewTtlMs).toString(),
          now: now.toString(),
        });
        await this.save(job);
        await recordJob(deps, job, 'mapping_requested', {
          actor: SYSTEM_ACTOR,
          changes: [{ field: 'status', before: 'PROCESSING', after: 'AWAITING_MAPPING' }],
        });
      });
    } catch (err) {
      if (err instanceof Stopped) return 'CANCELLED';
      throw err;
    }
    return 'AWAITING_MAPPING';
  }

  /** `PARSE_FAILED`: sin filas, con código y ubicación (nunca texto del archivo) y el evento `ImportFailed`. */
  private async fail(
    state: ImportJobState,
    failure: ImportFailure,
    stage: string,
    pdf?: ImportPdfInfo | null,
  ): Promise<'PARSE_FAILED' | 'CANCELLED'> {
    const { deps } = this;
    try {
      await deps.uow.runDetached(state.workspaceId, async () => {
        const job = await this.lockProcessing(state);
        await deps.staging.deleteAll(state.workspaceId, state.id);
        job.failParse({ failure, ...(pdf === undefined ? {} : { pdf }), now: deps.clock.now().toString() });
        await this.save(job);
        const event = await publishJobEvent(deps, job, IMPORTS_EVENTS.failed, { code: failure.code, stage });
        const changes: AuditChangeInput[] = [
          { field: 'status', before: 'PROCESSING', after: 'PARSE_FAILED' },
          { field: 'failure', before: null, after: JSON.stringify(failure) },
        ];
        await recordJob(deps, job, 'parse_failed', { actor: SYSTEM_ACTOR, events: [event], changes });
      });
    } catch (err) {
      if (err instanceof Stopped) return 'CANCELLED';
      throw err;
    }
    return 'PARSE_FAILED';
  }

  /** Bloquea el job y verifica que siga `PROCESSING`; si no (cancelado), detiene el procesamiento. */
  private async lockProcessing(state: ImportJobState): Promise<ImportJob> {
    const job = await this.deps.jobs.findById(state.workspaceId, state.id, { lock: 'update' });
    if (!job || job.state.status !== 'PROCESSING') throw new Stopped();
    return job;
  }

  private async save(job: ImportJob): Promise<void> {
    if (!(await this.deps.jobs.save(job))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
    }
    job.markPersisted();
  }
}

class TimedOut extends Error {
  constructor() {
    super('import processing timed out');
  }
}

/** `a / b` con 4 decimales HALF_EVEN, exacto y sin `number` (`41 / 57 = 0.7193`). */
export function ratio(a: number, b: number): string {
  if (b === 0) return '0.0000';
  return dec(String(a))
    .div(dec(String(b)))
    .toFixed(4);
}
