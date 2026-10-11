import type { PortabilitySection } from '@pf/shared-kernel';

/** Moneda del préstamo de la fila (los pagos y sus imputaciones no repiten la columna). */
const LOAN_CURRENCY = '(SELECT l.currency FROM debt.loan l WHERE l.id = t.loan_id)';
/** Moneda del préstamo dueño de la tabla de referencia. */
const REFERENCE_CURRENCY =
  '(SELECT l.currency FROM debt.loan_reference_schedule s JOIN debt.loan l ON l.id = s.loan_id WHERE s.id = t.reference_id)';

/** Moneda de la cuenta de tarjeta a la que pertenece una fila hija. */
const CARD_PLAN_CURRENCY = '(SELECT p.currency FROM debt.card_installment_plan p WHERE p.id = t.plan_id)';

/**
 * Secciones de exportación/importación del workspace que pertenecen a DEBT (openspec add-loans decisión 16 y tarea 4.5;
 * orden 780–787, después de COMMITMENTS 750–765 e IMPORTS 770–771 y antes de NOTIFICATIONS 800): el préstamo, las
 * versiones inmutables de su cronograma y sus cuotas, los pagos con sus imputaciones, las tablas del banco cargadas
 * como referencia y las comparaciones. Los ids de cuentas, transacciones, contrapartes y la definición recurrente se
 * remapean al importar (columnas `uuid`), igual que las referencias internas (`loan_id`, `installment_id`,
 * `payment_id`, `reference_id`) con el mapa que siembra la primera pasada.
 */
export const DEBT_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'loans',
    context: 'debt',
    table: 'debt.loan',
    order: 780,
    orderBy: ['id'],
    money: { principal: 't.currency', retained_fee: 't.currency', existing_outstanding: 't.currency' },
  },
  {
    name: 'loan-schedule-versions',
    context: 'debt',
    table: 'debt.loan_schedule_version',
    order: 781,
    orderBy: ['loan_id', 'schedule_version'],
    idColumns: [],
  },
  {
    name: 'loan-installments',
    context: 'debt',
    table: 'debt.loan_installment',
    order: 782,
    orderBy: ['loan_id', 'schedule_version', 'installment_no'],
    money: {
      principal_amount: 't.currency',
      interest_amount: 't.currency',
      fees_amount: 't.currency',
      insurance_amount: 't.currency',
      tax_amount: 't.currency',
      total_amount: 't.currency',
      opening_balance: 't.currency',
      closing_balance: 't.currency',
    },
  },
  {
    name: 'loan-payments',
    context: 'debt',
    table: 'debt.loan_payment',
    order: 783,
    orderBy: ['loan_id', 'payment_no'],
    money: {
      amount: LOAN_CURRENCY,
      principal: LOAN_CURRENCY,
      interest: LOAN_CURRENCY,
      fees: LOAN_CURRENCY,
      insurance: LOAN_CURRENCY,
      taxes: LOAN_CURRENCY,
    },
  },
  {
    name: 'loan-payment-allocations',
    context: 'debt',
    table: 'debt.loan_payment_allocation',
    order: 784,
    orderBy: ['payment_id', 'installment_no'],
    idColumns: [],
    money: {
      principal: LOAN_CURRENCY,
      interest: LOAN_CURRENCY,
      fees: LOAN_CURRENCY,
      insurance: LOAN_CURRENCY,
      taxes: LOAN_CURRENCY,
    },
  },
  {
    name: 'loan-reference-schedules',
    context: 'debt',
    table: 'debt.loan_reference_schedule',
    order: 785,
    orderBy: ['loan_id', 'reference_version'],
  },
  {
    name: 'loan-reference-rows',
    context: 'debt',
    table: 'debt.loan_reference_row',
    order: 786,
    orderBy: ['reference_id', 'installment_no'],
    idColumns: [],
    money: {
      principal: REFERENCE_CURRENCY,
      interest: REFERENCE_CURRENCY,
      fees: REFERENCE_CURRENCY,
      insurance: REFERENCE_CURRENCY,
      taxes: REFERENCE_CURRENCY,
      total: REFERENCE_CURRENCY,
      balance: REFERENCE_CURRENCY,
    },
  },
  {
    name: 'loan-schedule-comparisons',
    context: 'debt',
    table: 'debt.loan_schedule_comparison',
    order: 787,
    orderBy: ['loan_id', 'reference_id', 'schedule_version'],
  },
  // add-credit-cards (órdenes 788–796): tarjetas, versiones de términos, cuentas, estados de cuenta, planes de cuotas,
  // umbrales y recordatorios. Los ids de cuentas, de la definición del plan de pago y de las compras se remapean al importar.
  {
    name: 'credit-cards',
    context: 'debt',
    table: 'debt.credit_card',
    order: 788,
    orderBy: ['id'],
    money: { shared_limit_amount: 't.shared_limit_currency' },
  },
  {
    name: 'credit-card-terms',
    context: 'debt',
    table: 'debt.credit_card_terms',
    order: 789,
    orderBy: ['card_id', 'seq'],
    idColumns: [],
  },
  {
    name: 'credit-card-accounts',
    context: 'debt',
    table: 'debt.credit_card_account',
    order: 790,
    orderBy: ['card_id', 'currency'],
    money: {
      credit_limit_amount: 't.currency',
      minimum_floor_amount: 't.currency',
      minimum_amount: 't.currency',
    },
  },
  {
    name: 'card-statements',
    context: 'debt',
    table: 'debt.card_statement',
    order: 791,
    orderBy: ['card_account_id', 'closing_date'],
    money: {
      previous_balance: 't.currency',
      purchases: 't.currency',
      refunds: 't.currency',
      payments: 't.currency',
      other_net: 't.currency',
      closing_balance: 't.currency',
      unbilled_installments: 't.currency',
      billed_balance: 't.currency',
      minimum_due: 't.currency',
      reported_billed_balance: 't.currency',
      reported_minimum_due: 't.currency',
    },
  },
  {
    name: 'card-installment-plans',
    context: 'debt',
    table: 'debt.card_installment_plan',
    order: 792,
    orderBy: ['card_account_id', 'created_at', 'id'],
    money: { principal: 't.currency' },
  },
  {
    name: 'card-installments',
    context: 'debt',
    table: 'debt.card_installment',
    order: 793,
    orderBy: ['plan_id', 'n'],
    idColumns: [],
    money: { principal: CARD_PLAN_CURRENCY, interest: CARD_PLAN_CURRENCY, total: CARD_PLAN_CURRENCY },
  },
  {
    name: 'card-utilization-states',
    context: 'debt',
    table: 'debt.card_utilization_state',
    order: 794,
    orderBy: ['card_id', 'scope_key', 'threshold'],
    idColumns: [],
    textRefs: ['scope_key'],
  },
  {
    name: 'card-utilization-crossings',
    context: 'debt',
    table: 'debt.card_utilization_crossing',
    order: 795,
    orderBy: ['card_id', 'scope_key', 'threshold', 'crossing_no'],
    idColumns: [],
    textRefs: ['scope_key'],
  },
  {
    name: 'card-reminders',
    context: 'debt',
    table: 'debt.card_reminder',
    order: 796,
    orderBy: ['card_account_id', 'closing_date'],
    idColumns: [],
  },
];
