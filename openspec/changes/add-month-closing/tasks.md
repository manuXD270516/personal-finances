# Tareas

> Requiere `add-financial-periods` aplicado y, para el criterio de salida de Phase 2, la reconciliación completa de pf-p2c (`ReconciliationStatusQuery`, rechazo de cambios de conciliación en periodos cerrados). No iniciar sin respuesta del owner a P-A7 (ADR-0028) y P-A8; el resto de preguntas abiertas pueden implementarse con su recomendación. El evaluador del checklist, el constructor del snapshot (montos, consolidación, redondeo) y la barrera por rango del ledger son lógica financiera crítica: **test-first (TDD)**, primero el test rojo nombrado con su TC-id.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar `specs/planning/month-closing/spec.md`, el delta de `ledger/journal-posting` y el de `audit/lifecycle-timeline` con el owner; cerrar P-A7..P-A17 y pasar ADR-0028 a `Aceptado` (o aplicar su Opción 2); verificar con `pnpm spec:validate`
- [ ] 1.2 Confirmar los 27 TC AÑADIDOS de proposal.md (`requirement_status: confirmed`, `status: ready`) y verificar que TC-LEDGER-PERIOD-001/002 siguen enlazando sus scenarios del requirement modificado; `pnpm traceability:check` sin errores
- [ ] 1.3 Consolidar en `contracts/` los cambios de design.md §Contratos (OpenAPI, `MonthClosed.v1`, `PeriodReopened.v1`); verificar Spectral y `oasdiff` sin cambios incompatibles
- [ ] 1.4 Acordar con pf-p2c y pf-p2b los contratos internos de design.md (`ReconciliationStatusQuery.getCoverage`, rechazo `PERIOD_CLOSED` en conciliación, `BudgetVsActualQuery.getForPeriod`) y registrarlos en sus design.md

## 2. DOMAIN (TDD)

- [ ] 2.1 TDD: `CloseChecklistEvaluator` (ítems, severidades por política, `NOT_AVAILABLE`, veredicto bloqueado/advertencias/limpio); tests `[TC-PLANNING-CHECKLIST-001]`, `[TC-PLANNING-CHECKLIST-002]`, `[TC-PLANNING-CLOSE-002]`, `[TC-PLANNING-CLOSE-003]` (dominio)
- [ ] 2.2 TDD: regla de cuenta conciliada al fin del periodo y cuentas exigidas; test `[TC-PLANNING-CHECKLIST-003]` (dominio)
- [ ] 2.3 TDD: `FinancialPeriod.close/reopen` (estado, orden, terminado con `Clock.today(tz)`, motivo); tests `[TC-PLANNING-CLOSE-004]`, `[TC-PLANNING-CLOSE-005]`, `[TC-PLANNING-REOPEN-003]` (dominio)
- [ ] 2.4 TDD: `CloseSnapshotBuilder` (saldos exactos, consolidados con una sola cuantización HALF_EVEN, tasa de ahorro con un decimal, patrimonio incompleto, bloques no disponibles) y `SnapshotDiff`; tests `[TC-PLANNING-SNAPSHOT-001]`, `[TC-PLANNING-RECLOSE-002]`; propiedad: Σ saldos valorizados del snapshot = patrimonio para tasas aleatorias (INV-031)
- [ ] 2.5 TDD: barrera por rango en el dominio del ledger (`isLocked(date)`, lock abierto hacia atrás, `firstOpenDateOnOrAfter`); test `[TC-LEDGER-PERIOD-003]` (dominio) y regresión `[TC-LEDGER-PERIOD-001]`

## 3. APPLICATION

