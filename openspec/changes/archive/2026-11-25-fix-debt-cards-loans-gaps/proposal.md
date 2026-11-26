# Propuesta: fix-debt-cards-loans-gaps

## Why

Tres restos de deuda técnica de `docs/38` §4 (DEBT), con comportamiento ya definido:

1. **`overdueStatements[]` incompleto en el listado de tarjetas.** La spec `debt/credit-cards` («Próximo vencimiento de la tarjeta») exige informar cada estado emitido vencido y con faltante. El listado calculaba un único ciclo cerrado, así que los estados vencidos más antiguos solo salían en el detalle.
2. **Métrica `debt_card_cycle_mismatch_total` inexistente.** El design de `add-credit-cards` (decisión 3) ordena registrarla cuando un cálculo real no cuadra; el código solo marcaba `consistent = false`.
3. **La lista de préstamos hacía 2 consultas a BD por préstamo** (cuotas y pagos). D222 («lista de préstamos sin N+1») cerró el lado web (una sola llamada); quedaba el lado de la base de datos.

## What Changes

- `CardsQueries.list` usa la misma ventana de ciclos que el detalle (`historyCycles`).
- `CardDeps.metrics` (opcional) y contador `debt_card_cycle_mismatch_total` en `CardEngine.loadAccountView`; cableado con `otelCounters('@pf/debt')` en `identity-wiring.ts`.
- `ScheduleRepository.installmentsForLoans` y `PaymentRepository.paidByInstallmentForLoans`: lectura en lote (una consulta cada una); `LoansQueries.list` las usa.
- Sin cambios de contrato OpenAPI, eventos, migraciones ni specs.

## Capabilities

### Modified Capabilities

- Ninguna: el comportamiento ya está en `debt/credit-cards` y en D222; el change lo hace cumplir.

## Impact

**Specs:** ninguna. **Componentes:** `@pf/debt`, `apps/api` (cableado). **APIs, eventos, tablas y migraciones:** ninguno. **Test cases:** AÑADIDOS TC-DEBT-CARD-041, TC-DEBT-CARD-042 y TC-DEBT-LOAN-055.

**Riesgos:** el listado de tarjetas calcula hasta 12 ciclos por tarjeta (ya lo hace el detalle); las lecturas de saldos y movimientos son una por cuenta, no por ciclo. El contador se incrementa en cada cálculo descuadrado (también en lecturas): es una señal de existencia, no un conteo de ciclos distintos.
