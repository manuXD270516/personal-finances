# Diseño

## Contexto

Change 74 de Phase 9 (docs/03 §7, D472). Lo que ya existe:
- PLANNING calcula el presupuesto vs real de cada periodo en cada lectura (`BudgetVsActualQuery.getForPeriod`, INV-034), con la proyección lineal por línea (FR-PLANNING-024) y los cruces de umbral (FR-PLANNING-022), avisados por NOTIFICATIONS.
- REPORTING ya lee PLANNING, COMMITMENTS y FORECAST para el calendario de flujo de caja y el Home (changes 60 y 66), y tiene el trabajo horario `reporting.cash-flow-watch` (a los :25) que abre episodios de déficit y avisa por el puerto de notificaciones en proceso.
- FORECAST publica series por categoría con el esperado y el intervalo del 80 % cuando está habilitado (deshabilitado en N1).

Decisiones ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)): D484 (el riesgo «posible» no avisa) y D485 (la proyección lineal del plan no cambia), contestadas por el owner; D478 (un change solo para el riesgo de exceder un presupuesto, en el plan y el Home, aviso apagado por omisión, textos por plantilla), D471 (FR-REPORTING-020), D472 (alcance), D249 (sin consumidores ni conexiones nuevas). D478 y D471 son recomendaciones aplicadas por omisión según la convención de docs/76; el owner puede revertirlas antes del grupo de tareas que las usa.

## Objetivos / No objetivos

**Objetivos**
- Un riesgo por línea con proyección, nivel y fecha estimada, explicable y sin LLM.
- Mostrarlo en el plan y en el Home y avisarlo opcionalmente.
- Funcionar con los pronósticos apagados y aprovechar la banda cuando están.

**No objetivos**
- Cambiar la proyección lineal o los umbrales del plan (FR-PLANNING-022 y -024 quedan igual).
- Un panel general de insights, metas en riesgo o déficit (ya existen).
- Riesgo de periodos pasados o futuros, de líneas de ingreso o de etiqueta.

## Decisiones

1. **Dónde vive.** En REPORTING, con una capability nueva `reporting/predictive-insights` (docs/24 §5.9). REPORTING ya lee PLANNING, COMMITMENTS y FORECAST por contratos; PLANNING no puede leer FORECAST ni REPORTING sin crear un ciclo (REPORTING → PLANNING ya existe). Por eso el riesgo no se agrega a la respuesta del plan: la web lo pide aparte (`…/periods/{periodId}/budget-risk`) y lo superpone a las líneas. *Alternativa descartada:* reemplazar la proyección lineal de FR-PLANNING-024. Cambiaría cifras que el owner ya ve y obligaría a PLANNING a leer COMMITMENTS y FORECAST.

2. **Proyección (`BudgetOverrunProjector`, DS puro en REPORTING, TDD y PBT).** Datos de entrada por línea:
   - Referencia R y gastado G, de `BudgetVsActualQuery`, en la moneda del plan.
   - Lo pagado en el periodo por ocurrencias resueltas con categorías de la línea, P_res, convertido como el gastado.
   - Los pagos conocidos pendientes K_i con su vencimiento, de las ocurrencias pendientes del periodo con categorías de la línea.
   - Hoy, el primer y el último día del periodo en la zona del workspace.
   - El esperado E y el límite superior U del pronóstico, si los hay.

   Con eso, el gastado variable es G_v = max(0, G − P_res), los días transcurridos son d (incluido hoy) y los que faltan, r (sin hoy).
   - **Ritmo:** V = G_v / d × r.
   - **Pronóstico:** solo en líneas de categoría con una serie de esa categoría para el periodo en curso en la corrida vigente, aunque esté `stale`. V = max(0, E − G_v) y V_alto = max(0, U − G_v).
   - Proyección esperada: P = G + ΣK + V. Proyección alta: P_alto = G + ΣK + V_alto, solo con el pronóstico.
   - Niveles, en orden: `EXCEEDED` si G > R; `LIKELY` si P > R; `POSSIBLE` si P_alto > R; `UNLIKELY` en otro caso.
   - `NOT_AVAILABLE` con un motivo: `LINE_TYPE` (fija, mínimo), `NO_REFERENCE` (R = 0), `NO_PLAN` o `TOO_EARLY`. `TOO_EARLY` aplica sin pronóstico y con d < `REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS` (7), salvo que G + ΣK > R, que da `LIKELY` igual.
   - Todo con Decimal; los montos se materializan a la escala de la moneda del plan con HALF_EVEN.
   - El rango usa su máximo como R; el porcentaje de ingresos, su planificado efectivo (con el ingreso del periodo como hoy, sin proyectar el ingreso).
   - Sin pagos conocidos, el ritmo coincide con la proyección lineal del plan (TC-REPORTING-INSIGHT-001: 840.00, como FR-PLANNING-024).