- [ ] 3.1 `GetCloseChecklist` con `TransactionsClosingQuery`, `ReconciliationStatusQuery` y `ClosingPolicyRepository`; `GetClosingPolicy`/`UpdateClosingPolicy` (OWNER, auditado); tests de aplicación con fakes `[TC-PLANNING-CHECKLIST-001]`, `[TC-PLANNING-CHECKLIST-002]`
- [ ] 3.2 `CloseMonth` con la secuencia atómica de design.md decisión 5 (lock exclusivo vía `LedgerPeriodLockPort`, checklist dentro de la transacción, snapshot, auditoría, recorrido, outbox); tests `[TC-PLANNING-CLOSE-001]` (incluye falla inyectada), `[TC-PLANNING-EXIT-001]` (con fakes de conciliación)
- [ ] 3.3 `ReopenPeriod` (OWNER, motivo, orden inverso, `unlockPeriod`, `period_reopening`, outbox) y re-cierre con `close_no + 1`; tests `[TC-PLANNING-REOPEN-001]`, `[TC-PLANNING-REOPEN-002]`, `[TC-PLANNING-RECLOSE-001]`
- [ ] 3.4 Queries `ListCloseSnapshots`, `GetCloseSnapshot`, `CompareCloseSnapshots`, `GetCloseReport` (MoM) y `ExportCloseReport` (CSV/PDF con el renderizador de `add-lifecycle-timeline`); tests `[TC-PLANNING-REPORT-001]`, `[TC-PLANNING-REPORT-002]`, `[TC-PLANNING-REPORT-003]`
- [ ] 3.5 TRANSACTIONS: `TransactionsClosingQuery` (pendientes, duplicados abiertos, sin categoría por rango) e implementación de `VoidRequest.correctInCurrentPeriod` con `firstOpenDateOnOrAfter`; tests `[TC-PLANNING-LOCK-001]` (anulación corregida)
- [ ] 3.6 REPORTING: `PeriodFlowsQuery` (rango) y `NetWorthQuery` (`asOf`) aceptando la transacción del llamador, sin cambiar `GET /reports/summary`; tests de regresión de `reporting/dashboard` y `reporting/net-worth` en verde

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración *expand/contract* de `ledger.period_lock` por rango y nueva `ledger.assert_period_open()` (ADR-0028); tests de BD con `pf_app`: `[TC-LEDGER-PERIOD-003]` (día de inicio 25 y lock abierto hacia atrás, inserción directa), regresión `[TC-LEDGER-PERIOD-002]`
- [ ] 4.2 `LedgerPeriodLockPort` con candado consultivo exclusivo y rango; test de concurrencia con dos conexiones reales `[TC-PLANNING-LOCK-002]`; `[TC-PLANNING-LOCK-003]` (fechas anteriores al primer periodo cerrado y `EnsurePeriods` sin retroactividad)
- [ ] 4.3 Migración *expand* de `planning.closing_policy`, `close_snapshot`, `close_snapshot_balance`, `period_reopening` (WS-RO con `forbid_mutation`, RLS `ENABLE/FORCE`, grants); test de BD `[TC-PLANNING-SNAPSHOT-002]` (`UPDATE`/`DELETE` rechazados) y test de catálogo RLS
- [ ] 4.4 Repositorios append-only con validación del contenido `jsonb` contra el schema interno `close-snapshot-content.v1` (montos solo como string decimal) y `content_sha256`; tests de integración `[TC-PLANNING-SNAPSHOT-001]` (ida y vuelta exacta de montos)
- [ ] 4.5 Verificador `planning.verify-closings` (saldos del snapshot vigente = Σ postings a `periodEnd`, hash, un lock por periodo `CLOSED`) con métrica `planning_closing_violations_total{check}`; test de integración con corrupción simulada
- [ ] 4.6 Purga del workspace demo (ADR-0026) y export de workspace (pf-p2c) con las tablas nuevas; verificar con TC-IDENTITY-DEMO-005 y el *round-trip* de pf-p2c

## 5. API

