import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect } from '../support/db.js';
import {
  cleanupSeededWorkspaces,
  seedLedgerWorkspace,
  vacuumAnalyzeLedger,
  type SeededWorkspace,
} from '../support/rls-ledger-seed.js';
import {
  accessSignature,
  explainJson,
  explainText,
  heapFetches,
  median,
  renderPlan,
  rowNodeTypes,
  type PlanNode,
} from '../support/rls-plans.js';

const deps = inject('deps');

/**
 * EXPERIMENTO de variantes de la política de aislamiento (openspec optimize-rls-policy-overhead, design decisión 1,
 * tarea 1.3; D294/D295). NO decide ni migra: mide e IMPRIME, para que el owner elija la variante leyendo el log del job
 * `integration`.
 *
 * - Datos: un workspace «A» con 5 000 asientos (10 000 postings, 8 cuentas de activo + la de patrimonio de apertura,
 *   con snapshots) y un workspace «B» (3 000 postings), confirmados con un superusuario, `VACUUM (ANALYZE)`, y
 *   borrados en `afterAll` (el ledger es inmutable por triggers: el borrado usa `session_replication_role = replica`).
 * - Variantes V0–V3: se aplican con `ALTER POLICY` a las políticas de `pf_app`/`pf_worker` de `ledger.posting`,
 *   `ledger.journal_entry`, `ledger.ledger_account` y `ledger.balance_snapshot` (las tablas que leen las sentencias de
 *   `PgBalanceQuery`) y a una tabla de prueba vacía, SIEMPRE dentro de una transacción con `ROLLBACK`: nada de DDL
 *   persiste (el test lo comprueba al final comparando el catálogo).
 * - Con RLS = `SET LOCAL ROLE pf_app` + contexto del workspace A; sin RLS = el superusuario de la misma conexión.
 *
 * Cómo leer el log: bloques `RLS-VARIANT-RESULT <id>` (uno por variante) y `RLS-VARIANT-SUMMARY` al final. Cada
 * bloque trae: aislamiento, fail-closed sin contexto (por operación, comparado con V0), nodos que procesan filas y
 * acceso por índice con y sin RLS, árboles de plan, y tiempos (mediana de pares intercalados).
 */

const PAIRS = 30;
const WARMUP_PAIRS = 6;

interface Variant {
  readonly id: string;
  readonly label: string;
  /** Predicado sobre `workspace_id` (USING y WITH CHECK). */
  readonly predicate: string;
  readonly setup?: readonly string[];
}

const VARIANTS: readonly Variant[] = [
  { id: 'V0', label: 'actual', predicate: 'workspace_id = platform.current_workspace_id()' },
  {
    id: 'V1',
    label: 'InitPlan',
    predicate: 'workspace_id = (SELECT platform.current_workspace_id())',
  },
  {
    id: 'V2',
    label: 'ANY(ARRAY[InitPlan])',
    predicate: 'workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])',
  },
  {
    id: 'V3a',
    label: 'función SQL STABLE envolvente',
    predicate: 'workspace_id = platform.rls_variant_current_workspace_id()',
    setup: [
      `CREATE FUNCTION platform.rls_variant_current_workspace_id() RETURNS uuid
         LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT platform.current_workspace_id() $$`,
      'GRANT EXECUTE ON FUNCTION platform.rls_variant_current_workspace_id() TO pf_app',
    ],
  },
  {
    id: 'V3b',
    label: 'IN (SELECT …)',
    predicate: 'workspace_id IN (SELECT platform.current_workspace_id())',
  },
];

/** Políticas reales de `pf_app`/`pf_worker` de las tablas que leen las sentencias de `PgBalanceQuery`. */
const LEDGER_POLICIES: readonly { table: string; policy: string; using: boolean; check: boolean }[] = [
  { table: 'ledger.ledger_account', policy: 'ws_isolation', using: true, check: true },
  { table: 'ledger.journal_entry', policy: 'ws_isolation_read', using: true, check: false },
  { table: 'ledger.journal_entry', policy: 'ws_isolation_write', using: false, check: true },
  { table: 'ledger.posting', policy: 'ws_isolation_read', using: true, check: false },
  { table: 'ledger.posting', policy: 'ws_isolation_write', using: false, check: true },
  { table: 'ledger.balance_snapshot', policy: 'ws_isolation_read', using: true, check: false },
  { table: 'ledger.balance_snapshot', policy: 'ws_isolation_worker', using: true, check: true },
];

