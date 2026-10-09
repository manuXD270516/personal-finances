import { DomainError } from '@pf/shared-kernel';

/**
 * `ExportManifest` (openspec add-workspace-export, design decisión 3; docs/30 §10): índice firmado por hashes del archivo
 * `pfos-export`. Versión de formato 1. Montos y saldos son cadenas decimales EXACTAS con la escala de su moneda; los
 * instantes, ISO-8601 UTC. `verification` fija los saldos por cuenta y el balance de comprobación de la instantánea: la
 * importación los compara antes de hacer visible el workspace (INV-004, INV-022).
 */
export const EXPORT_FORMAT = 'pfos-export' as const;
export const EXPORT_FORMAT_VERSION = 1;
export const SUPPORTED_EXPORT_FORMAT_VERSIONS: readonly number[] = [1];

export const MANIFEST_FILE = 'manifest.json';
export const SCHEMA_BASE_ID = 'https://contracts.pfos.local/export/v1/';

export interface ManifestSection {
  readonly name: string;
  readonly file: string;
  readonly schema: string;
  readonly count: number;
  readonly sha256: string;
}

export interface ManifestCsv {
  readonly name: string;
  readonly file: string;
  readonly count: number;
  readonly sha256: string;
}

export interface AccountBalanceLine {
  readonly accountId: string;
  readonly currency: string;
  readonly balance: string;
}

export interface TrialBalanceLine {
  readonly ledgerAccountId: string;
  readonly currency: string;
  readonly balance: string;
}

export interface ManifestActor {
  readonly userId: string;
  readonly displayName: string;
}

export interface ExportManifest {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: number;
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** Un export de un workspace demo NUNCA se importa (docs/33 D99). */
  readonly isDemo: boolean;
  readonly exportedAt: string;
  readonly snapshotAt: string;
  readonly pfosVersion: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly sections: readonly ManifestSection[];
  readonly csv: readonly ManifestCsv[];
  readonly verification: {
    readonly accountBalances: readonly AccountBalanceLine[];
    readonly trialBalance: readonly TrialBalanceLine[];
  };
  readonly actors: readonly ManifestActor[];
}

