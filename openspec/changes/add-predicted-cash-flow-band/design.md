# Diseño

## Contexto

Tercer change de Phase 8. El calendario de flujo de caja (`reporting/cash-flow-calendar`, change 60) calcula por moneda la serie principal (conocidos, estimados y esperados, D379), la serie con el gasto planificado restante repartido por día (D383), el peor caso sin ingresos, el riesgo `HIGH`/`POSSIBLE`/`LOW`/`NONE` contra la reserva mínima o cero y un episodio con alerta horaria (D381, D382). docs/14 §8.1 y §8.2 dejaron para Phase 8 el gasto variable predicho como banda que «nunca se suma a la línea conocida». Los changes 64 y 65 dejan el pronóstico vigente en `forecasting` con `LatestForecastQuery` en los contratos de FORECAST.

## Objetivos / No objetivos

**Objetivos**
- Una serie de gasto variable por moneda, pensada para el calendario (en su moneda y solo lo que se paga desde cuentas líquidas).
- Banda y probabilidad de déficit en el calendario, sin cambiar riesgo, episodios ni alertas.
- Gasto esperado en Q3 y probabilidad de déficit en Q8.

**No objetivos**
- Notificar por la probabilidad de déficit (insights predictivos de Phase 9).
- Saldo esperado más allá de 90 días; porcentaje numérico de probabilidad.
- Cambiar la serie del gasto planificado o el riesgo `POSSIBLE` (D379: `POSSIBLE` es solo por el plan).

## Decisiones

1. **Una serie propia para el flujo de caja (pregunta 6).** Las series del change 64 están en la moneda de reporte e incluyen compras con tarjeta (son gasto aunque el dinero sale al pagar la tarjeta, y el calendario ya cuenta ese pago como `CARD_PAYMENT`). Para el saldo diario por moneda hace falta otra historia: el gasto pagado desde cuentas líquidas de cada moneda, en esa moneda. `VariableLiquidOutflowBuilder` usa `NominalFlowQuery` con `groupBy: ['ACCOUNT', 'ORIGIN']` y el catálogo de cuentas (líquidas = `ASSET` + `LIQUID` no archivadas, D35/D215), resta las ocurrencias resueltas de gasto pagadas desde esas cuentas y los componentes de cuotas pagados desde ellas (mismo criterio que el change 65, decisión 2). Scope `LIQUID_VARIABLE_OUTFLOW` con `currency` de la cuenta; horizonte 4 periodos (el en curso y 3 más, que cubren 90 días). Sin conversión: no hay riesgo de tasa (RISK-017).

2. **Banda (pregunta 28).** `PredictedSpendingBand` (DS puro en REPORTING, TDD) por moneda:
   - Periodo en curso: `restante_q = max(0, q − gastadoVariable)` para q ∈ {esperado, alto = límite superior 80 %, bajo = límite inferior 80 %}, repartido en partes iguales entre los días de hoy al fin del periodo (incluidos). `gastadoVariable` = gasto variable líquido de la moneda en el periodo hasta hoy (misma regla que la historia), leído en la transacción de la petición.
   - Periodos siguientes: q del periodo entre todos sus días.
   - Reparto con Decimal a la escala de la moneda, HALF_EVEN, y el residuo en el último día del periodo (suma exacta; PBT).
   - Serie con gasto `x` = serie principal del día − Σ gasto repartido acumulado hasta ese día. La serie del plan (D383) y la banda **no se combinan**: el plan es lo que el usuario se propuso gastar; la banda, lo que la historia sugiere. *Alternativa descartada:* reemplazar la serie del plan por la predicha (pierde la referencia del presupuesto).

3. **Probabilidad de déficit (pregunta 27).** Por moneda con banda: `LIKELY` si el mínimo de la serie con gasto esperado < umbral; `POSSIBLE` si solo el de la serie con gasto alto < umbral; `UNLIKELY` si ninguno; `NOT_AVAILABLE` sin banda. Umbral = el mismo del riesgo (reserva mínima o cero). La fecha es el primer día bajo el umbral de la serie que lo determina. Interpretación (texto de la UI y descripción del contrato): con un intervalo del 80 %, «posible» indica alrededor de 1 en 10 o más; «probable», alrededor de 1 en 2 o más. *Alternativa descartada:* un porcentaje por simulación en el servicio: precisión aparente que las series personales no sostienen (RISK-015) y una petición al servicio en el camino de lectura (prohibido por FR-FORECAST-006).

