import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

export const EXCHANGE_RATE_STATUSES = ['RECORDED', 'SUPERSEDED'] as const;
export type ExchangeRateStatus = (typeof EXCHANGE_RATE_STATUSES)[number];
export const EXCHANGE_RATE_TRANSITIONS = ['RECORD', 'SUPERSEDE'] as const;
export type ExchangeRateTransition = (typeof EXCHANGE_RATE_TRANSITIONS)[number];
export type ExchangeRateTransitionRecord = StateTransition<ExchangeRateStatus, ExchangeRateTransition>;

/**
 * Máquina `ExchangeRate` para tasas MANUALES (openspec add-lifecycle-timeline, decisión 4; INV-011): la tasa nunca se
 * modifica; corregirla registra una versión nueva y la original pasa a `SUPERSEDED` enlazada a la que la reemplazó.
 * Los estados de revisión de anomalías de tasas de provider los declarará su change con el mismo mecanismo.
 */
export const EXCHANGE_RATE_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'ExchangeRate',
  machineVersion: 1,
  states: [
    { code: 'RECORDED', terminal: false },
    { code: 'SUPERSEDED', terminal: true },
  ],
  transitions: [
    {
      code: 'RECORD',
      from: [],
      to: ['RECORDED'],
      guard: 'valor > 0, base ≠ quote, ≤ 18 decimales',
      events: ['fx.RateRecorded.v1'],
    },
    {
      code: 'SUPERSEDE',
      from: ['RECORDED'],
      to: ['SUPERSEDED'],
      guard: 'motivo (3–500); una sola vez por versión (FX_RATE_ALREADY_SUPERSEDED)',
      events: ['fx.RateRecorded.v1'],
    },
  ],
});
