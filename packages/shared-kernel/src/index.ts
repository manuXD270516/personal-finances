/**
 * @pf/shared-kernel — tipos y value objects compartidos por TODOS los contextos (ADR-0003).
 * Regla: sin dependencias de frameworks ni de I/O (dependency-cruiser `domain-no-framework`/`shared-kernel-pure`).
 *
 * Contenido (add-api-conventions): `DomainError` con `code` estable, `Money`/`Currency` (decimal.js, ADR-0006)
 * para el borde HTTP, `LocalDate` (fecha de negocio), `Instant` y `Clock`.
 */
export const SHARED_KERNEL_VERSION = '0.1.0';

export {
  DomainError,
  isDomainError,
  jsonPointer,
  pointerSegment,
  type FieldViolation,
} from './errors/domain-error.js';
export {
  currency,
  sameCurrency,
  assertSameCurrency,
  CURRENCY_CODE,
  MAX_SCALE,
  type Currency,
} from './money/currency.js';
export { MoneyDecimal, dec, type Decimal } from './money/decimal.js';
export { canonicalDecimal } from './money/canonical-decimal.js';
export { Money, MAX_INTEGER_DIGITS, type MoneyJson, type Weight } from './money/money.js';
export { Rate, RATE_PERSIST_SCALE } from './money/rate.js';
export { type RoundingMode } from './money/rounding.js';
export { Instant, FixedClock, systemClock, type Clock } from './time/instant.js';
export { LocalDate } from './time/local-date.js';
export { endOfDayInstant } from './time/end-of-day.js';
export { convertExact, present, sumByCurrency, type ExactRate } from './valuation/exact-rate.js';
export {
  FlowValuation,
  type Consolidated,
  type DatedAmount,
  type FlowRateRequest,
  type FlowRateResolverInput,
  type FlowRates,
  type FlowResolvedRate,
} from './valuation/flow-valuation.js';
export {
  LifecycleMachine,
  type LifecycleMachineDefinition,
  type LifecycleStateDefinition,
  type LifecycleTransitionDefinition,
  type StateTransition,
} from './lifecycle/lifecycle-machine.js';
export type { PortabilityExclusion, PortabilitySection } from './portability/section.js';