4. **Riesgo y alerta intactos (pregunta 26, bloqueante).** El nivel de riesgo, `firstShortfallDate`, `shortfallAmount`, el episodio `reporting.cash_flow_shortfall_episode`, los eventos `reporting.CashFlowShortfallRisk{Detected,Cleared}.v1` y la notificación `CASH_FLOW_SHORTFALL_RISK` siguen usando solo la serie principal. docs/14 §8.2 sugería `POSSIBLE` también con la banda; D379 ya dio a `POSSIBLE` otro sentido (solo por el plan) y cambiarlo movería alertas que el owner ya ve. La probabilidad con el gasto predicho es un campo aparte.

5. **Lectura del pronóstico.** `GetCashFlowCalendar` y el resumen del Home llaman a `LatestForecastQuery.getLatest({workspaceId, scopes: ['LIQUID_VARIABLE_OUTFLOW'] | ['TOTAL_EXPENSE'], horizon})` en la misma transacción de lectura (una consulta indexada por la corrida vigente; sin caché, sin llamar al servicio). Los puntos se eligen por **etiqueta de periodo** (no por `monthsAhead`), así una corrida de un periodo anterior sigue sirviendo mientras tenga el periodo en curso; si no lo tiene, `NO_CURRENT_PERIOD`. Con `stale` se muestra la banda con el aviso de desactualizado.

6. **Dependencia REPORTING → FORECAST.** Nueva y en una sola dirección (FORECAST no lee REPORTING, change 64 decisión 6); `arch:check` la valida.

7. **Home (pregunta 29).** `ReportSummary.forecast.expectedSpending`: el punto del periodo en curso de `TOTAL_EXPENSE` (valor esperado e intervalo del 80 %) con `generatedAt`; la tarjeta Q3 lo muestra con el formato «Esperado: ~… · Rango probable: … (80 %)» (FR-FORECAST-004). `CashFlowHomeBlock.predictedShortfall`: la moneda con la probabilidad más alta del calendario de 30 días (orden `LIKELY` > `POSSIBLE` > `UNLIKELY`), con fecha; la tarjeta Q8 la muestra en una línea aparte del riesgo («Si tu gasto variable es alto: déficit posible en BOB el 14/12/2026»). Sin pronóstico, las tarjetas no cambian.

8. **Conexiones y rendimiento.** Sin consumidores ni conexiones nuevas (lecturas en la petición). Benchmarks: calendario de 90 días ≤ 500 ms p95 con la banda (TC-REPORTING-PREDICTED-011) y resumen del Home ≤ 300 ms p95.

## Contratos

Cambios requeridos (aditivos; oasdiff limpio, Spectral y Redocly sin errores).

**`contracts/openapi/finance-api.v1.yaml`:**
- `CashFlowCurrency.predicted` (nuevo, requerido en la respuesta): `{status: AVAILABLE|NOT_AVAILABLE, reason: DISABLED|NO_FORECAST|NO_SERIES|INSUFFICIENT_DATA|NO_CURRENT_PERIOD|null, forecastRunId: Uuid|null, generatedAt: Instant|null, stale: boolean, intervalLevel: 0.8, series[{date, expected: Money, high: Money, low: Money}], lowest {expected {amount: Money, date}, high {amount: Money, date}}|null, shortfallLikelihood: LIKELY|POSSIBLE|UNLIKELY|NOT_AVAILABLE, firstShortfallDate: LocalDate|null}` (`reason` y `shortfallLikelihood` como `x-extensible-enum`). Al agregarse como propiedad nueva de la respuesta, es aditivo para oasdiff.
- `ReportSummary.forecast` (nuevo, nullable): `{expectedSpending {period, prediction: Money, interval80 {lower: Money, upper: Money}, generatedAt, stale}|null}`.
- `CashFlowHomeBlock.predictedShortfall` (nuevo, nullable): `{currency, likelihood: LIKELY|POSSIBLE|UNLIKELY, date: LocalDate|null}`.
- `ForecastSeries.scope` (`x-extensible-enum`) + `LIQUID_VARIABLE_OUTFLOW`; el parámetro `scope` de `getLatestForecast` lo acepta.
- Sin códigos de error ni endpoints nuevos.

