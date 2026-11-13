# Propuesta: add-predicted-cash-flow-band

## Why

El calendario de flujo de caja de Phase 7 (`add-cash-flow-forecast`, change 60, archivado) proyecta el saldo diario solo con lo que se sabe: pendientes, ocurrencias, ingresos esperados y, como serie aparte, el gasto planificado. docs/14 §8 dejó para Phase 8 el tercer escenario: el **gasto variable predicho** como banda (p10–p90), «nunca sumado a la línea conocida», y FR-FORECAST-008 / US-245 piden la probabilidad de déficit con ese gasto. El Home tampoco usa todavía el pronóstico. Este change conecta el pronóstico (changes 64 y 65) con el calendario y el Home sin tocar la lógica de riesgo y alertas que el owner ya decidió (D379, D381, D383).

## What Changes

- **Serie de gasto variable líquido por moneda** en la corrida (FORECAST): por cada moneda de cuentas líquidas, en esa moneda y sin conversión, el gasto pagado desde cuentas líquidas menos los recurrentes resueltos y los componentes de cuotas pagados desde ellas (las compras con tarjeta quedan fuera: el calendario ya cuenta su pago); periodo en curso y 3 siguientes, intervalo del 80 %.
- **Banda en el calendario** (`reporting/cash-flow-calendar`): por moneda, tres series adicionales (gasto esperado, alto y bajo), con el gasto de cada periodo repartido por día (en el periodo en curso solo lo que falta, nunca negativo); nunca sumadas a la serie principal ni a la del plan.
- **Probabilidad de déficit con el gasto predicho** (FR-FORECAST-008): probable, posible o improbable (o no disponible) con la fecha del primer día bajo el umbral del riesgo; separada del nivel de riesgo, que no cambia; sin episodios ni notificaciones nuevas.
- **Sin pronóstico**: la banda se omite con el motivo y el calendario queda idéntico.
- **Home**: Q3 suma el gasto esperado del periodo en curso con su rango probable; Q8 suma la probabilidad de déficit con el gasto predicho, aparte del riesgo de los pagos conocidos.
- **Fuera de alcance:** cambiar el nivel de riesgo, los episodios o la alerta de déficit (D379, D381); saldo esperado más allá de 90 días (docs/15 §6.1 «saldo esperado 1/3/6 meses»); porcentaje numérico de probabilidad por simulación (pregunta 27 de docs/65); notificaciones o insights predictivos (Phase 9, EPIC-26); precisión del pronóstico (change 67).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `forecast/expense-forecasting`: 1 ADDED (Should), serie de gasto variable líquido por moneda.
- `reporting/cash-flow-calendar`: 5 ADDED (Should): banda, probabilidad de déficit, calendario sin pronóstico, riesgo y alerta sin cambios, rendimiento con la banda.
- `reporting/dashboard`: 2 ADDED (Should): gasto esperado en Q3 y probabilidad de déficit en Q8.

## Impact

**Specs impactadas:** `forecast/expense-forecasting` (1 ADDED), `reporting/cash-flow-calendar` (5 ADDED), `reporting/dashboard` (2 ADDED). Lee sin modificar: `accounts/account-management` (liquidez), `transactions/transaction-recording` (porciones por cuenta), `commitments/recurrence-engine`, `notifications/alerts` (sin tipos nuevos).

**Componentes/contextos impactados:** FORECAST: `VariableLiquidOutflowBuilder` (puro) y la serie `LIQUID_VARIABLE_OUTFLOW` por moneda en `ExecuteForecastRun`; `LatestForecastQuery` con filtro por tipo de serie. REPORTING: DS puro `PredictedSpendingBand` (reparto diario, restante del periodo en curso, tres series, probabilidad), `GetCashFlowCalendar` y el bloque del resumen del Home leen `LatestForecastQuery` (dependencia nueva REPORTING → FORECAST por contrato, sin ciclo: FORECAST no lee REPORTING). `apps/web`: calendario `/flujo-de-caja` con la banda y la probabilidad, tarjetas Q3 y Q8.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): `CashFlowCurrency.predicted {status: AVAILABLE|NOT_AVAILABLE, reason: DISABLED|NO_FORECAST|NO_SERIES|INSUFFICIENT_DATA|NO_CURRENT_PERIOD|null, forecastRunId|null, generatedAt|null, series[{date, expected, high, low}], lowest {expected {amount, date}, high {amount, date}}, shortfallLikelihood: LIKELY|POSSIBLE|UNLIKELY|NOT_AVAILABLE, firstShortfallDate|null}`; `ReportSummary.forecast {expectedSpending {period, prediction, interval80, generatedAt}|null}` y `CashFlowHomeBlock.predictedShortfall {currency, likelihood, date}|null`. Sin códigos de error nuevos. `ForecastSeries.scope` suma `LIQUID_VARIABLE_OUTFLOW` (`x-extensible-enum`).

**Tablas impactadas:** ninguna nueva (la serie nueva usa `forecasting.forecast_series` con un `scope` más; el CHECK de `scope` se amplía en una migración expand si existe).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** a lo sumo una migración expand que amplía el CHECK de `forecasting.forecast_series.scope` (no destructiva).

**Test cases:** AÑADIDOS — TC-FORECAST-CASHFLOW-001..003 (3) y TC-REPORTING-PREDICTED-001..011 (11). MODIFICADOS — ninguno: TC-REPORTING-FORECAST-* siguen iguales (la serie principal, el riesgo y la alerta no cambian) y TC-REPORTING-FORECAST-021 se vuelve a medir con la banda. DEPRECADOS — ninguno.

**Impacto de regresión:** el calendario y el resumen del Home leen una corrida más por petición (una consulta indexada): vigilar NFR-PERF-010 (TC-REPORTING-PREDICTED-011) y NFR-PERF-004 (resumen ≤ 300 ms p95); el riesgo y la alerta no cambian (TC-REPORTING-PREDICTED-008 y TC-REPORTING-FORECAST-018/019 en verde); sin consumidores ni conexiones nuevas.

**Riesgos introducidos:** RISK-015 (confianza indebida en la banda: probabilidad por niveles, texto que aclara el 80 %), RISK-017 (cada moneda en su moneda, sin conversión), confusión entre el riesgo de los pagos conocidos y la probabilidad con el gasto predicho (se muestran separados y con textos distintos), RISK-029 (rendimiento del calendario).

**Invariantes afectadas:** INV-001, INV-002 e INV-020 (reparto diario con Decimal y HALF_EVEN; el residuo del reparto va al último día del periodo para que la suma sea exacta). Ninguna escritura en el ledger.
