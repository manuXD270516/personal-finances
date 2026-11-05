import type { LedgerTrialPort, ReconciliationReports } from '@pf/reporting/interface/reporting.module';
import type { Client } from 'pg';

/**
 * Soporte de la reconciliación reporte↔ledger sobre una API real (openspec add-financial-reports, tareas 4.3 y 5.3):
 * los reportes se piden por HTTP con el token de un miembro y el camino INDEPENDIENTE del ledger es SQL directo sobre
 * `ledger.posting` (sin porciones ni contratos de TRANSACTIONS), como superusuario (sin RLS) acotado al workspace.
 */
type Json = Record<string, unknown>;
type Caller = (method: string, path: string, token: string) => Promise<{ status: number; body: Json }>;

const qs = (params: Record<string, unknown>): string => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || k === 'userId' || k === 'workspaceId') continue;
    for (const item of Array.isArray(v) ? v : [v]) out.push(`${k}=${encodeURIComponent(String(item))}`);
  }
  return out.join('&');
};

/** Adaptador HTTP de los seis reportes que usa la batería (`{ report }` como el servicio en proceso). */
export function httpReports(call: Caller, token: string, workspaceId: string): ReconciliationReports {
  const base = `/api/v1/workspaces/${workspaceId}/reports`;
  const get = async (path: string, params: Record<string, unknown>) => {
    const r = await call('GET', `${base}/${path}?${qs(params)}`, token);
    if (r.status !== 200) throw new Error(`GET ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return { report: r.body, dataVersion: String((r.body['meta'] as Json)['dataVersion']) };
  };
  const rename = (p: Record<string, unknown>): Record<string, unknown> => ({
    ...p,
    accountId: p['accountIds'],
    currency: p['currencies'],
    categoryId: p['categoryIds'],
    tagId: p['tagIds'],
    counterpartyId: p['counterpartyIds'],
    accountIds: undefined,
    currencies: undefined,
    categoryIds: undefined,
    tagIds: undefined,
    counterpartyIds: undefined,
  });
  type P = Record<string, unknown> & { accountId?: unknown };
  return {
    getIncomeExpenses: (p: P) => get('income-expenses', rename(p)),
    getExpensesByCategory: (p: P) => get('expenses/by-category', rename(p)),
    getCashFlow: (p: P) => get('cash-flow', rename(p)),
    getNetWorth: (p: P) => get('net-worth', rename(p)),
    getDrillDown: (p: P) =>
      get('drill-down', rename({ ...p, historyAccountId: p.accountId, accountId: undefined })),
    getAccountBalanceHistory: (p: P) =>
      get(`accounts/${String(p.accountId)}/balance-history`, { from: p.from, to: p.to }),
  } as unknown as ReconciliationReports;
}

/** Balance de comprobación por SQL directo: saldo contable de cada cuenta contable hasta `asOf` inclusive. */
export function sqlLedger(client: Client): LedgerTrialPort {
  return {
    async getTrialBalance({ workspaceId, asOf }) {
      const { rows } = await client.query<{
        code: string;
        source: string | null;
        currency: string;
        balance: string;
      }>(
        `SELECT la.code, la.source_account_id::text AS source, la.currency, SUM(p.amount)::text AS balance
           FROM ledger.posting p
           JOIN ledger.ledger_account la ON la.workspace_id = p.workspace_id AND la.id = p.ledger_account_id
          WHERE p.workspace_id = $1 AND ($2::date IS NULL OR p.entry_date <= $2::date)
          GROUP BY la.code, la.source_account_id, la.currency`,
        [workspaceId, asOf ?? null],
      );
      const byCurrency = new Map<
        string,
        { code: string; accountId: string | null; balance: { amount: string; currency: string } }[]
      >();
      for (const r of rows) {
        const list = byCurrency.get(r.currency) ?? [];
        list.push({
          code: r.code,
          accountId: r.source,
          balance: { amount: r.balance, currency: r.currency },
        });
        byCurrency.set(r.currency, list);
      }
      return { currencies: [...byCurrency.entries()].map(([currency, lines]) => ({ currency, lines })) };
    },
  };
}
