# Propuesta: add-loan-amortization-advanced

## Why

`add-loans` cubre el núcleo Must de Phase 4 para préstamos (French, desglose, pagos, compromisos, comparación con la tabla del banco), pero los préstamos reales del owner no siempre son franceses de tasa fija sin prepagos: hay créditos de capital constante (alemán), créditos con capital fijo y cuota final balloon, tablas del banco que no se pueden reproducir con una fórmula y que deben **prevalecer** sobre el cálculo, pagos extraordinarios que obligan a elegir entre reducir el plazo o la cuota, y tasas variables que cambian con vigencia. Además, la pregunta "¿conviene adelantar pagos y a qué deuda?" no tiene respuesta hoy. FR-DEBT-004, 005, 008, 009 y 010 (docs/01 §10, Should, Phase 4; US-167..171 de docs/25) piden German y fixed principal, cronograma custom cargado o importado que prevalece, pagos extraordinarios con nueva versión del cronograma conservando la anterior, cambios de tasa con recálculo de cuotas futuras y un payoff simulator con escenarios y estrategias avalanche/snowball sin persistir. docs/24 §5.4 los incluye en el alcance de la fase y advierte RISK-005 (sobre-modelar amortización).

## What Changes

- **Sistema alemán** (capital constante, cuota decreciente) y **capital fijo** con principal por cuota del usuario y **cuota final balloon**, con las mismas reglas de redondeo (HALF_EVEN, residuo en la última, Σ principal = principal).
- **Cronograma custom**: cargado cuota por cuota o **adoptado de la tabla del banco** ya cargada como referencia en `add-loans`; validado (Σ principal exacto, fechas crecientes, escala) y **prevaleciente**: pagos, diferencias, compromisos y saldo usan las cuotas custom y el sistema no las recalcula.
- **Cronograma versionado**: todo recálculo crea una versión nueva con motivo, vigencia y parámetros que reemplaza solo las cuotas no pagadas; las versiones anteriores quedan consultables; los pagos imputados nunca se mueven.
- **Pagos extraordinarios** con opción **reducir plazo** (misma cuota, menos cuotas) o **reducir cuota** (mismas fechas, cuota menor), comisión por prepago opcional como gasto, vista previa de ambas opciones con el ahorro de interés, anulación que restituye el cronograma previo como versión nueva, y compromisos de cuotas actualizados.
- **Tasa variable**: cambios de tasa con fecha de vigencia e historial; recálculo de las cuotas cuyo periodo empieza desde la vigencia, conservando número y fechas.
- **Payoff simulator** sin persistencia: extra único o recurrente en un préstamo (interés total, fecha de fin, ahorro) y estrategias **avalanche** y **snowball** con un extra mensual entre préstamos de la misma moneda (rollover de cuotas liberadas, fecha libre de deudas, ahorro frente a no pagar extra).
- **API** (operaciones nuevas bajo `W/loans`) y **UI** (Deudas → Préstamo: prepago, cambio de tasa, cronograma custom, historial de versiones; Deudas → Simulador).
- **Fuera de alcance:** tarjetas de crédito en el simulador (pregunta 5), simulaciones guardadas, estrategias personalizadas (orden manual), refinanciación (nuevo préstamo que cierra otro), recálculo automático de préstamos custom, prorrateo de interés por días dentro del periodo si no se aprueba la pregunta 1, cambios de plazo pactados sin prepago (reestructuración), conversión de moneda en el simulador.

## Capabilities

### New Capabilities
- Ninguna (las capabilities `debt/loans` y `debt/amortization` las crea `add-loans`).

### Modified Capabilities
- `debt/amortization`: alemán, capital fijo con balloon, custom manual e importado, prevalencia del custom, prepago reduciendo plazo o cuota, versiones sin reescribir pagadas, vista previa del recálculo, tasa variable, simulador de extra, avalanche/snowball y simulación sin efectos (13 requirements ADDED: 13 Should).
- `debt/loans`: sistemas habilitados, registrar y anular un pago extraordinario, compromisos actualizados con la nueva versión (4 requirements ADDED: 4 Should).

## Impact

**Specs impactadas:** agrega requirements a `debt/amortization` y `debt/loans` (creadas por `add-loans`). Lee `commitments/recurrence-engine` (reemplazo del calendario explícito), `transactions/transaction-recording`, `planning/financial-periods`, `audit/audit-trail`, `audit/lifecycle-timeline` (anotaciones de versión en el recorrido del préstamo), `security/access-control`.

