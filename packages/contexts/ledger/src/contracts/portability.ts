import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a LEDGER (openspec add-workspace-export): cuentas
 * contables, asientos (con sus reversas), postings y bloqueos de periodo. La importación inserta la historia tal cual
 * (sin re-postear) y los bloqueos AL FINAL: el trigger PF004 rechazaría asientos en un mes ya cerrado. Los asientos
 * conservan su orden: `sequence` (identity) lo reasigna la base respetando el orden del archivo.
 */
export const LEDGER_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'ledger-accounts',
    context: 'ledger',
    table: 'ledger.ledger_account',
    order: 500,
    orderBy: ['id'],
    textRefs: ['code'],
  },
  {
    name: 'journal-entries',
    context: 'ledger',
    table: 'ledger.journal_entry',
    order: 510,
    orderBy: ['sequence'],
    selfRefs: ['reverses_entry_id'],
  },
  {
    name: 'postings',
    context: 'ledger',
    table: 'ledger.posting',
    order: 520,
    orderBy: ['journal_entry_id', 'line_no'],
    money: { amount: 't.currency' },
  },
  {
    name: 'entry-reversals',
    context: 'ledger',
    table: 'ledger.entry_reversal',
    order: 530,
    orderBy: ['original_entry_id'],
    idColumns: [],
  },
  {
    name: 'period-locks',
    context: 'ledger',
    table: 'ledger.period_lock',
    order: 990,
    orderBy: ['year_month'],
    idColumns: [],
  },
];

export const LEDGER_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'ledger.balance_snapshot',
    reason: 'Caché derivada y reconstruible desde los postings (INV-022); se regenera en el workspace nuevo.',
  },
];