3. **Fecha estimada.** El gasto variable restante (V para `LIKELY`, V_alto para `POSSIBLE`) se reparte por igual entre los r días que faltan. Se busca el primer día t > hoy en que G + Σ{K_i : vence ≤ t} + V/r × (días desde mañana hasta t) > R. Los K_i vencidos sin pagar se suman desde mañana. Sin fecha para `EXCEEDED`. El reparto se hace con Decimal sin redondear por día; se redondea solo para mostrar.

4. **Pagos conocidos.** Las ocurrencias pendientes (no resueltas ni omitidas) de definiciones de gasto con categoría, que vencen hasta el último día del periodo, con su monto esperado. Las de otra moneda se convierten con la tasa vigente (la misma que usa el calendario); sin tasa, se excluyen y la línea marca `projectionComplete = false`. Las cuotas de préstamos y los pagos de tarjeta no entran: no son gasto de categoría en el plan (los intereses de tarjeta de D465 sí, cuando el cargo se registra como gasto).

5. **Lectura.** `GET …/periods/{periodId}/budget-risk` y el bloque del Home se calculan en la transacción de la petición: una lectura de `BudgetVsActualQuery`, una de ocurrencias del periodo y, solo si `FORECASTING_ENABLED`, una de `LatestForecastQuery` con `scopes: ['CATEGORY']`. Para un periodo que no es el en curso, responde `status: NOT_CURRENT_PERIOD` sin líneas. Sin caché.

6. **Home (Q5).** `ReportSummary.budgetRisk`: `{periodId, lines: [hasta 3 LIKELY ordenadas por fecha estimada, luego por nombre], moreCount}` o `null` sin plan o sin líneas en riesgo. No cambia el disponible para gastar.

7. **Avisos dentro de `reporting.cash-flow-watch`.**
   - Después del paso del flujo de caja, en la misma pasada horaria y por workspace (de a uno, en su unidad de trabajo, sin consultas en paralelo), se calcula el riesgo del periodo en curso.
   - Para cada línea `LIKELY` que no cruzó el umbral de 100 % (se lee del presupuesto vs real: G ≥ R ya es `EXCEEDED`) se intenta insertar en `reporting.budget_overrun_notice (workspace_id, period_id, budget_line_id)` con `ON CONFLICT DO NOTHING`. Si se insertó, se llama a `NotificationIntakePort.notify(BudgetOverrunRiskFact)` en la misma unidad de trabajo.
   - Una vez por línea y periodo: bajar y volver a subir no avisa otra vez.
   - Una falla del paso de riesgo no afecta al del flujo de caja (try/catch por paso y por workspace, como `forecasting.schedule`).
   - Con `REPORTING_BUDGET_RISK_ENABLED=false` el paso no corre y la consulta responde `DISABLED`.
   - Sin consumidores ni conexiones nuevas: 28 + 4 = 32 de 34 (TC-PLATFORM-THROUGHPUT-009). *Alternativa descartada:* evaluar en el consumidor de `BudgetThresholdReached` o de las transacciones, que suma consumidores (D249).

