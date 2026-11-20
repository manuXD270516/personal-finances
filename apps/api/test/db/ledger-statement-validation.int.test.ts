import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate/dbmate.js';
import { connect, rlsCatalogViolations } from '../support/db.js';

// Validación por sentencia de los invariantes del ledger y de los splits (ADR-0034, change
// stabilize-import-persist-perf, tarea 7.6): catálogo de disparadores y de tablas internas tras la migración, y
// `migrate:down` que vuelve a los disparadores de restricción por fila.
const deps = inject('deps');
const MIGRATION = '20261120100000_ledger_statement_validation.sql';

const QUEUE_TABLES = [
  'ledger.pending_check_sentinel',
  'ledger.pending_entry_check',
  'txn.pending_check_sentinel',
  'txn.pending_splits_check',
];

interface TriggerRow {
  readonly table: string;
  readonly name: string;
  readonly fn: string;
  readonly constraint: boolean;
  readonly deferrable: boolean;
  readonly initdeferred: boolean;
  readonly statement: boolean;
  readonly transitionNew: boolean;
  readonly transitionOld: boolean;
}

/** Disparadores no internos de las seis tablas involucradas (las del ledger y de TRANSACTIONS). */
async function triggers(c: Client): Promise<TriggerRow[]> {
  const { rows } = await c.query(
    `SELECT n.nspname || '.' || r.relname AS "table", t.tgname AS name, p.proname AS fn,
            t.tgconstraint <> 0 AS "constraint", t.tgdeferrable AS deferrable, t.tginitdeferred AS initdeferred,
            (t.tgtype & 1) = 0 AS statement, t.tgnewtable IS NOT NULL AS "transitionNew",
            t.tgoldtable IS NOT NULL AS "transitionOld"
       FROM pg_trigger t
       JOIN pg_class r ON r.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND n.nspname || '.' || r.relname IN ('ledger.journal_entry', 'ledger.posting', 'txn.transaction',
              'txn.transaction_split', 'ledger.pending_check_sentinel', 'txn.pending_check_sentinel')
      ORDER BY 1, 2`,
  );
  return rows as TriggerRow[];
}

const ROW_TRIGGERS = [
  ['ledger.posting', 'posting_balanced_trg', 'assert_entry_balanced'],
  ['ledger.journal_entry', 'journal_entry_postings_trg', 'assert_entry_has_postings'],
  ['txn.transaction', 'transaction_splits_sum_tx', 'assert_splits_sum'],
  ['txn.transaction_split', 'transaction_splits_sum_split', 'assert_splits_sum'],
] as const;

const COLLECTORS = [
  ['ledger.journal_entry', 'journal_entry_collect_trg'],
  ['ledger.posting', 'posting_collect_trg'],
  ['txn.transaction', 'transaction_collect_insert_trg'],
  ['txn.transaction', 'transaction_collect_update_trg'],
  ['txn.transaction_split', 'transaction_split_collect_insert_trg'],
  ['txn.transaction_split', 'transaction_split_collect_update_trg'],
] as const;

const VALIDATORS = [
  ['ledger.pending_check_sentinel', 'pending_check_sentinel_validate_trg', 'validate_pending_entries'],
  ['txn.pending_check_sentinel', 'pending_check_sentinel_validate_trg', 'validate_pending_splits'],
] as const;

function expectPerRowTriggers(rows: readonly TriggerRow[]): void {
  for (const [table, name, fn] of ROW_TRIGGERS) {
    const found = rows.find((r) => r.table === table && r.name === name);
    expect(found, `${table}.${name}`).toMatchObject({
      fn,
      constraint: true,
      deferrable: true,
      initdeferred: true,
      statement: false,
    });
  }
}

function expectNoPerRowTriggers(rows: readonly TriggerRow[]): void {
  expect(rows.filter((r) => ROW_TRIGGERS.some(([t, n]) => t === r.table && n === r.name))).toEqual([]);
  // Ninguna función de validación por fila queda enganchada a un disparador de restricción de esas tablas.
  expect(
    rows.filter(
      (r) =>
        r.constraint &&
        ['assert_entry_balanced', 'assert_entry_has_postings', 'assert_splits_sum'].includes(r.fn),
    ),
  ).toEqual([]);
}

