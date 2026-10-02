import { randomUUID } from 'node:crypto';
import { MIGRATOR_URL, pg } from './env.js';

export interface PostingInput {
  id: string;
  lineNo: number;
  ledgerAccountId: string;
  accountType: string;
  currency: string;
  amount: string; // decimal como string, nunca number
  splitId: string | null;
}

export interface EntryInput {
  id: string;
  entryDate: string; // 'YYYY-MM-DD'
  postings: PostingInput[];
}

export interface PostingRow {
  id: string;
  workspaceId: string;
  lineNo: number;
  currency: string;
  amount: string; // normalizado por el mapper del repo
  rawAmountType: string; // tipo runtime que entregó la herramienta
}

/** Contrato mínimo que implementa cada herramienta (adapter de infraestructura). */
export interface LedgerRepo {
  readonly name: string;
  /** Una transacción: SET LOCAL app.workspace_id + insert entry + postings. */
  postEntry(ws: string, entry: EntryInput, hooks?: { afterInserts?: () => void }): Promise<void>;
  readEntryPostings(ws: string, entryId: string): Promise<PostingRow[]>;
  /** Repositorio "olvidadizo": SIN filtro por workspace_id (solo RLS protege). */
  listAllPostingsUnfiltered(ws: string): Promise<PostingRow[]>;
  /** Query fuera de transacción y sin contexto RLS. */
  listAllPostingsWithoutContext(): Promise<PostingRow[]>;
  /** Devuelve current_setting('app.workspace_id') y workspaces visibles dentro de la tx. */
  probeContext(ws: string): Promise<{ setting: string; visibleWorkspaces: string[] }>;
  updatePostingAmount(ws: string, postingId: string, amount: string): Promise<void>;
  deletePosting(ws: string, postingId: string): Promise<void>;
  sumByCurrency(ws: string, entryId: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export interface WorkspaceFixture {
  ws: string;
  acc: {
    usdtWallet: string;
    fxUsdt: string;
    fxBob: string;
    bankBob: string;
    expenseBob: string;
    ethWallet: string;
    adjEth: string;
  };
}

/** Siembra un workspace con sus ledger accounts como pf_migrator (también sujeto a FORCE RLS). */
export async function seedWorkspace(name: string): Promise<WorkspaceFixture> {
  const ws = randomUUID();
  const acc = {
    usdtWallet: randomUUID(),
    fxUsdt: randomUUID(),
    fxBob: randomUUID(),
    bankBob: randomUUID(),
    expenseBob: randomUUID(),
    ethWallet: randomUUID(),
    adjEth: randomUUID(),
  };
  const c = new pg.Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.workspace_id', $1, true)`, [ws]);
    await c.query('INSERT INTO iam.workspace (id, name) VALUES ($1, $2)', [ws, name]);
    const rows: [string, string, string, string | null, string | null, string][] = [
      [acc.usdtWallet, 'ASSET', 'USDT', null, randomUUID(), 'USDT Wallet'],
      [acc.fxUsdt, 'EQUITY', 'USDT', 'FX_TRADING', null, 'FX_TRADING:USDT'],
      [acc.fxBob, 'EQUITY', 'BOB', 'FX_TRADING', null, 'FX_TRADING:BOB'],
      [acc.bankBob, 'ASSET', 'BOB', null, randomUUID(), 'Bank BOB'],
      [acc.expenseBob, 'EXPENSE', 'BOB', 'EXPENSE', null, 'EXPENSE:BOB'],
      [acc.ethWallet, 'ASSET', 'ETH', null, randomUUID(), 'ETH Wallet'],
      [acc.adjEth, 'EQUITY', 'ETH', 'ADJUSTMENTS', null, 'ADJUSTMENTS:ETH'],
    ];
    for (const [id, type, ccy, sys, src, code] of rows) {
      await c.query(
        `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, ws, type, ccy, sys, src, code],
      );
    }
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  return { ws, acc };
}

const p = (
  lineNo: number,
  ledgerAccountId: string,
  accountType: string,
  currency: string,
  amount: string,
  splitId: string | null = null,
): PostingInput => ({ id: randomUUID(), lineNo, ledgerAccountId, accountType, currency, amount, splitId });

/** ARCHITECTURE §4.2 — conversión USDT→BOB balanceada por moneda. */
export function usdtToBobConversion(f: WorkspaceFixture, bobFee = '5.00'): EntryInput {
  return {
    id: randomUUID(),
    entryDate: '2026-10-01',
    postings: [
      p(1, f.acc.usdtWallet, 'ASSET', 'USDT', '-100.000000'),
      p(2, f.acc.fxUsdt, 'EQUITY', 'USDT', '100.000000'),
      p(3, f.acc.fxBob, 'EQUITY', 'BOB', '-690.00'),
      p(4, f.acc.bankBob, 'ASSET', 'BOB', '685.00'),
      p(5, f.acc.expenseBob, 'EXPENSE', 'BOB', bobFee, randomUUID()),
    ],
  };
}

export const EXTREME_AMOUNTS = [
  '0.000000000000000001',
  '99999999999999999999.999999999999999999',
  '123456789012345678.123456789012345678',
] as const;

/** Entry ETH con montos extremos (+x / -x) para round-trip exacto de NUMERIC(38,18). */
export function extremeAmountsEntry(f: WorkspaceFixture): EntryInput {
  const postings: PostingInput[] = [];
  let line = 1;
  for (const a of EXTREME_AMOUNTS) {
    postings.push(p(line++, f.acc.ethWallet, 'ASSET', 'ETH', a));
    postings.push(p(line++, f.acc.adjEth, 'EQUITY', 'ETH', `-${a}`));
  }
  return { id: randomUUID(), entryDate: '2026-10-01', postings };
}

/** Busca un texto en mensaje/props/cause de un error (las herramientas envuelven distinto). */
export function errorChainIncludes(err: unknown, needle: string, depth = 0, seen = new Set<unknown>()): boolean {
  if (err == null || depth > 6 || seen.has(err)) return false;
  if (typeof err === 'string') return err.includes(needle);
  if (typeof err !== 'object') return false;
  seen.add(err);
  for (const k of Object.getOwnPropertyNames(err)) {
    const v = (err as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.includes(needle)) return true;
    if (typeof v === 'object' && errorChainIncludes(v, needle, depth + 1, seen)) return true;
  }
  return false;
}

export function describeError(err: unknown): string {
  const e = err as { constructor?: { name?: string }; code?: unknown; message?: string; cause?: unknown };
  const cause = e?.cause as { constructor?: { name?: string }; code?: unknown } | undefined;
  const msg = String(e?.message ?? err).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 160);
  return `${e?.constructor?.name}(code=${String(e?.code)}${cause ? `, cause=${cause.constructor?.name}(code=${String(cause.code)})` : ''}): ${msg}`;
}
