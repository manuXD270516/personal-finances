import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/** Estados del periodo financiero (FR-PLANNING-001, docs/04 §4.2; decisión 3). */
export const FINANCIAL_PERIOD_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED', 'REOPENED'] as const;
export type FinancialPeriodStatus = (typeof FINANCIAL_PERIOD_STATUSES)[number];

export const FINANCIAL_PERIOD_TRANSITIONS = ['CREATE', 'ACTIVATE', 'CLOSE', 'REOPEN'] as const;
export type FinancialPeriodTransition = (typeof FINANCIAL_PERIOD_TRANSITIONS)[number];
export type FinancialPeriodTransitionRecord = StateTransition<
  FinancialPeriodStatus,
  FinancialPeriodTransition
>;

/**
 * Máquina `FinancialPeriod` (decisión 4; docs/31 D37). Única fuente de las transiciones del periodo: el agregado valida
 * contra ella. `CLOSE`/`REOPEN` las implementa `add-month-closing` (checklist, orden, rol OWNER, eventos). El recálculo de rango de un DRAFT es una anotación del recorrido, no una transición.
 * El tipo de agregado sigue la convención PascalCase de `audit.lifecycle_transition` (`^[A-Z][A-Za-z]*$`).
 */
export const FINANCIAL_PERIOD_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'FinancialPeriod',
  machineVersion: 1,
  states: [
    { code: 'DRAFT', terminal: false },
    { code: 'ACTIVE', terminal: false },
    { code: 'CLOSED', terminal: false },
    { code: 'REOPENED', terminal: false },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['DRAFT', 'ACTIVE'],
      guard: 'ACTIVE si el inicio ≤ hoy en la zona del workspace; DRAFT si es futuro',
      events: [],
    },
    {
      code: 'ACTIVATE',
      from: ['DRAFT'],
      to: ['ACTIVE'],
      guard: 'inicio ≤ hoy en la zona del workspace (PERIOD_NOT_STARTED)',
      events: ['planning.PeriodActivated.v1'],
    },
    {
      code: 'CLOSE',
      from: ['ACTIVE', 'REOPENED'],
      to: ['CLOSED'],
      guard:
        'estado ACTIVE|REOPENED, periodo anterior cerrado (PERIOD_PREVIOUS_NOT_CLOSED), fin anterior a hoy en la zona del workspace (PERIOD_NOT_ENDED), sin ítems bloqueantes y advertencias reconocidas',
      events: ['planning.MonthClosed.v1'],
    },
    {
      code: 'REOPEN',
      from: ['CLOSED'],
      to: ['REOPENED'],
      guard: 'rol OWNER, motivo de 1 a 500 caracteres y siguiente periodo no cerrado (PERIOD_NEXT_CLOSED)',
      events: ['planning.PeriodReopened.v1'],
    },
  ],
});