- [ ] 5.1 Endpoints `getCloseChecklist`, `closePeriod`, `reopenPeriod`, `getClosingPolicy`, `updateClosingPolicy` con `If-Match`, `Idempotency-Key` y roles; problem+json con `blockingItems`/`warningItems`; tests de API `[TC-PLANNING-CLOSE-002]`, `[TC-PLANNING-CLOSE-003]`, `[TC-PLANNING-ROLE-002]`, `[TC-PLANNING-REOPEN-002]`
- [ ] 5.2 Endpoints de snapshots, comparación, reporte y exportación; tests de contrato (respuestas validan contra el OpenAPI, montos como string decimal) `[TC-PLANNING-REPORT-001]`, `[TC-PLANNING-REPORT-003]`
- [ ] 5.3 Tests de contrato de los productores `planning.MonthClosed.v1` y `planning.PeriodReopened.v1`; tests `[TC-PLANNING-EVENT-002]`, `[TC-PLANNING-EVENT-003]`
- [ ] 5.4 Recorrido del periodo (`GET …/periods/{id}/lifecycle` y exportación) con la máquina `FINANCIAL_PERIOD_LIFECYCLE`; test `[TC-AUDIT-PERIODLIFECYCLE-001]`
- [ ] 5.5 Mensajes i18n es/en/pt de los cinco códigos nuevos y retiro propuesto de `PERIOD_OVERLAP`/`MONTH_CLOSING_IN_PROGRESS` de docs/10 (no están en el enum del OpenAPI)

## 6. UI

- [ ] 6.1 Pantalla "Cierre de mes" (`/planificacion/periodos/{id}/cierre`): checklist con ítems bloqueantes y advertencias, enlaces a las transacciones/cuentas/duplicados, confirmación explícita de advertencias, resultado con el snapshot; deshabilitado para VIEWER; tests de componentes
- [ ] 6.2 "Reporte de cierre": versión vigente y anteriores, comparación entre versiones, MoM, exportar CSV/PDF; "Reabrir" solo para OWNER con motivo obligatorio; política de cierre en la configuración del workspace (OWNER); i18n es/en/pt; tests de componentes

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Completar los tests de todos los TC del change, marcar `automation_status: automated` y agregar a la Financial Regression Suite (`regression_suite: true`) los de bloqueo, snapshot e inmutabilidad; TC-LEDGER-PERIOD-001/002 y TC-CLASSIFICATION-RECATEGORIZE-002 en verde sin cambios
- [ ] 7.2 Tests con TZ forzada (`TZ=UTC` y `TZ=America/La_Paz`) de "periodo terminado" y del cierre a las 23:30/00:10 de La Paz (RISK-020)
- [ ] 7.3 E2E (Playwright): conciliar las cuentas de octubre (con pf-p2c), cerrar con advertencia reconocida, verificar que un gasto de octubre se rechaza, reabrir como OWNER, agregar la comisión, re-cerrar y comparar versiones; exportar CSV; páginas nuevas en `a11y.spec.ts`
- [ ] 7.4 Criterio de salida de Phase 2 (`[TC-PLANNING-EXIT-001]`): el owner cierra un mes real con todas las cuentas conciliadas a diferencia 0 y re-cierra tras una reapertura sin alterar el snapshot anterior; registrar la evidencia (fecha, periodo, versiones) en este archivo

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/08 §5.3 (`period_lock` por rango) y §5.6 (snapshots y reaperturas append-only en lugar de `month_closing`), docs/09 §10 (bloqueo por rango del periodo financiero, primer cierre abierto hacia atrás, `correctInCurrentPeriod`), docs/31 (registrar la decisión del owner sobre ADR-0028 como enmienda de D10), docs/04 §3.6/§4.2, docs/05 §2.6, docs/10 (recursos y códigos), docs/11 §3.3 (payloads de `MonthClosed`/`PeriodReopened`), docs/14 §11 (caché de periodos cerrados), docs/26 RISK-020
- [ ] 8.2 Actualizar estados de los TC, regenerar la matriz (`pnpm traceability:matrix`) y ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; verificar que pasan antes de archivar
