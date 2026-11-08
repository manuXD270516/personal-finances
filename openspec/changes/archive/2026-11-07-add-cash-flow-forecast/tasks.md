# Tareas

> Requiere aplicados `add-upcoming-payments`, `add-spendable-amount`, `add-savings-goals`, `add-credit-cards`, `add-loans`, `add-budgets`, `add-financial-periods`, `add-alerts` y la entrega directa de `add-rate-feed-alerts` (implementada en #128). No iniciar los grupos bloqueados sin las respuestas del owner: preguntas 1 y 2 de design.md (tareas 2.6, 3.5, 3.6 y 4.3), 3 (tareas 2.1–2.3) y 10 (tarea 4.7). Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`, `pnpm test:integration` (dos veces en verde) y `pnpm test:e2e` con `PF_E2E_PROJECT`.

> **Estado (2026-11-07):** implementado en la rama `feat/add-cash-flow-forecast`. Decisiones del owner D377–D389 (docs/62) registradas; las preguntas 1–13 de design.md quedaron con la opción recomendada. Verificación: TC-REPORTING-FORECAST-001..030, TC-NOTIFICATIONS-SHORTFALL-001..004 y TC-NOTIFICATIONS-DIGEST-001..008 automatizados. Migración `20261108100000_reporting_cash_flow_forecast.sql` (también otorga a `pf_workspace_directory` la lectura de la reserva mínima para el worker). Sin consumidores ni conexiones nuevas (28 + 4 = 32 de 34). Pendiente solo la 8.3 (al archivar).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los deltas de `reporting/cash-flow-calendar`, `reporting/dashboard` y `notifications/alerts` y las preguntas 1–13 de design.md; registrar las decisiones en el doc de decisiones de Phase 7 y ajustar specs y TC; `openspec validate add-cash-flow-forecast --strict`
- [x] 1.2 Acordar con Commitments S1 (`listForCashFlow`) y S2 (`categoryId`), con Transactions S3 (`toAmount`) y con NOTIFY la ampliación de `NotificationIntakeType`; registrar el acuerdo en design.md
- [x] 1.3 Revisar TC-REPORTING-FORECAST-001..030, TC-NOTIFICATIONS-SHORTFALL-001..004 y TC-NOTIFICATIONS-DIGEST-001..008 contra los scenarios (cifras a mano: 4500 − 300 = 4200; −199 ⇒ 4001; −180 ⇒ 3821; +8000 ⇒ 11821; −2500 ⇒ 9321; −1120.50 ⇒ 8200.50; 1821 − 2500 = −679 ⇒ +8000 = 7321; 1500 + 679 = 2179; 3121 − 2500 = 621; 4299.50 × 10 % = 429.95; 600 / 12 = 50; 360 / 12 = 30; 3821 + 94.01 × 12 = 4949.12; 2179 / 12 = 181.5833 ⇒ 181.58; 15800 − 5000 − 2999 − 600 − 1500 = 5701; 15800 − 5000 − 2680 − 2100 − 1500 = 4520; 450 + 1200 × 5 / 30 = 650 ⇒ 3870; 5521 − 450 = 5071), fechas fijas y `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` tras las decisiones; `pnpm traceability:check` sin errores ni advertencias

## 2. DOMAIN (TDD, lógica financiera crítica)

- [x] 2.1 `CashFlowCalendar` puro test-first: saldo inicial contable, movimientos atrasados en hoy, efecto por cuenta (transferencias entre líquidas, hacia no líquidas, compras en cuentas no líquidas), orden egresos-antes-que-ingresos, saldo más bajo con primera fecha: TC-REPORTING-FORECAST-003, -004, -005, -006, -008; PBT con timeout explícito (Σ cuentas = moneda; saldo final = inicial + Σ efectos; transferencia entre líquidas neutra; un egreso más nunca sube el mínimo) *(bloqueada por la pregunta 3)*
- [x] 2.2 Certeza y montos por tipo (`MIN_MAX` máximo en egresos y mínimo en ingresos, `VARIABLE` contado sin monto): TC-REPORTING-FORECAST-007 *(pregunta 3)*
- [x] 2.3 Riesgo por moneda (umbral reserva o cero, margen 10 %, `HIGH`/`POSSIBLE`/`LOW`/`NONE`, faltante, `belowZero`), peor caso sin ingresos y consolidado con valoración (HALF_EVEN al presentar, nunca 1:1): TC-REPORTING-FORECAST-009, -010, -012, -014 *(pregunta 3)*
- [x] 2.4 Serie del gasto planificado (líneas por categoría y grupo, descuento de compromisos de esas categorías, reparto exacto por día, periodos sin plan, líneas por etiqueta excluidas): TC-REPORTING-FORECAST-011
- [x] 2.5 Cobertura del horizonte y sugerencia de conversión (Could): TC-REPORTING-FORECAST-015, -016
- [x] 2.6 `SpendableHorizon` (próximo ingreso, respaldo de 30 días, ingresos vencidos ignorados, periodos alcanzados) y término de esenciales en `SpendableCalculator` (descuento por categoría, prorrateo de periodos posteriores, avisos sin plan o sin línea): TC-REPORTING-FORECAST-022..026 *(preguntas 1, 2, 11 y 12)*
- [x] 2.7 Variación por categoría de los tops (valor, porcentaje con dos decimales, "nuevo", sentido favorable o desfavorable): TC-REPORTING-FORECAST-029
- [x] 2.8 Episodio de riesgo (abrir solo en `HIGH`, sostener sin publicar, cerrar en `NONE`/`LOW`, ignorar `POSSIBLE`): TC-REPORTING-FORECAST-018, -019

## 3. APPLICATION

- [x] 3.1 Commitments: `UpcomingPaymentsQuery.listForCashFlow` (S1) y `categoryId` en `listForSpendable` (S2) sobre las lecturas existentes; Q4/Q5/Q8 sin cambios (TC-REPORTING-UPCOMING-* y TC-REPORTING-SPENDABLE-* en verde)
- [x] 3.2 Transactions: `toAmount` en `PendingFlowQuery.listPending` para conversiones pendientes (S3)
- [x] 3.3 Reporting: `GetCashFlowCalendar` (hoy en la zona del workspace, lecturas por lote en una transacción de lectura, una resolución de tasas, serie por cuenta solo con `accountId`, validación de `horizon` y `accountId`): TC-REPORTING-FORECAST-001, -002, -013, -017, -020
- [x] 3.4 Bloque `cashFlow` del resumen del Home (30 días, tasas reutilizadas) y `variation` de los tops: TC-REPORTING-FORECAST-017, -029
- [x] 3.5 Q5 con el modo de horizonte y el detalle (`horizon`, `essentials`, `essentialItems`, `essentialWarnings`): TC-REPORTING-FORECAST-022..026 *(preguntas 1 y 2)*
- [x] 3.6 `GetSpendableSettings` / `UpdateSpendableSettings` (OWNER, versión, validación con `categoryTree`, auditoría en la misma unidad de trabajo): TC-REPORTING-FORECAST-027, -028 *(pregunta 2)*
- [x] 3.7 `EvaluateShortfallRisk` por workspace (episodio, outbox `reporting.CashFlowShortfallRiskDetected.v1`/`…Cleared.v1` y `NotificationIntakePort` en la misma transacción): TC-REPORTING-FORECAST-018, -019, TC-NOTIFICATIONS-SHORTFALL-001, -002
- [x] 3.8 NOTIFY: tipo de intake `CASH_FLOW_SHORTFALL_RISK` (OWNER y EDITOR, severidad por `belowZero`, deduplicación por episodio) y tipo `HOME_DIGEST` con la preferencia `digestFrequency` (auditada): TC-NOTIFICATIONS-SHORTFALL-001..003, TC-NOTIFICATIONS-DIGEST-001
- [x] 3.9 `HomeDigestQuery` en Reporting (un DTO por pregunta, sin cifras inventadas) y `HomeDigestSourcePort` en NOTIFY con el adapter en la composición de `apps/api`: TC-NOTIFICATIONS-DIGEST-002, -003

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: `reporting.cash_flow_shortfall_episode` (índice único parcial del episodio abierto), `reporting.spendable_setting`, `reporting.spendable_essential_category`, `notifications.user_setting.digest_frequency`; RLS forzada fail-closed, grants, registro en `platform.workspace_scoped_table` y matriz TC-SECURITY-RLS-007 ampliada; timestamp posterior a la última de `main`
- [x] 4.2 Repositorios de episodios y ajustes con tests de integración Testcontainers (aislamiento por workspace, carrera de dos evaluaciones simultáneas sin doble publicación): TC-REPORTING-FORECAST-019, -020
- [x] 4.3 Portabilidad de los ajustes del disponible (sección del export, remapeo de categorías, archivo anterior ⇒ valores por omisión) y de `digestFrequency`: TC-REPORTING-FORECAST-027, TC-NOTIFICATIONS-DIGEST-007 *(pregunta 2)*
- [x] 4.4 Job `reporting.cash-flow-watch` (cron `REPORTING_CASH_FLOW_WATCH_CRON`, corrida al arrancar, `REPORTING_SHORTFALL_ALERT_HORIZON_DAYS`, workspaces de a uno, sin consultas en paralelo sobre el mismo cliente, purga de episodios cerrados > 400 días) con test de integración del worker: TC-REPORTING-FORECAST-018, -019
- [x] 4.5 Job `notifications.digest` (cron `NOTIFICATIONS_DIGEST_CRON`, ventana semanal o del periodo, una composición por workspace, fila `ARCHIVED` + entrega `EMAIL`, silencio, supresión por entorno, sin envío atrasado fuera de la ventana): TC-NOTIFICATIONS-DIGEST-002, -003, -005, -006
- [x] 4.6 Presupuesto de conexiones: TC-PLATFORM-THROUGHPUT-009 y TC-NOTIFICATIONS-FX-009 siguen en verde (28 consumidores, 28 + 4 = 32 de 34; ninguna cola `events.reporting.*` ni `events.notifications.*` nueva)
- [x] 4.7 Plantillas es/en/pt del riesgo de déficit y del digest (sin montos sin opt-in; porcentajes, cantidades, estados y fechas según la pregunta 10; formatos del locale; respaldo en español) con Mailpit de Testcontainers: TC-NOTIFICATIONS-SHORTFALL-003, -004, TC-NOTIFICATIONS-DIGEST-004, -008 *(pregunta 10)*
- [x] 4.8 Métrica `reporting_cash_flow_calendar_duration_seconds`, expresión ampliada de `UpcomingPaymentsReadModelRecommended` y variables nuevas en `docs/config-reference.md` (`pnpm config:docs:check`)

## 5. API

- [x] 5.1 `GET W/reports/cash-flow-calendar`, `GET`/`PUT W/reports/spendable/settings`, `ReportSummary.cashFlow`, `SpendableSummary.horizon`, `SpendableCurrencyTerms.essentials`, `variation`, `NotificationType`/`NotificationLink.kind` y `digestFrequency` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio); esquemas de eventos en `contracts/events/reporting/`: TC-REPORTING-FORECAST-001, -013, -020, -027, -028
- [x] 5.2 Benchmark nightly del calendario de 90 días (40 cuentas líquidas, 300 ocurrencias; p95 ≤ 500 ms, fila con timeout explícito) y verificación de que el resumen del Home sigue ≤ 300 ms p95 con el bloque `cashFlow`: TC-REPORTING-FORECAST-021