8. **Notificación.**
   - `BudgetOverrunRiskFact {periodId, periodLabel, budgetLineId, target {kind, id, name}, projected, reference, estimatedDate, basis: RUN_RATE|FORECAST, detectedAt, timeZone}`.
   - `factKey` = `budget-risk:{periodId}:{budgetLineId}`. Destinatarios: los mismos que el umbral de presupuesto (todo miembro activo), solo si activaron el tipo.
   - Tipo `BUDGET_OVERRUN_RISK`, desactivado por omisión en los dos canales, con el mismo valor por omisión por tipo que introduce el change 72. Si el 74 se implementa antes, lo introduce el 74.
   - Severidad `WARNING`. Enlace `NotificationLink.kind = BUDGET_LINE`, como el umbral. Emails sin montos ni nombres salvo opt-in.

9. **Textos.** Plantillas es/en/pt. Ejemplos:
   - Riesgo probable: «Con el ritmo actual, Restaurantes superaría su tope alrededor del 22/11/2026 (proyección 840,00 Bs de 600,00 Bs)».
   - Riesgo posible: «Si el gasto en Supermercado se acerca a lo alto de lo habitual, podría superar su tope alrededor del 28/11/2026».
   - Sin certeza ni imperativos (FR-FORECAST-004), y la base del cálculo siempre visible («según el ritmo del periodo» o «según el pronóstico»).

10. **UI.** En el plan del periodo en curso, cada línea muestra un indicador de riesgo (probable, posible, excedida) con un tooltip que lleva la proyección, la fecha estimada y la base, y una leyenda que explica «posible». La tarjeta Q5 lista las líneas en riesgo con su enlace. Las preferencias de notificaciones muestran el tipo nuevo apagado. Todo con i18n es/en/pt y tabla accesible.

## Contratos

**`contracts/openapi/finance-api.v1.yaml` (aditivo; oasdiff limpio, Spectral y Redocly sin errores):**

- `GET /workspaces/{workspaceId}/periods/{periodId}/budget-risk` (`getBudgetRisk`, tag `Reports`, `x-openspec-capability: [reporting/predictive-insights]`, `x-required-role: VIEWER`). Respuesta 200 `BudgetRisk`:
  - `status`: `AVAILABLE`, `NO_PLAN`, `NOT_CURRENT_PERIOD` o `DISABLED`.
  - `periodId`, `asOf` (fecha en la zona del workspace), `currency` (la del plan), `elapsedDays`, `remainingDays` y `forecastRunId` (o null).
  - `lines: BudgetLineRisk[]`.

  Errores: 401, 403, 404 `RESOURCE_NOT_FOUND` (periodo inexistente o de otro workspace), 429 y 500.
- `BudgetLineRisk` lleva:
  - `budgetLineId`, `target {kind: CATEGORY|GROUP, id}` y `reference`.
  - `actual`, `variableActual` y `knownPending: Money` (todos `Money`).
  - `projected: Money|null`, `projectedHigh: Money|null` y `projectionComplete: boolean`.
  - `level`: `EXCEEDED`, `LIKELY`, `POSSIBLE`, `UNLIKELY` o `NOT_AVAILABLE` (`x-extensible-enum`).
  - `reason`: `LINE_TYPE`, `NO_REFERENCE`, `TOO_EARLY` o null.
  - `estimatedDate: date|null` y `basis: RUN_RATE|FORECAST|null`.

  Las líneas de etiqueta y de ingreso no figuran.
- `ReportSummary.budgetRisk: {periodId, lines: BudgetLineRisk[] (≤ 3), moreCount: integer}|null` (opcional).
- `NotificationType` suma `BUDGET_OVERRUN_RISK` (`x-extensible-enum`). `NotificationLink` usa `kind = BUDGET_LINE` con `periodId` y `periodLabel`, como el umbral.
- Sin códigos de error nuevos en `ErrorCode`.

