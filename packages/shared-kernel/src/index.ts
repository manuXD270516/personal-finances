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
export { currency, sameCurrency, CURRENCY_CODE, MAX_SCALE, type Currency } from './money/currency.js';
export { MoneyDecimal, dec, type Decimal } from './money/decimal.js';
export { Money, MAX_INTEGER_DIGITS, type MoneyJson } from './money/money.js';
export { Instant, FixedClock, systemClock, type Clock } from './time/instant.js';
export { LocalDate } from './time/local-date.js';
