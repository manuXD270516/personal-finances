# Propuesta: add-budget-overrun-risk

## Why

US-249 pide un aviso temprano del riesgo de exceder un presupuesto antes de fin de mes. Lo demás de FEAT-26.3 ya existe: las metas en riesgo (estado `BEHIND`) y el déficit proyectado (calendario de flujo de caja, Phases 7 y 8). El plan ya muestra una proyección lineal por línea (FR-PLANNING-024), pero extrapola también las facturas ya pagadas, ignora las que vienen y no avisa. D478 (la recomendación aplicada por omisión, según la convención de docs/76) define un change solo para este riesgo: la proyección de la línea al fin del periodo con el ritmo del periodo, los pagos conocidos pendientes y, si está habilitada, la banda del pronóstico; visible en el plan y en el Home, con un aviso apagado por omisión y textos por plantilla. D471 agrega FR-REPORTING-020 a docs/01 y D472 lo ubica como change 74 de Phase 9.

## What Changes

- **Riesgo por línea** (`reporting/predictive-insights`) para las líneas de gasto de categoría o grupo de tipo máximo, rango o porcentaje de ingresos del periodo en curso:
  - Proyección = gastado + pagos conocidos pendientes + gasto variable restante.
  - El gasto variable restante sale del ritmo del periodo (sin extrapolar lo pagado por compromisos) o, con un pronóstico vigente de la categoría, del esperado del periodo.
  - Riesgos posibles: «probable», «posible» (solo con la banda del pronóstico), «improbable», «excedida» o no disponible con el motivo (tipo de línea, sin referencia, sin plan o faltan datos con menos de 7 días).
  - Cada riesgo lleva la fecha estimada del exceso.
- **Plan del periodo:** el riesgo, la proyección y la fecha por línea, sin cambiar ninguna cifra del plan.
- **Home (Q5):** hasta 3 líneas en riesgo «probable», ordenadas por fecha estimada.
- **Aviso** de tipo riesgo de presupuesto: una vez por línea y periodo al pasar a «probable», si no cruzó el 100 %; desactivado por omisión; emails sin montos salvo opt-in. Se evalúa dentro de `reporting.cash-flow-watch`, sin consumidores ni conexiones nuevas (D249).
- **Fuera de alcance:** cambiar la proyección lineal existente del plan (FR-PLANNING-024 queda igual); un panel general de insights (opción b de la pregunta 14); metas en riesgo y déficit, que ya existen; automatizaciones (D479); textos por LLM.

## Capabilities

### New Capabilities
- `reporting/predictive-insights`: 10 ADDED. Riesgo por línea, pagos conocidos, banda del pronóstico, fecha estimada, líneas sin riesgo calculable, riesgo en el plan, textos, evaluación sin consumidores nuevos, permisos y aislamiento, y rendimiento.

### Modified Capabilities
- `reporting/dashboard`: 1 ADDED. Líneas en riesgo en la tarjeta de Q5.
- `notifications/alerts`: 2 ADDED. Aviso de riesgo de presupuesto desactivado por omisión, y emails sin montos salvo opt-in, en los tres idiomas.

## Impact

**Specs impactadas:** `reporting/predictive-insights` (nueva, 10 ADDED), `reporting/dashboard` (1 ADDED) y `notifications/alerts` (2 ADDED). Lee sin modificar: `planning/budgets` (presupuesto vs real y umbrales), `commitments/recurrence-engine` (ocurrencias pendientes y resueltas) y `forecast/expense-forecasting` (pronóstico vigente; changes 64 y 65). docs/03 §7 proponía tocar `planning/budgets`; no hace falta, porque el riesgo es una lectura de REPORTING superpuesta al plan (decisión 1 del design).

**Componentes/contextos impactados:**
- REPORTING: DS puro `BudgetOverrunProjector` (proyección, niveles, fecha y motivos), consulta `GetBudgetOverrunRisk` y el paso de avisos dentro de `reporting.cash-flow-watch`.
- REPORTING lee `BudgetVsActualQuery` y `PeriodQuery` de PLANNING, las ocurrencias de COMMITMENTS y `LatestForecastQuery` de FORECAST, todo por contratos ya usados.
- NOTIFICATIONS: hecho `BudgetOverrunRiskFact` en el puerto en proceso y tipo `BUDGET_OVERRUN_RISK`, desactivado por omisión.
- `apps/web`: plan del periodo, tarjeta Q5 y preferencias, con i18n es/en/pt.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo):
- Endpoint nuevo `GET /workspaces/{workspaceId}/periods/{periodId}/budget-risk`, con los esquemas `BudgetRisk` y `BudgetLineRisk`.
- `ReportSummary.budgetRisk` (opcional, nullable).
- `NotificationType` suma `BUDGET_OVERRUN_RISK` y reutiliza `NotificationLink.kind = BUDGET_LINE`.
- Sin códigos de error nuevos.

**Tablas impactadas:** `reporting.budget_overrun_notice` (nueva, RLS forzada, registrada en `platform.workspace_scoped_table`).

**Eventos impactados:** ninguno (la notificación usa el puerto en proceso, en la misma unidad de trabajo).

**Migraciones requeridas:** una migración expand que crea `reporting.budget_overrun_notice`.

**Test cases:** AÑADIDOS: TC-REPORTING-INSIGHT-001..019 (19) y TC-NOTIFICATIONS-BUDGETRISK-001..005 (5). MODIFICADOS: ninguno. DEPRECADOS: ninguno.

**Impacto de regresión:**
- `reporting.cash-flow-watch` suma un paso por workspace: su duración se vigila y el riesgo de déficit, los episodios y la alerta no cambian (TC-REPORTING-FORECAST-018/019 en verde).
- El resumen del Home suma una lectura del plan, de los compromisos y del pronóstico (NFR-PERF-004, TC-REPORTING-INSIGHT-017).
- Los umbrales y la proyección del plan no cambian (TC-PLANNING-THRESHOLD-* en verde).

**Riesgos introducidos:**
- RISK-015 (confianza indebida): textos de tendencia y «posible» solo con la banda.
- Avisos de más: apagado por omisión, uno por línea y periodo, y ninguno si ya se cruzó el 100 %.
- Proyecciones ruidosas a comienzo de mes: no disponible con menos de 7 días sin pronóstico.
- RISK-017: pagos conocidos sin tasa fuera, con la marca de incompleta.

**Invariantes afectadas:** INV-001 e INV-020 (Decimal y HALF_EVEN al mostrar). Ninguna escritura en el ledger ni en el plan.
