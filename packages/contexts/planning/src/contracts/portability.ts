import type { PortabilitySection } from '@pf/shared-kernel';

/** Nombre del gancho de importación que recalcula `content_sha256` de los snapshots de cierre tras el remapeo de ids. */
export const PLANNING_CLOSE_SNAPSHOT_HASH_HOOK = 'planning.close-snapshot-hash' as const;

/**
 * Secciones de exportación/importación del workspace que pertenecen a PLANNING (openspec add-workspace-export, docs/33
 * "Datos de Phase 2 cubiertos"): periodos financieros, templates con todas sus versiones, planes de presupuesto con sus
 * líneas y cruces de umbral (se importan para no re-emitir alertas), política y snapshots de cierre con sus saldos,
 * reaperturas y avisos de cierre pendiente. Los snapshots son historia inmutable: se insertan tal cual; como su
 * `content_sha256` cubre los ids, el gancho `PLANNING_CLOSE_SNAPSHOT_HASH_HOOK` lo recalcula con los ids nuevos.
 */
export const PLANNING_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'financial-periods',
    context: 'planning',
    table: 'planning.financial_period',
    order: 700,
    orderBy: ['period_start', 'id'],
  },
  { name: 'budget-templates', context: 'planning', table: 'planning.budget_template', order: 710, orderBy: ['id'] },
  {
    name: 'budget-template-versions',
    context: 'planning',
    table: 'planning.budget_template_version',
    order: 711,
    orderBy: ['template_id', 'version_no'],
  },
  {
    name: 'budget-template-lines',
    context: 'planning',
    table: 'planning.budget_template_line',
    order: 712,
    orderBy: ['id'],
    money: {
      planned_amount: 't.currency',
      min_amount: 't.currency',
      max_amount: 't.currency',
      rollover_cap: 't.currency',
    },
  },
  {
    name: 'budgets',
    context: 'planning',
    table: 'planning.budget',
    order: 720,
    orderBy: ['id'],
    selfRefs: ['cloned_from_budget_id'],
  },
  {
    name: 'budget-lines',
    context: 'planning',
    table: 'planning.budget_line',
    order: 721,
    orderBy: ['id'],
    money: {
      planned_amount: '(SELECT b.currency FROM planning.budget b WHERE b.id = t.budget_id)',
      min_amount: '(SELECT b.currency FROM planning.budget b WHERE b.id = t.budget_id)',
      max_amount: '(SELECT b.currency FROM planning.budget b WHERE b.id = t.budget_id)',
      rollover_cap: '(SELECT b.currency FROM planning.budget b WHERE b.id = t.budget_id)',
      rollover_in_amount: '(SELECT b.currency FROM planning.budget b WHERE b.id = t.budget_id)',
    },
  },
  {
    name: 'budget-threshold-crossings',
    context: 'planning',
    table: 'planning.budget_threshold_crossing',
    order: 722,
    orderBy: ['period_id', 'target_kind', 'target_id', 'threshold'],
    idColumns: [],
    money: { reference_amount: 't.currency', actual_amount: 't.currency' },
  },
  {
    name: 'closing-policy',
    context: 'planning',
    table: 'planning.closing_policy',
    order: 730,
    orderBy: ['workspace_id'],
    idColumns: [],
  },
  {
    name: 'close-snapshots',
    context: 'planning',
    table: 'planning.close_snapshot',
    order: 740,
    orderBy: ['period_id', 'close_no'],
    selfRefs: ['previous_snapshot_id'],
    importHook: PLANNING_CLOSE_SNAPSHOT_HASH_HOOK,
  },
  {
    name: 'close-snapshot-balances',
    context: 'planning',
    table: 'planning.close_snapshot_balance',
    order: 741,
    orderBy: ['snapshot_id', 'account_id'],
    idColumns: [],
    money: { balance: 't.currency', presented: 't.currency', statement_balance: 't.currency' },
  },
  {
    name: 'close-snapshot-without-statement',
    context: 'planning',
    table: 'planning.close_snapshot_without_statement',
    order: 742,
    orderBy: ['snapshot_id', 'transaction_id'],
    idColumns: [],
    money: { amount: 't.currency' },
  },
  { name: 'period-reopenings', context: 'planning', table: 'planning.period_reopening', order: 750, orderBy: ['id'] },
  {
    name: 'close-pending-notices',
    context: 'planning',
    table: 'planning.close_pending_notice',
    order: 760,
    orderBy: ['period_id'],
    idColumns: [],
  },
];