/**
 * Copia de las dos sentencias de `PgBalanceQuery.balances` (packages/contexts/ledger/src/infrastructure/
 * pg-balance.queries.ts) con parámetros numerados. Si esa consulta cambia, el test lo avisa (RLS-VARIANT-NOTE).
 */
const FLOOR_SQL = `SELECT min(bs.last_sequence)::text AS seq FROM ledger.balance_snapshot bs
 WHERE bs.workspace_id = $1
   AND ($2::date IS NULL OR bs.as_of_date <= $2::date)
   AND ($3::boolean OR bs.ledger_account_id = ANY($4::uuid[]))`;

const BALANCES_SQL = `WITH late AS MATERIALIZED (
  SELECT p2.ledger_account_id, e.sequence, e.entry_date
    FROM ledger.journal_entry e
    JOIN ledger.posting p2 ON p2.workspace_id = e.workspace_id AND p2.journal_entry_id = e.id
   WHERE e.workspace_id = $1 AND e.sequence > $2::bigint)
SELECT a.id AS ledger_account_id, a.code, a.type, a.source_account_id, a.currency, c.scale,
       (s.balance + COALESCE((
         SELECT SUM(p.amount) FROM ledger.posting p
          WHERE p.workspace_id = a.workspace_id AND p.ledger_account_id = a.id
            AND p.entry_date > s.as_of_date
            AND ($3::date IS NULL OR p.entry_date <= $3::date)), 0))::text AS balance
  FROM ledger.ledger_account a
  JOIN fx.currency c ON c.code = a.currency
  CROSS JOIN LATERAL (
    (SELECT bs.as_of_date, bs.balance FROM ledger.balance_snapshot bs
      WHERE bs.workspace_id = a.workspace_id AND bs.ledger_account_id = a.id
        AND ($3::date IS NULL OR bs.as_of_date <= $3::date)
        AND NOT EXISTS (
          SELECT 1 FROM late l
           WHERE l.ledger_account_id = bs.ledger_account_id AND l.sequence > bs.last_sequence
             AND l.entry_date <= bs.as_of_date)
      ORDER BY bs.as_of_date DESC LIMIT 1)
    UNION ALL SELECT '-infinity'::date, 0
    ORDER BY 1 DESC LIMIT 1) s
 WHERE a.workspace_id = $1
   AND ($4::boolean OR a.id = ANY($5::uuid[]))
   AND (NOT $6::boolean OR a.source_account_id IS NOT NULL)
   AND ($7::boolean OR a.source_account_id = ANY($8::uuid[]))
 ORDER BY a.currency, a.code`;

type Outcome = { kind: 'error'; code: string } | { kind: 'ok'; rows: number };
const label = (o: Outcome): string =>
  o.kind === 'error' ? `ERROR ${o.code}` : o.rows === 0 ? 'VACIO' : `FILAS(${o.rows})`;

interface StatementSpec {
  readonly id: string;
  readonly title: string;
  readonly sql: string;
  readonly values: readonly unknown[];
  /** Participa en el criterio (b). */
  readonly gate: boolean;
}

interface VariantReport {
  readonly id: string;
  readonly isolationOk: boolean;
  readonly failClosed: Record<string, string>;
  readonly failClosedEqualToV0: boolean;
  readonly includeSameShape: boolean;
  readonly allSameShape: boolean;
  readonly includeDiffMs: number;
  readonly text: string;
}