**Componentes/contextos impactados:** DEBT: `AmortizationCalculator` (estrategias `GERMAN`, `FIXED_PRINCIPAL`, `CUSTOM`), `ScheduleRecalculator` (prepago reduciendo plazo o cuota, cambio de tasa, adopción de custom, restitución), `PayoffSimulator` (escenarios y estrategias), `CustomScheduleValidator`; entidad `RateChange`; comandos `DefineCustomSchedule`, `AdoptReferenceSchedule`, `RecordPrepayment`, `VoidLoanPayment` (extendido a prepagos), `ChangeLoanRate`; queries `PreviewRecalculation`, `ListScheduleVersions`, `SimulatePayoff`. TRANSACTIONS: `LoanTransactionsPort.recordPayment` con pago solo de principal + comisión (sin cambio de contrato si `add-loans` ya admite componentes en cero). COMMITMENTS: `RecurringDefinitionPort.replaceSchedule` (previsto en `add-loans`, N3). `apps/api`, `apps/web`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `PUT W/loans/{id}/custom-schedule`, `POST …/{id}/custom-schedule/adopt`, `POST …/{id}/prepayments`, `POST …/{id}/prepayments/preview`, `POST …/{id}/rate-changes`, `POST …/{id}/rate-changes/preview`, `GET …/{id}/rate-changes`, `GET …/{id}/schedule-versions`, `POST W/loans/payoff-simulations`; `LoanMethod` habilita `GERMAN`, `FIXED_PRINCIPAL`, `CUSTOM`. Códigos nuevos: `CUSTOM_SCHEDULE_INVALID` (422), `LOAN_SCHEDULE_IS_CUSTOM` (409), `LOAN_INSTALLMENTS_PENDING` (409), `LOAN_RATE_FIXED` (409), `LOAN_CHANGE_DATE_INVALID` (422). Aditivo.

**Tablas impactadas:** `debt.loan` (columna `fixed_principal_amount`, `method` ya admite los cuatro valores), `debt.loan_schedule_version` (motivos `PREPAYMENT`, `PREPAYMENT_VOIDED`, `RATE_CHANGE`, `CUSTOM_DEFINED`, `CUSTOM_ADOPTED`), `debt.loan_installment` (versiones nuevas, append-only), `debt.loan_payment` (columna `kind REGULAR|PREPAYMENT`, `prepayment_option`, `prepayment_fee`), nueva `debt.loan_rate_change` (append-only); `commitments.recurring_definition` (versiones nuevas del calendario explícito).

**Eventos impactados:** produce `debt.LoanScheduleGenerated.v1` con `reason` `PREPAYMENT|PREPAYMENT_VOIDED|RATE_CHANGE|CUSTOM_DEFINED|CUSTOM_ADOPTED` (valores nuevos del enum, aditivo), `debt.LoanPaymentRecorded.v1` con `kind: PREPAYMENT` (campo opcional nuevo), `debt.LoanRateChanged.v1` (**nuevo**) y `debt.LoanPaidOff.v1` cuando un prepago salda. Sin consumidores nuevos.

**Migraciones requeridas:** expand, no destructiva: columnas nullable con default en `debt.loan` y `debt.loan_payment`, CHECK de `reason` ampliado, tabla `debt.loan_rate_change` con RLS forzada y `forbid_mutation`; registro en el manifiesto de export.

**Test cases:** AÑADIDOS — TC-DEBT-AMORT-021..044 (24) y TC-DEBT-LOAN-046..052 (7). MODIFICADOS — TC-DEBT-LOAN-003 (el alemán deja de rechazarse con `LOAN_METHOD_NOT_AVAILABLE` al aplicarse este change: pasa a `deprecated` y lo reemplaza TC-DEBT-LOAN-046). DEPRECADOS — TC-DEBT-LOAN-003.

**Impacto de regresión:** los préstamos franceses de tasa fija sin prepagos no cambian (TC-DEBT-AMORT-001..020 y TC-DEBT-LOAN-001..045 en verde salvo TC-DEBT-LOAN-003); el reemplazo de calendario en COMMITMENTS no toca ocurrencias resueltas (TC-COMMITMENTS-* y TC-REPORTING-UPCOMING-* en verde).

**Riesgos introducidos:** RISK-005 (sobre-modelar amortización: simulador sin persistencia, sin estrategias personalizadas, custom sin recálculo), RISK-001 (redondeo en recálculos y simulación; mismas reglas y PBT), RISK-020 (vigencias y fechas de prepago en la TZ del workspace).

**Invariantes afectadas:** INV-001, INV-002, INV-004, INV-008 (anular un prepago por reversa), INV-013 (ocurrencias del calendario reemplazado), INV-016 (pago de prepago = principal + comisión), INV-017 (Σ principal de cada versión = principal pendiente en su vigencia), INV-025, INV-029, INV-030.
