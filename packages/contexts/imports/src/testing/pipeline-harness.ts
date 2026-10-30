import { sha256Hex } from '../domain/index.js';
import { DefaultStatementReader } from '../infrastructure/readers/statement-reader.js';
import { ImportsQueries } from '../application/imports.queries.js';
import { ImportsService } from '../application/imports.service.js';
import { PersistImportService } from '../application/persist-import.service.js';
import { ProcessImportService } from '../application/process-import.service.js';
import { ProfilesService } from '../application/profiles.service.js';
import { RevertImportService } from '../application/revert-import.service.js';
import { MemoryWorld, createMemoryDeps } from '../application/testing/in-memory.js';
import type { ImportsSettings } from '../application/ports/index.js';

/** Arnés de los tests del pipeline de documentos (dobles en memoria; sin base de datos). */

export const WS = 'ws-1';
export const ACCOUNT = 'acc-bob';
export const USER = 'user-ana';
export const INSTITUTION = 'inst-cumbre';

export function setupPipeline(settings: Partial<ImportsSettings> = {}) {
  const world = new MemoryWorld();
  world.addAccount({ accountId: ACCOUNT });
  world.institutions.set(ACCOUNT, INSTITUTION);
  world.readers = new DefaultStatementReader();
  const deps = createMemoryDeps(world, settings);
  return {
    world,
    deps,
    service: new ImportsService(deps),
    queries: new ImportsQueries(deps),
    process: new ProcessImportService(deps),
    persist: new PersistImportService(deps),
    revert: new RevertImportService(deps),
    profiles: new ProfilesService(deps),
  };
}
export type PipelineCtx = ReturnType<typeof setupPipeline>;

const encoder = new TextEncoder();

/** Registra un documento disponible de propósito «extracto para importar». */
export function addDocument(
  ctx: PipelineCtx,
  input: {
    id?: string;
    text?: string;
    bytes?: Uint8Array;
    format: 'OFX' | 'QIF' | 'JSON' | 'CSV' | 'XLSX' | 'PDF';
    status?: string;
    purpose?: string;
    name?: string;
  },
): string {
  const id = input.id ?? `doc-${ctx.world.documents.size + 1}`;
  const bytes = input.bytes ?? encoder.encode(input.text ?? '');
  ctx.world.documents.set(id, {
    documentId: id,
    status: input.status ?? 'AVAILABLE',
    purpose: input.purpose ?? 'IMPORT_SOURCE',
    detectedFormat: input.format,
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    originalName: input.name ?? `extracto.${input.format.toLowerCase()}`,
    bytes,
    linkedTo: [],
  });
  return id;
}

/** Crea la importación desde el documento y deja que el worker la procese; devuelve el job final. */
export async function importDocument(
  ctx: PipelineCtx,
  documentId: string,
  options: { accountId?: string; mappingProfileId?: string } = {},
) {
  const created = await ctx.service.createFromDocument({
    workspaceId: WS,
    userId: USER,
    accountId: options.accountId ?? ACCOUNT,
    documentId,
    mappingProfileId: options.mappingProfileId,
  });
  const outcome = await ctx.process.process({ workspaceId: WS, importId: created.id });
  return { created, outcome, job: await ctx.queries.get(WS, created.id) };
}

export async function previewRows(ctx: PipelineCtx, importId: string, extra: Record<string, unknown> = {}) {
  return ctx.queries.preview(WS, importId, { limit: 5000, ...extra });
}

export async function approveAndPersist(ctx: PipelineCtx, importId: string) {
  const current = await ctx.queries.get(WS, importId);
  await ctx.service.approve({ workspaceId: WS, userId: USER, importId, expectedVersion: current.version });
  const persisted = await ctx.persist.persist({ workspaceId: WS, importId });
  return { persisted, job: await ctx.queries.get(WS, importId) };
}

export const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERROR';
  }
  return 'OK';
};

// ───────────────────────────────────────────────────────────── generadores de archivos sintéticos (SINTETICO)

export interface OfxMovement {
  fitid: string;
  date: string;
  amount: string;
  name: string;
  memo?: string;
}

/** OFX 1.x SGML sintético con los movimientos dados. */
export function ofx(
  movements: readonly OfxMovement[],
  options: { currency?: string; closing?: { amount: string; date: string }; omitClose?: boolean } = {},
): string {
  const body = movements
    .map(
      (m) =>
        `<STMTTRN>\n<TRNTYPE>${m.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${m.date}\n<TRNAMT>${m.amount}\n<FITID>${m.fitid}\n<NAME>${m.name}\n${m.memo ? `<MEMO>${m.memo}\n` : ''}</STMTTRN>`,
    )
    .join('\n');
  return [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<TRNUID>1',
    '<STMTRS>',
    `<CURDEF>${options.currency ?? 'BOB'}`,
    '<BANKACCTFROM>',
    '<BANKID>SINTETICO',
    '<ACCTID>000-SINTETICO',
    '<ACCTTYPE>CHECKING',
    '</BANKACCTFROM>',
    '<BANKTRANLIST>',
    '<DTSTART>20260301',
    '<DTEND>20260331',
    body,
    options.omitClose ? '' : '</BANKTRANLIST>',
    options.closing
      ? `<LEDGERBAL>\n<BALAMT>${options.closing.amount}\n<DTASOF>${options.closing.date}\n</LEDGERBAL>`
      : '',
    '</STMTRS>',
    '</STMTTRNRS>',
    '</BANKMSGSRSV1>',
    '</OFX>',
  ].join('\n');
}

/** JSON propio versionado con los movimientos dados. */
export function jsonStatement(
  movements: readonly {
    date: string;
    amount: string;
    description?: string;
    time?: string;
    externalId?: string;
  }[],
  options: { currency?: string } = {},
): string {
  return JSON.stringify({
    schema: 'pfos.import-file',
    version: 1,
    currency: options.currency ?? 'BOB',
    movements,
  });
}
