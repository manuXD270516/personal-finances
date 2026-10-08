/**
 * Valoración exacta de montos: vive en `@pf/shared-kernel` desde add-budgets (docs/33 D109: `FlowValuation` compartida
 * por Reporting y Planning). Se re-exporta aquí para conservar los imports del contexto.
 */
export { convertExact, present, sumByCurrency, type ExactRate } from '@pf/shared-kernel';