## 6. UI

- [x] 6.1 Vista `/flujo-de-caja`: selector 7/30/60/90, gráfico de saldo esperado por moneda con el umbral y la serie del plan, peor caso sin ingresos, eventos por día con certeza y vencidos, cuentas con su mínimo, cobertura, consolidado con tasas y atribución, sugerencias; tabla accesible equivalente al gráfico; i18n es/en/pt: TC-REPORTING-FORECAST-001, -013, -014
- [x] 6.2 Tarjeta Q8 del Home con el saldo más bajo esperado y el riesgo de 30 días y el enlace al calendario; tarjeta Q5 con el horizonte y el término de esenciales; Q7 con la variación por categoría: TC-REPORTING-FORECAST-017, -022, -029
- [x] 6.3 Ajustes del disponible (OWNER edita, demás leen) y preferencia de frecuencia del digest en la pantalla de preferencias: TC-REPORTING-FORECAST-027, -028, TC-NOTIFICATIONS-DIGEST-001

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test; actualizar el front matter (`automated_tests`, `automation_status`, `status`)
- [x] 7.2 E2E del checklist SM-05 sobre el dataset Demo v2: las nueve tarjetas con cifras, Q8 con saldo más bajo y riesgo, Q7 con variación por categoría; calendario de 30 días navegable; omitir una ocurrencia y ver el cambio inmediato: TC-REPORTING-FORECAST-030, -020
- [x] 7.3 Test de integración de punta a punta de la alerta: datos con déficit, corrida del job, notificación del OWNER y del EDITOR (no del VIEWER), email sin montos en Mailpit, segunda corrida sin duplicados: TC-NOTIFICATIONS-SHORTFALL-001..003

## 8. DOCUMENTATION

- [x] 8.1 Aplicar design.md § "Cambios a docs compartidos" (docs/00, 01, 03, 08, 10, 11, 14, 17, 18, 26, 28, 38 y config-reference)
- [x] 8.2 Actualizar la matriz de trazabilidad; ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
- [x] 8.3 Al archivar, actualizar el `## Purpose` de `reporting/cash-flow-calendar` (deja de decir que el calendario "llega en Phase 7") *(2026-11-07: hecho al archivar)*