describe('ADR-0034: validación por sentencia de los invariantes del ledger (migración y reversa)', () => {
  let migrator: Client;

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
  });
  afterAll(async () => {
    await migrator?.end();
  });

  const queueState = async () =>
    (
      await migrator.query<{
        name: string;
        persistence: string;
        rls: boolean;
        forced: boolean;
        policies: number;
      }>(
        `SELECT n.nspname || '.' || c.relname AS name, c.relpersistence AS persistence,
                c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname || '.' || c.relname = ANY ($1::text[]) ORDER BY 1`,
        [QUEUE_TABLES],
      )
    ).rows;

  it('[TC-LEDGER-BALANCE-004] con la migración aplicada no quedan disparadores de restricción por fila de cuadre, mínimo de postings ni suma de splits', async () => {
    expectNoPerRowTriggers(await triggers(migrator));
  });

  it('[TC-LEDGER-STRUCTURE-003] hay un recolector por sentencia por tabla y evento y un validador diferido por centinela', async () => {
    const rows = await triggers(migrator);
    for (const [table, name] of COLLECTORS) {
      const found = rows.find((r) => r.table === table && r.name === name);
      expect(found, `${table}.${name}`).toMatchObject({ statement: true, constraint: false });
      expect(found?.transitionNew).toBe(true);
    }
    // El UPDATE de transacciones compara OLD y NEW para encolar solo los cambios de monto.
    expect(
      rows.find((r) => r.table === 'txn.transaction' && r.name === 'transaction_collect_update_trg'),
    ).toMatchObject({ transitionOld: true });
    for (const [table, name, fn] of VALIDATORS) {
      expect(rows.find((r) => r.table === table && r.name === name)).toMatchObject({
        fn,
        constraint: true,
        deferrable: true,
        initdeferred: true,
        statement: false,
      });
    }
    // Los demás disparadores del ledger no cambian: periodo abierto e inmutabilidad.
    expect(rows.filter((r) => r.table === 'ledger.journal_entry').map((r) => r.name)).toEqual(
      expect.arrayContaining(['journal_entry_period_open_trg', 'journal_entry_immutable_trg']),
    );
  });

  it('[TC-TRANSACTIONS-SPLIT-007] las cuatro tablas de la cola son UNLOGGED, con RLS habilitada y forzada y su política; el catálogo de RLS sigue limpio', async () => {
    const state = await queueState();
    expect(state.map((s) => s.name)).toEqual(QUEUE_TABLES);
    for (const s of state) {
      expect(s, s.name).toMatchObject({ persistence: 'u', rls: true, forced: true, policies: 1 });
    }
    expect(await rlsCatalogViolations(migrator)).toEqual([]);
    // Sin `workspace_id`: no entran en el registro de tablas con alcance de workspace ni en el export.
    const { rows } = await migrator.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema || '.' || table_name = ANY ($1::text[]) AND column_name = 'workspace_id'`,
      [QUEUE_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it('la migración toma lock_timeout antes de eliminar los disparadores por fila y conserva las funciones viejas', async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8');
    const up = sql.split('-- migrate:up')[1]?.split('-- migrate:down')[0] ?? '';
    expect(up).toMatch(/lock_timeout/);
    expect(up.indexOf('lock_timeout')).toBeLessThan(up.indexOf('DROP TRIGGER'));
    expect(up).not.toMatch(/DROP FUNCTION/);
    const { rows } = await migrator.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname || '.' || p.proname IN ('ledger.assert_entry_balanced', 'ledger.assert_entry_has_postings',
              'txn.assert_splits_sum') ORDER BY 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      'assert_entry_balanced',
      'assert_entry_has_postings',
      'assert_splits_sum',
    ]);
  });

  it('migrate:down restaura los cuatro disparadores por fila y elimina recolectores, validadores y colas (y el up lo vuelve a dejar igual)', async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8');
    const up = sql.split('-- migrate:up')[1]?.split('-- migrate:down')[0] ?? '';
    const down = sql.split('-- migrate:down')[1] ?? '';
    expect(down.trim()).not.toBe('');
    await migrator.query('BEGIN');
    try {
      await migrator.query(down);
      const rows = await triggers(migrator);
      expectPerRowTriggers(rows);
      expect(rows.filter((r) => r.name.includes('collect') || r.name.includes('validate'))).toEqual([]);
      expect(await queueState()).toEqual([]);
      // Reaplicar el up sobre la base revertida deja el catálogo como al inicio.
      await migrator.query(up);
      expectNoPerRowTriggers(await triggers(migrator));
      expect((await queueState()).map((s) => s.name)).toEqual(QUEUE_TABLES);
    } finally {
      await migrator.query('ROLLBACK');
    }
    // El ROLLBACK deja la base como estaba antes del test.
    expectNoPerRowTriggers(await triggers(migrator));
    expect((await queueState()).map((s) => s.name)).toEqual(QUEUE_TABLES);
  });
});