**Contratos internos (TypeScript, aditivos):**
- `@pf/notifications/contracts`: `BudgetOverrunRiskFact` en `NotificationIntakeFact`.
- `@pf/commitments/contracts`: si la query de ocurrencias que ya usa el calendario no expone la categoría de la definición ni las resueltas del periodo con su transacción, se amplía de forma aditiva (campos opcionales `categoryId` y `resolvedAmount`).
- `@pf/planning/contracts` y `@pf/forecasting/contracts`: sin cambios (`BudgetVsActualQuery`, `PeriodQuery`, `LatestForecastQuery`).

**Eventos:** ninguno.

**Base de datos (migración expand, timestamp posterior a la última de `main`):**
- `reporting.budget_overrun_notice`: `workspace_id`, `period_id`, `budget_line_id`, `level` (`LIKELY`), `estimated_date`, `notified_at`, pk `(workspace_id, period_id, budget_line_id)`. RLS forzada (D298), registrada en `platform.workspace_scoped_table`. Fuera del export: es un registro técnico de avisos; tras importar, una línea en riesgo puede avisarse otra vez una sola vez.

**Configuración (`docs/config-reference.md`):**

| Variable | Servicios | Omisión |
|---|---|---|
| `REPORTING_BUDGET_RISK_ENABLED` | api, worker | `true` |
| `REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS` | api, worker | `7` |

## Riesgos / Trade-offs

- [Gastos grandes puntuales a comienzo de mes que inflan el ritmo] → `TOO_EARLY` los primeros 7 días; el pago de compromisos no se extrapola; el aviso es por línea y periodo, no repetido.
- [Las ocurrencias pendientes no cubren gastos variables recurrentes sin definición] → el ritmo los incluye; el pronóstico lo mejora cuando está habilitado.
- [Duración de `reporting.cash-flow-watch`] → el cálculo es en memoria sobre el plan (≤ 40 líneas típicas) y una lectura de ocurrencias; se mide en el benchmark del paso (tarea 5.2).
- [Dos fuentes de proyección en el plan (la lineal de PLANNING y la de riesgo)] → la UI muestra la de riesgo solo en el indicador y su tooltip, con la base explícita; la columna de proyección del plan no cambia.

## Plan de migración

Migración expand sin datos. Rollback: `REPORTING_BUDGET_RISK_ENABLED=false`; la tabla queda sin uso.

## Cambios a docs compartidos (al implementar)

- **docs/01:** as-built de FR-REPORTING-020; FR-NOTIFY-004 suma el tipo riesgo de presupuesto (Phase 9).
- **docs/05 y docs/06:** REPORTING usa `BudgetVsActualQuery` para el riesgo; NOTIFICATIONS recibe el hecho nuevo.
- **docs/10:** endpoint y campos nuevos. **docs/14:** riesgo por línea y su relación con la proyección lineal. **docs/15 §12:** as-built de los insights predictivos.
- **docs/17 y la matriz:** TC nuevos. **docs/25:** US-249 implementada. **docs/38:** estado del change.
- **docs/config-reference.md:** las dos variables.
- **ARCHITECTURE §14:** `reporting/predictive-insights` activa.

## Preguntas abiertas

Ninguna. D478 (recomendación aplicada por omisión) fija el alcance y el owner cerró el 2026-11-25 las dos que quedaban, las dos con lo que este design proponía ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md) § «Respuestas posteriores»):
- **D484:** el riesgo «posible» solo se muestra en el plan y su tooltip, sin notificación; solo avisa el paso a «probable» (decisión 7).
- **D485:** la proyección lineal de PLANNING (FR-PLANNING-024) se deja lineal; no se unifica con este cálculo (decisión 1).

Los demás parámetros (7 días mínimos, destinatarios iguales a los del umbral) son configurables o reversibles.
