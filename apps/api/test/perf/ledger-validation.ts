import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { MIGRATIONS_DIR } from '../../src/migrate/dbmate.js';

/**
 * RAMA DE EXPERIMENTOS (ADR-0034, tarea 7.6.6; no se fusiona): alterna la base entre los disparadores de restricción
 * por fila (`row`, el estado anterior a la migración: se aplica su bloque `migrate:down`) y la validación por sentencia
 * (`statement`, el bloque `migrate:up`). Es idempotente: solo ejecuta DDL si el estado actual difiere.
 */
export type LedgerValidationMode = 'row' | 'statement';
const MIGRATION = '20261120100000_ledger_statement_validation.sql';

function blocks(): { up: string; down: string } {
  const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8');
  return {
    up: sql.split('-- migrate:up')[1]?.split('-- migrate:down')[0] ?? '',
    down: sql.split('-- migrate:down')[1] ?? '',
  };
}

export async function setLedgerValidation(migratorUrl: string, mode: LedgerValidationMode): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'posting_balanced_trg' AND NOT tgisinternal) AS row_mode`,
    );
    const current: LedgerValidationMode = rows[0]?.row_mode ? 'row' : 'statement';
    if (current === mode) return;
    await client.query(mode === 'row' ? blocks().down : blocks().up);
    process.stderr.write(`[ledger-validation] ${current} -> ${mode}\n`);
  } finally {
    await client.end();
  }
}

/** Funciones de validación: las tres por fila de hoy y las del mecanismo por sentencia (criterio de ADR-0034). */
export const VALIDATION_FUNCTIONS = [
  'txn.assert_splits_sum',
  'ledger.assert_entry_balanced',
  'ledger.assert_entry_has_postings',
  'ledger.collect_entries_from_entry',
  'ledger.collect_entries_from_posting',
  'ledger.validate_pending_entries',
  'txn.collect_splits_from_transaction_insert',
  'txn.collect_splits_from_transaction_update',
  'txn.collect_splits_from_split',
  'txn.validate_pending_splits',
];