const corrupted = (detail: string) => new DomainError('EXPORT_FILE_CORRUPTED', `manifest: ${detail}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL = /^-?\d+(?:\.\d+)?$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const SECTION_NAME = /^[a-z][a-z0-9-]{0,62}$/u;
const CURRENCY = /^[A-Z][A-Z0-9]{1,15}$/u;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(o: Json, key: string, pattern?: RegExp): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0 || (pattern && !pattern.test(v)))
    throw corrupted(`campo ${key} inválido`);
  return v;
}

function list(o: Json, key: string): Json[] {
  const v = o[key];
  if (!Array.isArray(v) || !v.every(isObject)) throw corrupted(`campo ${key} inválido`);
  return v as Json[];
}

function count(o: Json): number {
  const v = o['count'];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw corrupted('conteo inválido');
  return v;
}

/**
 * Valida y normaliza un `manifest.json` ya parseado. Errores: formato desconocido o manifiesto mal formado ⇒
 * `EXPORT_FILE_CORRUPTED`; versión de formato no soportada o export de un workspace demo ⇒ `EXPORT_FORMAT_UNSUPPORTED`.
 * Los campos desconocidos se ignoran (las secciones nuevas son opcionales en versiones menores compatibles).
 */
export function parseExportManifest(raw: unknown): ExportManifest {
  if (!isObject(raw)) throw corrupted('no es un objeto');
  if (raw['format'] !== EXPORT_FORMAT) throw corrupted('formato desconocido');
  const version = raw['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw corrupted('formatVersion inválida');
  if (!SUPPORTED_EXPORT_FORMAT_VERSIONS.includes(version)) {
    throw new DomainError('EXPORT_FORMAT_UNSUPPORTED', `export format version ${version} is not supported`);
  }
  if (typeof raw['isDemo'] !== 'boolean') throw corrupted('isDemo inválido');
  if (raw['isDemo']) {
    throw new DomainError('EXPORT_FORMAT_UNSUPPORTED', 'demo workspace exports cannot be imported');
  }
  const sections = list(raw, 'sections').map((s) => ({
    name: str(s, 'name', SECTION_NAME),
    file: str(s, 'file'),
    schema: str(s, 'schema'),
    count: count(s),
    sha256: str(s, 'sha256', SHA256),
  }));
  if (new Set(sections.map((s) => s.name)).size !== sections.length) throw corrupted('secciones repetidas');
  for (const s of sections)
    if (s.file !== `json/${s.name}.jsonl`) throw corrupted(`archivo inválido para ${s.name}`);
  const csv = list(raw, 'csv').map((s) => ({
    name: str(s, 'name', SECTION_NAME),
    file: str(s, 'file'),
    count: count(s),
    sha256: str(s, 'sha256', SHA256),
  }));
  for (const c of csv) if (c.file !== `csv/${c.name}.csv`) throw corrupted(`archivo inválido para ${c.name}`);
  const verification = raw['verification'];
  if (!isObject(verification)) throw corrupted('verification inválida');
  const accountBalances = list(verification, 'accountBalances').map((l) => ({
    accountId: str(l, 'accountId', UUID),
    currency: str(l, 'currency', CURRENCY),
    balance: str(l, 'balance', DECIMAL),
  }));
  const trialBalance = list(verification, 'trialBalance').map((l) => ({
    ledgerAccountId: str(l, 'ledgerAccountId', UUID),
    currency: str(l, 'currency', CURRENCY),
    balance: str(l, 'balance', DECIMAL),
  }));
  const actors = list(raw, 'actors').map((a) => ({
    userId: str(a, 'userId', UUID),
    displayName: typeof a['displayName'] === 'string' ? (a['displayName'] as string) : '',
  }));
  return {
    format: EXPORT_FORMAT,
    formatVersion: version,
    workspaceId: str(raw, 'workspaceId', UUID),
    workspaceName: str(raw, 'workspaceName'),
    isDemo: false,
    exportedAt: str(raw, 'exportedAt', INSTANT),
    snapshotAt: str(raw, 'snapshotAt', INSTANT),
    pfosVersion: str(raw, 'pfosVersion'),
    baseCurrency: str(raw, 'baseCurrency', CURRENCY),
    timezone: str(raw, 'timezone'),
    sections,
    csv,
    verification: { accountBalances, trialBalance },
    actors,
  };
}

/** Serialización estable del manifiesto (claves en el orden del tipo; el hash del archivo lo cubre el ZIP). */
export function serializeExportManifest(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/** Cuenta de una sección del manifiesto (0 si el archivo no la trae: secciones nuevas son opcionales). */
export const sectionCount = (manifest: ExportManifest, name: string): number =>
  manifest.sections.find((s) => s.name === name)?.count ?? 0;

export interface VerificationMismatch {
  readonly kind: 'ACCOUNT_BALANCE' | 'TRIAL_BALANCE' | 'TRIAL_BALANCE_SUM';
  readonly id: string;
  readonly currency: string;
  readonly expected: string;
  readonly actual: string;
}

/** Normaliza un decimal a su forma canónica para compararlo sin depender de ceros de relleno (`45.90` = `45.9`). */
export function canonicalDecimalText(value: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!m) return value;
  const frac = (m[3] ?? '').replace(/0+$/u, '');
  const int = m[2]!.replace(/^0+(?=\d)/u, '');
  const body = frac.length > 0 ? `${int}.${frac}` : int;
  return body === '0' ? '0' : `${m[1] ?? ''}${body}`;
}

/**
 * Compara la verificación esperada (manifiesto, con los ids YA remapeados al workspace nuevo) con la calculada sobre
 * los datos importados. Devuelve las diferencias (vacío = coincide). Además exige que el balance de comprobación sume 0
 * por moneda (INV-004) en lo importado.
 */
export function compareVerification(
  expected: ExportManifest['verification'],
  actual: ExportManifest['verification'],
): VerificationMismatch[] {
  const out: VerificationMismatch[] = [];
  const actualAccounts = new Map(
    actual.accountBalances.map((l) => [`${l.accountId}|${l.currency}`, l.balance]),
  );
  for (const e of expected.accountBalances) {
    const got = actualAccounts.get(`${e.accountId}|${e.currency}`) ?? '0';
    if (canonicalDecimalText(got) !== canonicalDecimalText(e.balance)) {
      out.push({
        kind: 'ACCOUNT_BALANCE',
        id: e.accountId,
        currency: e.currency,
        expected: e.balance,
        actual: got,
      });
    }
  }
  const expectedAccountKeys = new Set(expected.accountBalances.map((l) => `${l.accountId}|${l.currency}`));
  for (const a of actual.accountBalances) {
    if (!expectedAccountKeys.has(`${a.accountId}|${a.currency}`) && canonicalDecimalText(a.balance) !== '0') {
      out.push({
        kind: 'ACCOUNT_BALANCE',
        id: a.accountId,
        currency: a.currency,
        expected: '0',
        actual: a.balance,
      });
    }
  }
  const actualLedger = new Map(
    actual.trialBalance.map((l) => [`${l.ledgerAccountId}|${l.currency}`, l.balance]),
  );
  for (const e of expected.trialBalance) {
    const got = actualLedger.get(`${e.ledgerAccountId}|${e.currency}`) ?? '0';
    if (canonicalDecimalText(got) !== canonicalDecimalText(e.balance)) {
      out.push({
        kind: 'TRIAL_BALANCE',
        id: e.ledgerAccountId,
        currency: e.currency,
        expected: e.balance,
        actual: got,
      });
    }
  }
  const expectedLedgerKeys = new Set(expected.trialBalance.map((l) => `${l.ledgerAccountId}|${l.currency}`));
  for (const a of actual.trialBalance) {
    if (
      !expectedLedgerKeys.has(`${a.ledgerAccountId}|${a.currency}`) &&
      canonicalDecimalText(a.balance) !== '0'
    ) {
      out.push({
        kind: 'TRIAL_BALANCE',
        id: a.ledgerAccountId,
        currency: a.currency,
        expected: '0',
        actual: a.balance,
      });
    }
  }
  // Σ balance de comprobación por moneda = 0 (partida doble) en lo calculado.
  const sums = new Map<string, bigint>();
  const scales = new Map<string, number>();
  for (const l of actual.trialBalance) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(l.balance);
    if (!m) continue;
    const frac = m[3] ?? '';
    scales.set(l.currency, Math.max(scales.get(l.currency) ?? 0, frac.length));
  }
  for (const l of actual.trialBalance) {
    const scale = scales.get(l.currency) ?? 0;
    const m = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(l.balance);
    if (!m) continue;
    const digits = BigInt(`${m[2]}${(m[3] ?? '').padEnd(scale, '0')}`);
    sums.set(l.currency, (sums.get(l.currency) ?? 0n) + (m[1] === '-' ? -digits : digits));
  }
  for (const [currency, sum] of sums) {
    if (sum !== 0n)
      out.push({ kind: 'TRIAL_BALANCE_SUM', id: currency, currency, expected: '0', actual: sum.toString() });
  }
  return out;
}
