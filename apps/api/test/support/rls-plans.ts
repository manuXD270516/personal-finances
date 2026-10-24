import type { Client } from 'pg';

/** Nodo de `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)`; solo los campos que usan las pruebas de RLS. */
export interface PlanNode {
  'Node Type': string;
  'Parent Relationship'?: string;
  'Subplan Name'?: string;
  'Relation Name'?: string;
  Schema?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'One-Time Filter'?: string;
  'Heap Fetches'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Actual Total Time'?: number;
  Output?: string[];
  Plans?: PlanNode[];
}

export interface ExplainResult {
  readonly ms: number;
  readonly root: PlanNode;
}

const ACCESS_NODE = /^(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan)$/u;

/** `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)` de una sentencia, con los parámetros dados. */
export async function explainJson(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<ExplainResult> {
  const { rows } = await client.query<{ 'QUERY PLAN': [{ 'Execution Time': number; Plan: PlanNode }] }>(
    `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ${sql}`,
    [...values],
  );
  const [top] = rows[0]!['QUERY PLAN'];
  return { ms: top['Execution Time'], root: top.Plan };
}

/** `EXPLAIN (ANALYZE, VERBOSE)` en texto (el mismo diagnóstico que `rls-explain.md` del nightly). */
export async function explainText(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<string> {
  const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, VERBOSE) ${sql}`, [
    ...values,
  ]);
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

/** Nodos del plan en preorden. Con `skipInitPlans` omite los subárboles InitPlan/SubPlan (p. ej. el del contexto). */
export function flattenPlan(root: PlanNode, skipInitPlans = false): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    out.push(n);
    for (const c of n.Plans ?? []) {
      if (
        skipInitPlans &&
        (c['Parent Relationship'] === 'InitPlan' || c['Parent Relationship'] === 'SubPlan')
      )
        continue;
      walk(c);
    }
  };
  walk(root);
  return out;
}

const nodeLabel = (n: PlanNode): string =>
  `${n['Node Type']}${n['Relation Name'] ? ` on ${n.Schema ? `${n.Schema}.` : ''}${n['Relation Name']}` : ''}${
    n['Index Name'] ? ` (${n['Index Name']})` : ''
  }`;

/** Tipos de los nodos que procesan filas (sin los subárboles InitPlan/SubPlan), en preorden. */
export function rowNodeTypes(root: PlanNode): string[] {
  return flattenPlan(root, true).map((n) => n['Node Type']);
}

/** Método de acceso, tabla e índice de las lecturas del plan (`Index Only Scan on ledger.posting (posting_balance_ix)`). */
export function accessSignature(root: PlanNode): string {
  return flattenPlan(root, true)
    .filter((n) => ACCESS_NODE.test(n['Node Type']))
    .map(nodeLabel)
    .join(' -> ');
}

/** `Heap Fetches` de los `Index Only Scan` del plan (suma). */
export function heapFetches(root: PlanNode): number {
  return flattenPlan(root).reduce((s, n) => s + (n['Heap Fetches'] ?? 0), 0);
}

/** Árbol del plan legible para el log de CI: tipo, relación, índice, condiciones, filas reales, bucles y tiempo. */
export function renderPlan(root: PlanNode): string {
  const lines: string[] = [];
  const walk = (n: PlanNode, depth: number) => {
    const pad = '  '.repeat(depth);
    const rel = n['Parent Relationship']
      ? `[${n['Parent Relationship']}${n['Subplan Name'] ? ` ${n['Subplan Name']}` : ''}] `
      : '';
    const stats = `rows=${n['Actual Rows'] ?? '?'} loops=${n['Actual Loops'] ?? '?'} ms=${n['Actual Total Time'] ?? '?'}`;
    lines.push(`${pad}-> ${rel}${nodeLabel(n)} (${stats})`);
    for (const key of ['One-Time Filter', 'Index Cond', 'Filter'] as const) {
      if (n[key]) lines.push(`${pad}     ${key}: ${n[key]}`);
    }
    if (n['Heap Fetches'] !== undefined) lines.push(`${pad}     Heap Fetches: ${n['Heap Fetches']}`);
    for (const c of n.Plans ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? Number.NaN : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