**Contrato interno `ml-forecasting` v1:** sin cambios (la serie nueva es una serie más, `kind: EXPENSE`).

**Contratos entre módulos:** `@pf/forecasting/contracts` `LatestForecastQuery.getLatest` acepta `scopes` con `LIQUID_VARIABLE_OUTFLOW` y devuelve `currency` por serie (aditivo). REPORTING agrega la dependencia a `@pf/forecasting/contracts`.

## Dependencias con otros changes

| # | Necesidad | Estado | Qué hace este change |
|---|---|---|---|
| S1 | `add-ml-forecasting-service` (64) y `add-expense-forecasts` (65) | Este diseño | Requisitos: fusionados (y archivados antes para archivar este) |
| S2 | `reporting/cash-flow-calendar` y `reporting/dashboard` del change 60 | Archivado | Solo ADDED; ningún requirement existente cambia |
| S3 | Calendario de flujo de caja (D379, D381, D383) | Decidido | Se respeta: riesgo, plan y alerta sin cambios |

## Riesgos / Trade-offs

- [Confusión entre riesgo y probabilidad] → textos distintos («pagos conocidos» frente a «si tu gasto variable es alto»), líneas separadas en Q8, leyenda en el calendario.
- [Reparto uniforme por día] → simplificación declarada: el gasto real se concentra en fines de semana y quincenas; con series diarias se podría mejorar en Phase 9.
- [Pronóstico viejo] → se elige por etiqueta de periodo; `stale` visible; sin el periodo en curso, no hay banda.
- [Gasto ya hecho en el periodo mayor al pronóstico] → restante 0, nunca negativo (la banda no «devuelve» dinero).
- [Rendimiento del Home] → una consulta indexada; benchmark.

## Plan de migración

Si el change 64 dejó un CHECK sobre `forecasting.forecast_series.scope`, una migración expand lo reemplaza por uno que incluya `LIQUID_VARIABLE_OUTFLOW` (no destructiva, timestamp posterior a la del change 65). Sin tablas nuevas ni backfill: las corridas anteriores no tienen la serie y el calendario informa `NO_SERIES` hasta la próxima corrida.

Configuración: ninguna variable nueva.

## Preguntas abiertas

Consolidadas en [docs/65](../../../docs/65-phase-8-consolidation-questions.md): 26 **[B]** (semántica en el calendario: banda separada, riesgo y alerta sin cambios), 27 (probabilidad por niveles y no porcentaje), 28 (reparto diario y periodo en curso), 29 (Home: Q3 con el gasto esperado y Q8 con la probabilidad).

## Cambios a docs compartidos

Los aplica el implementador (tarea 8.1):

- **docs/14 §8:** as-built del escenario (c): banda separada, probabilidad por niveles, riesgo `POSSIBLE` sin cambios (D379); §9.1 Q3 y Q8 con el pronóstico.
- **docs/00 §6:** Q3 y Q8 con el pronóstico como dato complementario.
- **docs/01:** nota as-built en FR-FORECAST-008 y FR-REPORTING-014/015.
- **docs/06:** relación REPORTING → FORECAST (query).
- **docs/10:** campos nuevos del calendario y del resumen.
- **docs/28:** banda en el gráfico del calendario (área entre alto y bajo, línea del esperado, leyenda) y textos de Q3 y Q8.
- **docs/25:** US-245 implementada.
- **docs/17:** matriz con TC-FORECAST-CASHFLOW-* y TC-REPORTING-PREDICTED-*.
- **docs/38:** estado del change.