describe('Experimento de variantes de política RLS en el ledger (sin migración; ROLLBACK)', () => {
  let su: Client;
  let wa: SeededWorkspace;
  let wb: SeededWorkspace;
  let waEntry: { id: string; date: string };
  let wbEntry: { id: string; date: string };
  let statements: StatementSpec[];
  let baselinePlans: Record<string, PlanNode>;
  let policyFingerprintBefore: string;
  const noRowsWorkspace = randomUUID();

  const lit = (v: string) => su.escapeLiteral(v);

  async function policyFingerprint(): Promise<string> {
    const { rows } = await su.query<{ f: string | null }>(
      `SELECT string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' ||
                         coalesce(with_check, ''), E'\\n' ORDER BY schemaname, tablename, policyname) AS f
         FROM pg_policies WHERE schemaname = 'ledger'`,
    );
    return rows[0]?.f ?? '';
  }

  beforeAll(async () => {
    su = await connect(deps.superuserUrl);
    wa = await seedLedgerWorkspace(su, {
      name: 'RLS variants A',
      entries: 5000,
      assetAccounts: 8,
      withAccountsAndSnapshots: true,
    });
    wb = await seedLedgerWorkspace(su, {
      name: 'RLS variants B',
      entries: 1500,
      assetAccounts: 3,
      withAccountsAndSnapshots: true,
    });
    await vacuumAnalyzeLedger(su);
    const entryOf = async (ws: string) =>
      (
        await su.query<{ id: string; date: string }>(
          `SELECT id::text, entry_date::text AS date FROM ledger.journal_entry WHERE workspace_id = $1 LIMIT 1`,
          [ws],
        )
      ).rows[0]!;
    waEntry = await entryOf(wa.workspaceId);
    wbEntry = await entryOf(wb.workspaceId);
    policyFingerprintBefore = await policyFingerprint();
    const { rows: floor } = await su.query<{ seq: string | null }>(FLOOR_SQL, [
      wa.workspaceId,
      '2026-12-31',
      true,
      [],
    ]);
    const checkpoint = floor[0]?.seq ?? null;
    statements = [
      {
        id: 'include',
        title: 'saldo por cuenta (índice INCLUDE, la fila bloqueante del nightly)',
        sql: `SELECT COALESCE(SUM(p.amount), 0) FROM ledger.posting p
               WHERE p.workspace_id = ${lit(wa.workspaceId)} AND p.ledger_account_id = ${lit(wa.equityAccountId)}
                 AND p.entry_date <= DATE '2026-09-30'`,
        values: [],
        gate: true,
      },
      {
        id: 'include-selective',
        title:
          'mismo saldo por índice INCLUDE sobre una cuenta de activo (≈1/8 de los postings; informativo)',
        sql: `SELECT COALESCE(SUM(p.amount), 0) FROM ledger.posting p
               WHERE p.workspace_id = ${lit(wa.workspaceId)} AND p.ledger_account_id = ${lit(wa.assetAccountIds[0]!)}
                 AND p.entry_date <= DATE '2026-09-30'`,
        values: [],
        gate: false,
      },
      {
        id: 'floor',
        title: 'PgBalanceQuery.balances: checkpoint mínimo de snapshots',
        sql: FLOOR_SQL,
        values: [wa.workspaceId, '2026-12-31', true, []],
        gate: true,
      },
      {
        id: 'balances',
        title: 'PgBalanceQuery.balances: saldos en lote (getAccountBalances)',
        sql: BALANCES_SQL,
        values: [wa.workspaceId, checkpoint, '2026-12-31', true, [], true, true, []],
        gate: true,
      },
      {
        id: 'aggregate',
        title: 'agregado sintético de todo el workspace (informativo)',
        sql: `SELECT p.ledger_account_id, SUM(p.amount) FROM ledger.posting p
               WHERE p.workspace_id = ${lit(wa.workspaceId)} GROUP BY p.ledger_account_id`,
        values: [],
        gate: false,
      },
    ];
    baselinePlans = {};
    // Plan base (sin RLS): no depende de la variante.
    for (const st of statements) baselinePlans[st.id] = (await explainJson(su, st.sql, st.values)).root;
  }, 240_000);

  afterAll(async () => {
    if (!su) return;
    try {
      await su.query('ROLLBACK');
    } catch {
      // sin transacción abierta
    }
    try {
      await cleanupSeededWorkspaces(
        su,
        [wa?.workspaceId, wb?.workspaceId].filter((x): x is string => x !== undefined),
      );
    } finally {
      await su.end();
    }
  }, 120_000);

  /** Operación que puede fallar: la aísla en un SAVEPOINT para no abortar la transacción del experimento. */
  async function attempt(sql: string, values: readonly unknown[] = []): Promise<Outcome> {
    await su.query('SAVEPOINT attempt');
    try {
      const r = await su.query(sql, [...values]);
      await su.query('RELEASE SAVEPOINT attempt');
      return { kind: 'ok', rows: r.rowCount ?? 0 };
    } catch (err) {
      await su.query('ROLLBACK TO SAVEPOINT attempt');
      return { kind: 'error', code: (err as { code?: string }).code ?? 'sin-código' };
    }
  }

  const asApp = async (workspaceId: string | null) => {
    await su.query('SET LOCAL ROLE pf_app');
    await su.query(`SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', '', true)`, [
      workspaceId ?? '',
    ]);
  };

  const insertPosting = (ws: string, entry: { id: string; date: string }, account: string, lineNo: number) =>
    attempt(
      `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id,
                                   account_type, currency, amount)
       VALUES (gen_random_uuid(), $1, $2, $3::date, $5::smallint, $4, 'EQUITY', 'BOB', 1)`,
      [ws, entry.id, entry.date, account, lineNo],
    );

  /** Aplica la variante dentro de la transacción abierta: políticas del ledger + tabla de prueba vacía. */
  async function applyVariant(v: Variant): Promise<void> {
    for (const s of v.setup ?? []) await su.query(s);
    for (const p of LEDGER_POLICIES) {
      await su.query(
        `ALTER POLICY ${p.policy} ON ${p.table}${p.using ? ` USING (${v.predicate})` : ''}${
          p.check ? ` WITH CHECK (${v.predicate})` : ''
        }`,
      );
    }
    await su.query(
      `CREATE TABLE ledger.rls_variant_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL)`,
    );
    await su.query('ALTER TABLE ledger.rls_variant_probe ENABLE ROW LEVEL SECURITY');
    await su.query('ALTER TABLE ledger.rls_variant_probe FORCE ROW LEVEL SECURITY');
    await su.query(
      `CREATE POLICY probe_isolation ON ledger.rls_variant_probe TO pf_app
         USING (${v.predicate}) WITH CHECK (${v.predicate})`,
    );
    await su.query('GRANT SELECT, INSERT ON ledger.rls_variant_probe TO pf_app');
  }

  /** Aislamiento con el contexto de A (debe ser igual para toda variante elegible). */
  async function checkIsolation(): Promise<{ ok: boolean; detail: string[] }> {
    await asApp(wa.workspaceId);
    const detail: string[] = [];
    let ok = true;
    const note = (name: string, pass: boolean, text: string) => {
      ok &&= pass;
      detail.push(`${pass ? 'OK   ' : 'FALLA'} ${name}: ${text}`);
    };
    for (const table of [
      'ledger.posting',
      'ledger.journal_entry',
      'ledger.ledger_account',
      'ledger.balance_snapshot',
    ]) {
      const { rows } = await su.query<{ n: string; d: string; m: string | null }>(
        `SELECT count(*)::text AS n, count(DISTINCT workspace_id)::text AS d, min(workspace_id::text) AS m FROM ${table}`,
      );
      const r = rows[0]!;
      note(
        `lectura sin filtro ${table}`,
        Number(r.n) > 0 && r.d === '1' && r.m === wa.workspaceId,
        `${r.n} filas, ${r.d} workspace(s)`,
      );
    }
    const other = await su.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM ledger.posting WHERE workspace_id = $1',
      [wb.workspaceId],
    );
    note('lectura filtrada por B con contexto A', other.rows[0]!.n === '0', `${other.rows[0]!.n} filas`);
    const insB = await insertPosting(wb.workspaceId, wbEntry, wb.equityAccountId, 3);
    note('INSERT hacia B con contexto A', insB.kind === 'error' && insB.code === '42501', label(insB));
    const insA = await insertPosting(wa.workspaceId, waEntry, wa.equityAccountId, 3);
    note('INSERT propio (A) permitido', insA.kind === 'ok' && insA.rows === 1, label(insA));
    const probeB = await attempt('INSERT INTO ledger.rls_variant_probe (workspace_id) VALUES ($1)', [
      wb.workspaceId,
    ]);
    note('probe: INSERT hacia B', probeB.kind === 'error' && probeB.code === '42501', label(probeB));
    const probeA = await attempt('INSERT INTO ledger.rls_variant_probe (workspace_id) VALUES ($1)', [
      wa.workspaceId,
    ]);
    note('probe: INSERT propio', probeA.kind === 'ok' && probeA.rows === 1, label(probeA));
    const probeRead = await su.query<{ n: string; d: string }>(
      'SELECT count(*)::text AS n, count(DISTINCT workspace_id)::text AS d FROM ledger.rls_variant_probe',
    );
    note(
      'probe: lectura',
      probeRead.rows[0]!.n === '1' && probeRead.rows[0]!.d === '1',
      `${probeRead.rows[0]!.n} fila(s)`,
    );
    return { ok, detail };
  }

  /** Operaciones sin contexto de workspace (fail-closed): resultado por operación. */
  async function checkFailClosed(): Promise<Record<string, string>> {
    await asApp(null);
    const ops: [string, string, unknown[]][] = [
      [
        'posting: lectura filtrada (workspace con filas)',
        `SELECT 1 FROM ledger.posting WHERE workspace_id = $1 LIMIT 1`,
        [wa.workspaceId],
      ],
      [
        'posting: lectura filtrada (workspace sin filas)',
        `SELECT 1 FROM ledger.posting WHERE workspace_id = $1 LIMIT 1`,
        [noRowsWorkspace],
      ],
      ['posting: lectura sin filtro', 'SELECT 1 FROM ledger.posting LIMIT 1', []],
      [
        'ledger_account: lectura filtrada',
        'SELECT 1 FROM ledger.ledger_account WHERE workspace_id = $1 LIMIT 1',
        [wa.workspaceId],
      ],
      ['ledger_account: lectura sin filtro', 'SELECT 1 FROM ledger.ledger_account LIMIT 1', []],
      [
        'journal_entry: lectura filtrada',
        'SELECT 1 FROM ledger.journal_entry WHERE workspace_id = $1 LIMIT 1',
        [wa.workspaceId],
      ],
      [
        'balance_snapshot: lectura filtrada',
        'SELECT 1 FROM ledger.balance_snapshot WHERE workspace_id = $1 LIMIT 1',
        [wa.workspaceId],
      ],
      ['balance_snapshot: lectura sin filtro', 'SELECT 1 FROM ledger.balance_snapshot LIMIT 1', []],
      [
        'tabla vacía: lectura filtrada',
        'SELECT 1 FROM ledger.rls_variant_probe WHERE workspace_id = $1',
        [wa.workspaceId],
      ],
      ['tabla vacía: lectura sin filtro', 'SELECT 1 FROM ledger.rls_variant_probe', []],
      [
        'tabla vacía: INSERT',
        'INSERT INTO ledger.rls_variant_probe (workspace_id) VALUES ($1)',
        [wa.workspaceId],
      ],
    ];
    const out: Record<string, string> = {};
    for (const [name, sql, values] of ops) out[name] = label(await attempt(sql, values));
    out['posting: INSERT'] = label(await insertPosting(wa.workspaceId, waEntry, wa.equityAccountId, 4));
    return out;
  }

  /** Pares intercalados con RLS (pf_app + contexto A) y sin RLS (superusuario). */
  async function timePairs(
    st: StatementSpec,
  ): Promise<{ rls: number[]; base: number[]; lastRls: PlanNode; lastRlsText: string }> {
    await asApp(wa.workspaceId);
    const rls: number[] = [];
    const base: number[] = [];
    let lastRls: PlanNode | undefined;
    for (let i = 0; i < WARMUP_PAIRS + PAIRS; i += 1) {
      for (const side of i % 2 === 0 ? (['rls', 'base'] as const) : (['base', 'rls'] as const)) {
        if (side === 'rls') await su.query('SET LOCAL ROLE pf_app');
        else await su.query('RESET ROLE');
        const r = await explainJson(su, st.sql, st.values);
        if (i >= WARMUP_PAIRS) (side === 'rls' ? rls : base).push(r.ms);
        if (side === 'rls') lastRls = r.root;
      }
    }
    await su.query('SET LOCAL ROLE pf_app');
    const lastRlsText = st.id === 'include' ? await explainText(su, st.sql, st.values) : '';
    await su.query('RESET ROLE');
    return { rls, base, lastRls: lastRls!, lastRlsText };
  }

  async function runVariant(v: Variant, v0FailClosed: Record<string, string> | null): Promise<VariantReport> {
    const lines: string[] = [];
    await su.query('BEGIN');
    try {
      await applyVariant(v);
      const iso = await checkIsolation();
      await su.query('RESET ROLE');
      const failClosed = await checkFailClosed();
      await su.query('RESET ROLE');
      const diffs = v0FailClosed
        ? Object.keys(failClosed).filter((k) => failClosed[k] !== v0FailClosed[k])
        : [];

      lines.push(`==== RLS-VARIANT-RESULT ${v.id} (${v.label}) ====`);
      lines.push(`predicado: ${v.predicate}`);
      lines.push(`aislamiento: ${iso.ok ? 'OK' : 'FALLA'}`);
      for (const d of iso.detail) lines.push(`  ${d}`);
      lines.push(
        'fail-closed sin contexto (resultado por operación; PF002 = lanza el error de contexto ausente):',
      );
      for (const [k, r] of Object.entries(failClosed)) {
        const mark =
          v0FailClosed && v0FailClosed[k] !== r ? `   <-- distinto de V0 (${v0FailClosed[k]})` : '';
        lines.push(`  ${k}: ${r}${mark}`);
      }
      lines.push(
        `fail-closed igual a V0: ${v0FailClosed ? (diffs.length === 0 ? 'sí' : `NO (${diffs.length} operación(es))`) : 'n/a (es la referencia)'}`,
      );

      let includeSame = false;
      let allSame = true;
      let includeDiff = Number.NaN;
      for (const st of statements) {
        const t = await timePairs(st);
        const base = baselinePlans[st.id]!;
        const sameNodes = rowNodeTypes(t.lastRls).join(' > ') === rowNodeTypes(base).join(' > ');
        const sameAccess = accessSignature(t.lastRls) === accessSignature(base);
        const same = sameNodes && sameAccess;
        if (st.gate) allSame &&= same;
        if (st.id === 'include') {
          includeSame = same && !rowNodeTypes(t.lastRls).includes('Result');
          includeDiff = median(t.rls) - median(t.base);
        }
        lines.push(`-- sentencia ${st.id}: ${st.title}`);
        lines.push(`   nodos con RLS (sin InitPlan): ${rowNodeTypes(t.lastRls).join(' > ')}`);
        lines.push(`   nodos sin RLS               : ${rowNodeTypes(base).join(' > ')}`);
        lines.push(
          `   acceso con RLS: ${accessSignature(t.lastRls) || '(ninguno)'}; Heap Fetches ${heapFetches(t.lastRls)}`,
        );
        lines.push(
          `   acceso sin RLS: ${accessSignature(base) || '(ninguno)'}; Heap Fetches ${heapFetches(base)}`,
        );
        lines.push(`   mismos nodos y mismo acceso por índice: ${same ? 'sí' : 'NO'}`);
        lines.push(
          `   tiempo (mediana de ${PAIRS} pares, ms): con RLS ${median(t.rls).toFixed(3)} | sin RLS ${median(t.base).toFixed(3)} | diferencia ${(median(t.rls) - median(t.base)).toFixed(3)}`,
        );
        lines.push('   plan con RLS:');
        lines.push(renderPlan(t.lastRls).replace(/^/gmu, '     '));
        if (t.lastRlsText) {
          lines.push('   EXPLAIN (ANALYZE, VERBOSE) en texto, con RLS:');
          lines.push(t.lastRlsText.replace(/^/gmu, '     '));
        }
      }
      const report: VariantReport = {
        id: v.id,
        isolationOk: iso.ok,
        failClosed,
        failClosedEqualToV0: v0FailClosed ? diffs.length === 0 : true,
        includeSameShape: includeSame,
        allSameShape: allSame,
        includeDiffMs: includeDiff,
        text: '',
      };
      lines.push(
        `criterios del design: (a) aislamiento y fail-closed iguales a V0: ${iso.ok && report.failClosedEqualToV0 ? 'sí' : 'NO'} | (b) mismos nodos y acceso que sin política (INCLUDE sin Result): ${includeSame ? 'sí' : 'NO'}, en todas las sentencias: ${allSame ? 'sí' : 'NO'} | (c) diferencia mediana INCLUDE: ${includeDiff.toFixed(3)} ms`,
      );
      lines.push(`==== FIN RLS-VARIANT-RESULT ${v.id} ====`);
      return { ...report, text: lines.join('\n') };
    } finally {
      await su.query('ROLLBACK');
    }
  }

  it('[TC-SECURITY-RLS-009] experimento de variantes V0-V3 sobre el ledger: imprime planes, aislamiento, fail-closed y tiempos; no deja estado', async () => {
    // Aviso si la consulta real cambió respecto de la copia (el experimento informa; no falla por esto).
    const source = readFileSync(
      new URL(
        '../../../../packages/contexts/ledger/src/infrastructure/pg-balance.queries.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const drift = [
      'WITH late AS MATERIALIZED',
      'min(bs.last_sequence)::text AS seq',
      'p.entry_date > s.as_of_date',
      "UNION ALL SELECT '-infinity'::date, 0",
    ].filter((fragment) => !source.includes(fragment));

    const { rows: info } = await su.query<{
      v: string;
      reltuples: string;
      allvisible: string;
      pages: string;
    }>(
      `SELECT current_setting('server_version') AS v, c.reltuples::text, c.relallvisible::text AS allvisible,
                c.relpages::text AS pages FROM pg_class c WHERE c.oid = 'ledger.posting'::regclass`,
    );
    const header = [
      '==== RLS-VARIANT-ENV ====',
      `PostgreSQL ${info[0]!.v}; ledger.posting: ${wa.postings + wb.postings} filas del experimento (A=${wa.postings}, B=${wb.postings}), reltuples=${info[0]!.reltuples}, relpages=${info[0]!.pages}, relallvisible=${info[0]!.allvisible}`,
      `cuenta del INCLUDE: patrimonio de apertura de A (${wa.postings / 2} postings)`,
      drift.length > 0
        ? `RLS-VARIANT-NOTE: la consulta de PgBalanceQuery cambió (faltan fragmentos: ${drift.join(' | ')}); actualizar la copia de este test`
        : 'sentencias de PgBalanceQuery: copia vigente',
      ...statements.map(
        (st) =>
          `-- plan SIN RLS ${st.id} (${st.title}), común a todas las variantes:\n${renderPlan(baselinePlans[st.id]!).replace(/^/gmu, '     ')}`,
      ),
      '==== FIN RLS-VARIANT-ENV ====',
    ];
    console.log(header.join('\n'));

    const reports: VariantReport[] = [];
    let v0: VariantReport | null = null;
    for (const v of VARIANTS) {
      const report = await runVariant(v, v0?.failClosed ?? null);
      console.log(report.text);
      reports.push(report);
      if (v.id === 'V0') v0 = report;
    }

    const summary = [
      '==== RLS-VARIANT-SUMMARY ====',
      'variante | aislamiento | fail-closed = V0 | INCLUDE: mismos nodos y acceso, sin Result | todas las sentencias iguales | dif. mediana INCLUDE (ms)',
      ...reports.map(
        (r) =>
          `${r.id} | ${r.isolationOk ? 'OK' : 'FALLA'} | ${r.failClosedEqualToV0 ? 'sí' : 'NO'} | ${r.includeSameShape ? 'sí' : 'NO'} | ${r.allSameShape ? 'sí' : 'NO'} | ${r.includeDiffMs.toFixed(3)}`,
      ),
      'Elegible = aislamiento OK, fail-closed = V0 y mismos nodos/acceso; entre elegibles, la menor diferencia (design, decisión 1). Si ninguna: D295.',
      '==== FIN RLS-VARIANT-SUMMARY ====',
    ];
    console.log(summary.join('\n'));

    // Regresión de aislamiento de la política REAL (V0): sí falla el test.
    expect(reports[0]!.isolationOk, 'aislamiento de la política actual (V0)').toBe(true);
    for (const [op, result] of Object.entries(reports[0]!.failClosed)) {
      expect(result.startsWith('FILAS'), `V0 sin contexto devolvió filas: ${op}`).toBe(false);
    }

    // El experimento no deja estado: ni políticas modificadas ni objetos de prueba.
    expect(await policyFingerprint()).toBe(policyFingerprintBefore);
    const { rows: leftovers } = await su.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM pg_class WHERE relname = 'rls_variant_probe')
              + (SELECT count(*) FROM pg_proc WHERE proname = 'rls_variant_current_workspace_id') AS n`,
    );
    expect(Number(leftovers[0]!.n)).toBe(0);
  }, 600_000);
});
