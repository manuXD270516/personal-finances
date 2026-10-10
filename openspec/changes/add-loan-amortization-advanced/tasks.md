# Tareas

> Requiere aplicado `add-loans` (contexto `@pf/debt`, cronograma versionado, `PaymentAllocator`, tabla del banco como referencia y `RecurringDefinitionPort.replaceSchedule`). Todos los requirements son Should: si la fase se aprieta, el change pasa entero a la siguiente (docs/24 §5.4). No cerrar el recálculo de prepagos con la pregunta 1 de design.md sin resolver.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `debt/amortization` y `debt/loans` y las preguntas abiertas 1–9 de design.md; `openspec validate add-loan-amortization-advanced --strict`
- [ ] 1.2 Revisar TC-DEBT-AMORT-021..044 y TC-DEBT-LOAN-046..052 contra los scenarios (recalcular a mano: alemán 12000.00/12 ⇒ 1120.00…1010.00, interés 780.00; capital fijo 10000.00 ⇒ 600.00, 550.00, balloon 4545.00, interés 870.00; prepago 3000.00 ⇒ reducir plazo 6 cuotas, última 1017.22, ahorro 247.49; reducir cuota 715.96, última 715.99, ahorro 151.99; tasa 15 % ⇒ 1075.36, interés cuota 7 77.24; simulador 3425.46 / 1815.57 / 2000.08 BOB); marcar TC-DEBT-LOAN-003 como `deprecated` al aplicar; `pnpm traceability:check` sin errores

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 Estrategias `GERMAN` y `FIXED_PRINCIPAL` del calculador test-first: TC-DEBT-AMORT-021, -022, -024, -025; PBT: TC-DEBT-AMORT-023
- [ ] 2.2 `CustomScheduleValidator` test-first: TC-DEBT-AMORT-026, -027
- [ ] 2.3 `ScheduleRecalculator` (precondición de frontera, reducir plazo, reducir cuota, cambio de tasa, restitución) test-first: TC-DEBT-AMORT-031, -032, -035, -037, -039, TC-DEBT-LOAN-050; PBT: TC-DEBT-AMORT-033
- [ ] 2.4 `PayoffSimulator` test-first con el cálculo de referencia independiente: TC-DEBT-AMORT-040..043
- [ ] 2.5 Entidad `RateChange` y guardas `LOAN_RATE_FIXED`, `LOAN_CHANGE_DATE_INVALID`, `LOAN_SCHEDULE_IS_CUSTOM`: TC-DEBT-AMORT-030, -038, -039

## 3. APPLICATION

- [ ] 3.1 Habilitar `GERMAN`, `FIXED_PRINCIPAL` y `CUSTOM` en `RegisterLoan`/`DisburseLoan`: TC-DEBT-LOAN-046
- [ ] 3.2 `DefineCustomSchedule` y `AdoptReferenceSchedule` (versión nueva en `ACTIVE`, prevalencia): TC-DEBT-AMORT-026..030
- [ ] 3.3 `RecordPrepayment` (UoW: transacción con principal + comisión, versión nueva, `replaceSchedule`, `PAY_OFF` si salda) y `PreviewRecalculation`: TC-DEBT-AMORT-031, -032, -034..036, TC-DEBT-LOAN-047..049, -051, -052
- [ ] 3.4 `VoidLoanPayment` para prepagos (versión `PREPAYMENT_VOIDED`, `replaceSchedule`): TC-DEBT-LOAN-050
- [ ] 3.5 `ChangeLoanRate` y su vista previa (`LoanRateChanged.v1`, historial de tasas): TC-DEBT-AMORT-037..039
- [ ] 3.6 `SimulatePayoff` (lee `LoanPortfolioQuery` y cronogramas vigentes; sin escritura ni auditoría): TC-DEBT-AMORT-040..044
- [ ] 3.7 `ListScheduleVersions` y anotaciones del recorrido del préstamo (versiones y tasas): TC-DEBT-AMORT-034

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand (`fixed_principal_amount`, motivos y columnas de `loan_schedule_version`, `kind`/`prepayment_*` de `loan_payment`, tabla `loan_rate_change` con RLS y `forbid_mutation`); tests de integración: append-only de versiones y tasas, reemplazo de ocurrencias sin tocar resueltas
- [ ] 4.2 `RecurringDefinitionPort.replaceSchedule` (si `add-loans` no lo implementó): cancelación `SUPERSEDED` de no resueltas, actualización in situ si la fecha coincide, generación de nuevas
- [ ] 4.3 Esquemas de eventos: `LoanScheduleGenerated.v1` (`reason`, `fromInstallmentNo`), `LoanPaymentRecorded.v1` (`kind`, `prepaymentOption`), `LoanRateChanged.v1` nuevo; tests de contrato
- [ ] 4.4 Portabilidad de `loan_rate_change` y columnas nuevas; round-trip con un préstamo con prepago y cambio de tasa

## 5. API

- [ ] 5.1 OpenAPI aditivo (operaciones de design.md § Contratos, `LoanMethod` habilitado, códigos nuevos); `oasdiff` sin rupturas
- [ ] 5.2 Endpoints y tests de API: TC-DEBT-AMORT-021..044, TC-DEBT-LOAN-046..052

## 6. UI

- [ ] 6.1 Alta de préstamo con sistema alemán, capital fijo (principal por cuota) y custom (grilla editable o "usar la tabla del banco cargada")
- [ ] 6.2 Pago extraordinario: formulario con vista previa comparada de ambas opciones (cuota, fin, ahorro) y comisión opcional; cambio de tasa con vista previa; historial de versiones y de tasas
- [ ] 6.3 Deudas → Simulador: escenarios de un préstamo y estrategias avalanche/snowball con tabla comparativa, gráfico de saldo total (skill dataviz) y export CSV; aviso de préstamos fuera de la estrategia
- [ ] 6.4 i18n es/en/pt y accesibilidad

## 7. TESTS / E2E

- [ ] 7.1 E2E: prepago reduciendo plazo con vista previa y verificación de las ocurrencias en próximos pagos
- [ ] 7.2 E2E: simulador avalanche vs snowball con dos préstamos demo
- [ ] 7.3 Regresión: TC-DEBT-AMORT-001..020, TC-DEBT-LOAN-001..045 (salvo -003), TC-COMMITMENTS-*, TC-REPORTING-UPCOMING-* en verde; rendimiento del simulador (10 préstamos, 600 meses, p95 < 300 ms)

## 8. DOCS

- [ ] 8.1 Aplicar los cambios de design.md § Cambios a docs compartidos (docs/01, 03, 04, 08, 10, 11, 28)
- [ ] 8.2 Matriz de trazabilidad y estados de TC (TC-DEBT-LOAN-003 `deprecated`, reemplazado por TC-DEBT-LOAN-046); `openspec validate add-loan-amortization-advanced --strict`, `pnpm traceability:check`, `pnpm format:check`
