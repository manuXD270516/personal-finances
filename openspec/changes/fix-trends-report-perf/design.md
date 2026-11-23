# Diseño: fix-trends-report-perf

## Contexto

`GET /api/v1/workspaces/{ws}/reports/trends` (reporte 6, change 59 `add-financial-reports-extended`) se arma en `ExtendedReportsQueries.getTrends` (`packages/contexts/reporting/src/application/extended-reports.queries.ts`):

1. `ReportContext.create`: ajustes del workspace, catálogo de monedas, periodos, calendario y árbol de categorías.
2. `loadFacts`: una llamada a `NominalFlowQuery.summarizeNominalFlows` (TRANSACTIONS, `pg-nominal-flows.ts`) que agrega las porciones por (fecha, naturaleza, categoría, moneda); cada fila se arma como `Money` en TRANSACTIONS y otra vez en REPORTING (`ctx.money`).
3. `ctx.resolveRates`: una solicitud de tasa por (moneda, día) de los hechos (`FlowValuation.rateRequests`) y una sola llamada a `FxValuationPort.resolveValuationRates`, que lee las candidatas del rango en una consulta y resuelve cada solicitud con `RateResolver.tryResolve` (FX, dominio).
4. `TrendMatrix.build` (REPORTING, dominio, `domain/extended-reports.ts`): ranking de categorías de primer nivel, 7 series más «Otras categorías», celdas por periodo y totales, cada cifra con `ReportConversionPolicy.value` (consolida por día y moneda, convierte cada agregado con la tasa de su día, suma exacta).
5. `ctx.track` y `ctx.meta` (frescura y versión de datos).

La fila `report-trends-24m` del nightly pide 24 meses calendario (2024-10-01 → 2026-09-30); es el único reporte del nightly con 24 periodos.

## Diagnóstico

### Medición

Corrida local el 2026-11-23 sobre `main` 4cdc7689 con el Large Seed a escala 1 en Testcontainers (PostgreSQL 18.6, `VACUUM (ANALYZE)` previo, API en proceso con `createApiRuntime` y JWT locales, como `nightly.perf.ts`); CPU Intel Core Ultra 9 275HX, que en esta fila rinde como el Xeon 6975P-C de los runners (p50 HTTP 479 ms frente a 491 ms). Instrumentación local no versionada: marcas de `performance.now()` por fase en `run`, `getTrends` y `summarizeNominalFlows` publicadas en un recolector global, 5 peticiones de calentamiento y 40 medidas (30 en las comparativas), y una pasada con `auto_explain` (`session_preload_libraries`, `log_min_duration = 0`, `log_analyze`, `log_buffers`, activado por `ALTER SYSTEM` solo para esa petición) leyendo el log del contenedor.

Dataset de los 24 meses: 40 346 porciones, 72 categorías con gasto, 4 monedas (BOB, USD, USDT, BTC); 21 212 filas agregadas por la consulta y 20 432 hechos de gasto; 730 días distintos; 120 categorías en el árbol (98 ids de primer nivel).

| Fase (p50 / p95, ms) | 6 meses | 12 meses | 24 meses |
|---|---|---|---|
| HTTP | 124 / 140 | 217 / 244 | **479 / 644** |
| Dentro de la unidad de trabajo | 106 / 123 | 197 / 210 | 454 / 620 |
| `ReportContext.create` | 10 / 11 | 9 / 12 | 10 / 13 |
| `loadFacts` (total) | 38 / 41 | 69 / 71 | 135 / 247 |
| ↳ SQL de flujos | 20 / 22 | 35 / 37 | 67 / 159 |
| ↳ armado de filas en TRANSACTIONS | 15 / 17 | 28 / 29 | 52 / 72 |
| `resolveRates` | 26 / 29 | 51 / 59 | **108 / 127** |
| `TrendMatrix.build` | 27 / 36 | 64 / 70 | **200 / 239** |
| `track` + `meta` | 4 / 6 | 2 / 3 | 2 / 3 |
| Referencia: gastos por categoría (HTTP) | — | 186 / 207 | 355 / 433 |

Aislado sobre los hechos reales de 24 meses: `TrendMatrix.build` 248 ms (p50); solo las 192 pasadas de filtrado de la lista de hechos (8 series × 24 periodos, sin valorar) 131 ms; una sola valoración de los 20 432 hechos con la política 22 ms.

### Planes

`auto_explain` de una petición de 24 meses: **48 sentencias**, ninguna repetida por fila (sin N+1: las únicas repetidas son las 4 lecturas de escala de moneda, una por moneda). La única relevante es la consulta de flujos, 74 ms en el servidor con `log_analyze`:

- `GroupAggregate` (21 212 filas) ← `Sort` por `transaction_date::text`, naturaleza, moneda y categoría (40 269 filas, quicksort 3,8 MB) ← `Hash Join` ← `Seq Scan` de `txn.transaction_split` (100 932 de 156 235 filas) y `Seq Scan` de `txn.transaction` (38 901 filas del rango).
- 6 518 buffers, todos `shared hit`. El `Result` con `One-Time Filter` de `platform.current_workspace_id()` es la RLS (D298), sin costo por fila.

Es el plan correcto para un agregado sobre la mayor parte de la tabla (mismo diagnóstico que la tarea 5.1 de `add-financial-reports` a 12 meses). La lectura de candidatas de tasas tarda 0,7 ms; las demás sentencias, menos de 0,3 ms cada una.

### Causa

1. **El 80 % del tiempo es JavaScript de un solo hilo.** SQL: ~80 ms de 454. Matriz, tasas y armado de `Money`: ~360 ms. Por eso la fila escala con la CPU del runner (845/514 ≈ 1,65× entre el AMD EPYC 7763 y el Xeon 6975P-C), igual que H1 de docs/67; la memoria y las asignaciones también explican la cola (p95 644 frente a p50 479 en local, recolección de basura de los ~200 arreglos intermedios por petición).
2. **`TrendMatrix.build` es O(hechos × (series × periodos + categorías de primer nivel))**: `cellsOf` filtra la lista completa por cada serie y periodo, `totalOf` por cada serie y el ranking por cada categoría de primer nivel con gasto. Es la fase que más crece con el rango (27 → 64 → 200 ms): duplica los hechos y cuadruplica las pasadas.
3. **`RateResolver.pick` es O(solicitudes × candidatas)**: por cada solicitud (y hasta 4 `pick` con directa, inversa y cruzada) filtra todas las candidatas con `isUsableCandidate` y `Date.parse(asOf)`. Crece con el rango por los dos lados (más días que valorar y más tasas en la ventana de lectura): 26 → 51 → 108 ms. En el Large Seed hay ~10 tasas por mes; **con providers reales** (paralela diaria, compra y venta, oficial, dos providers, `fx/market-rate-providers`) las candidatas de 24 meses serían decenas de veces más y este costo crecería en la misma proporción en todo reporte o vista que valore por lote.
4. El armado de filas (doble `Money.parse`, `await` por fila en `scaleResolver`) es lineal y pesa ~65 ms: no es la causa del crecimiento, pero es el siguiente costo.

## Objetivos / No objetivos

**Objetivos**

- Misma respuesta exacta del reporte (TC-REPORTING-REPORTS-055) y del resolvedor (TC-FX-RATE-009).
- Costo de la matriz lineal en los hechos (TC-REPORTING-REPORTS-057) y del lote de tasas lineal en candidatas más solicitudes (TC-FX-RATE-010), verificados sin medir tiempo.
- Objetivo interno (TC-REPORTING-REPORTS-056): p95 de `report-trends-24m` ≤ 400 ms en un runner AMD EPYC; en local, ≤ 50 % del p95 medido antes en la misma máquina.

**No objetivos**

- Tocar el umbral de 800 ms, el rango, las iteraciones o la forma de medir la fila (D448).
- Cambiar la consulta de flujos, su contrato o agregar índices.
- Read model o caché de reportes; paralelismo (hilos de trabajo).
- Cambiar la granularidad de la valoración (tasa del día de cada flujo, D109).

## Decisiones

### Decisión 1: `TrendMatrix.build` en una sola pasada, con el mismo orden de valoración

Dominio puro de REPORTING, sin cambios de firma. Algoritmo:

1. Una pasada sobre `facts` en su orden: `topOf(categoryId)`; periodo del hecho por búsqueda binaria sobre los periodos ordenados por `from` (o un mapa día → índice de periodo, construido una vez); los hechos fuera de todo periodo cuentan en el ranking y en los totales y en ninguna celda, como hoy; acumulación en `Map` por (categoría de primer nivel, día, moneda) con `Money.add`, recordando el orden de primera aparición de cada categoría de primer nivel.
2. Ranking: para cada categoría de primer nivel **en orden de primera aparición**, `policy.value` sobre sus acumulados por (día, moneda). Mismo `byAmountThenName`, mismo `TREND_TOP_SERIES`.
3. Series y «Otras categorías»: para cada serie y periodo, `policy.value` sobre los acumulados por (día, moneda) de esa celda (para «Otras», los de las categorías restantes), con `perDays` como hoy; el total de cada serie con `policy.value` sobre sus acumulados del rango y la suma de días como hoy.

Equivalencia: `ReportConversionPolicy.value` ya consolida por (día, moneda) antes de convertir (`FlowValuation.consolidate`, que además recorre las claves ordenadas y salta las sumas cero) y `sumByCurrency` devuelve las monedas ordenadas; sumar antes por (día, moneda) con `Money.add` (exacto a la escala de la moneda) da los mismos agregados, las mismas conversiones, la misma suma exacta y el mismo orden dentro de cada cifra, sea cual sea el orden de las filas que recibe. Como cada día pertenece a un solo periodo, la suma de una (categoría de primer nivel, día, moneda) es la misma en el ranking y en su celda, así que las sumas cero se saltan igual. **Orden de `ratesUsed`:** el colector registra cada tasa en la primera consulta de `rateFor`; hoy todas las primeras consultas ocurren en el ranking (que cubre todos los hechos), recorriendo las categorías de primer nivel en orden de primera aparición en `facts` y, dentro de cada una, sus claves (día, moneda) ordenadas. La única restricción de orden de la implementación nueva es esa: valorar el ranking antes que las celdas y en el orden de primera aparición de las categorías de primer nivel. Así `meta.conversion.ratesUsed` no cambia; lo verifica TC-REPORTING-REPORTS-055 en la capa de aplicación.

Costo: una lectura por hecho (más la copia si la implementación la hace: tope de 2 lecturas por hecho en TC-REPORTING-REPORTS-057) y valoraciones sobre filas ya acumuladas (≤ 3 × agregados distintos). Estimación sobre la medición: de 200 ms a ≤ 40 ms en local (la valoración de todos los hechos cuesta 22 ms y los acumulados son menos filas que los hechos).

### Decisión 2: índice de candidatas en `RateResolver`, con el mismo orden

Dominio puro de FX, sin cambios de firma pública (`new RateResolver(candidates, policy)`, `resolve`, `tryResolve`, `resolveForConversion`):

1. En el constructor: `usable = candidates.filter(isUsableCandidate)` una vez; para cada estado, `t = Date.parse(asOf)` una vez y su posición original `i`; agrupar por par no ordenado (`min(base, quote)|max(base, quote)`) y ordenar cada grupo por `(t, i)`.
2. En `pick(a, b, at, windowDays, type, mode)`: tomar el grupo del par `{a, b}`; con dos búsquedas binarias, el tramo con `from ≤ t ≤ to`; reordenar ese tramo por `i` (orden original de `candidates`) y aplicar exactamente los mismos filtros (`ofType`, `others`, `samePair`, `inPair`), `providerReference` y `ValuationRateSelector` que hoy.

Equivalencia: hoy `usable` es la lista completa en orden original filtrada por ventana; todo lo que sigue filtra por par (`samePair` para la referencia, `inPair` para cada orientación). El tramo del grupo del par contiene exactamente los mismos estados de ese par y ventana, en el mismo orden relativo, así que `eligible`, `others`, `providerReference` y la elección del selector (incluidos los empates de `latestOf`, que dependen del orden) son idénticos. El tramo usa el mismo `Date.parse(asOf)` que hoy, solo calculado una vez. `ValuationRateSelector` no cambia.

Costo: O(C log C) al construir y O(log C + k log k) por `pick`, con k = tasas del par en la ventana (decenas). Estimación: de 108 ms a ≤ 10 ms en local. Beneficia a todos los usuarios de `resolveValuationRates`, `resolveQuoteSideRates` y `latest`.

### Decisión 3: armado de filas solo como contingencia

Si, con las decisiones 1 y 2 aplicadas, la medición local de la tarea 6.1 da un p50 HTTP de tendencias de 24 meses mayor que 230 ms (≈ 400 ms / 1,75, la relación entre el EPYC 7763 y la máquina de referencia), se aplica además:

- en `summarizeNominalFlows`, resolver las escalas de las monedas distintas antes del bucle (sin `await` por fila);
- en `loadFacts` de REPORTING, construir el `Money` del hecho una sola vez por fila (hoy se parsea en TRANSACTIONS para normalizar la escala y otra vez en REPORTING), sin cambiar el DTO del contrato (`FlowMoneyDto` sigue siendo texto).

Ambas son internas y con la misma salida; TC-REPORTING-REPORTS-055 (capa de aplicación) y los tests de `pg-nominal-flows` las cubren. Si no hace falta, la tarea queda `[x]` con la nota de la medición.

Proyección con las decisiones 1 y 2 (estimación, no medida): ~180–200 ms p50 dentro de la unidad de trabajo en local, ≈ 330–360 ms en un AMD EPYC 7763.

### Decisión 4: sin índices ni migraciones

La consulta de flujos lee el ~64 % de las porciones del workspace (rango de 24 meses de un dataset de 60); un `Seq Scan` con `Hash Join` en caché (6 518 buffers) es lo correcto, y su costo (67 ms, 15 % de la petición) crece linealmente. Un índice sobre `txn.transaction_split (workspace_id, category_id)` o uno cubriente no reduce las filas leídas. Por eso no hay archivo de migración ni `CREATE INDEX CONCURRENTLY`; si un cambio futuro lo necesitara, va expand-only en archivo propio con timestamp posterior a la última migración de `main`.

### Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Subir el umbral o separar el de 24 meses | D448: no se toca el umbral |
| Runner más grande o fijo | D444 (mantener `ubuntu-latest`); además no ataca el crecimiento cuadrático |
| Índice nuevo o reescritura de la consulta de flujos | El SQL es el 15 % y su plan es el correcto (Decisión 4) |
| Agregar en SQL por categoría de primer nivel y mes | El árbol de categorías es de CLASSIFICATION y la consulta es de TRANSACTIONS: pasar el mapa al contrato es un cambio de contrato; la valoración por día exige igual acumular por día, así que las filas bajan poco y el costo cuadrático de la matriz y del resolvedor sigue |
| Valorar por mes en lugar de por día | Cambia el comportamiento (la tasa es la del día de cada flujo, D109) |
| Caché, `ETag` o read model | El benchmark mide sin `If-None-Match`; un read model es un cambio de arquitectura que la alerta `ReportsReadModelRecommended` reserva para cuando el p95 de 7 días supere 600 ms en producción |
| Hilos de trabajo o paralelismo | Complejidad sin atacar la causa; el trabajo, ya lineal, es pequeño |
| Memorizar `rateFor` por (par, instante) dentro del lote | Las solicitudes del lote ya son distintas entre sí; no reduce el recorrido por solicitud |

## Contratos

Sin cambios: ni OpenAPI (oasdiff limpio, sin `ErrorCode` nuevos), ni eventos, ni puertos públicos (`@pf/fx/contracts`, `@pf/transactions/contracts`, `@pf/reporting/contracts`). Los cambios son internos del dominio de REPORTING y FX (y, en contingencia, de la infraestructura de TRANSACTIONS y la aplicación de REPORTING).

**Comportamiento:** no cambia. Los dos requirements ADDED fijan la misma respuesta y el costo acotado; los TC de equivalencia comparan contra copias literales de `TrendMatrix.build` y `RateResolver` de `main` 4cdc7689 conservadas en los archivos de test.

## Pruebas

| TC | Nivel | Qué fija |
|---|---|---|
| TC-REPORTING-REPORTS-055 | dominio y aplicación, PBT | Matriz y DTO idénticos al oráculo (incluido el orden de `ratesUsed`), 6/12/24 periodos, con y sin normalización, fecha de transacción y de corte, tasas ausentes, empates |
| TC-REPORTING-REPORTS-057 | unidad | Lecturas de hechos ≤ 2 × hechos con un `Proxy` contador; filas valoradas ≤ 3 × agregados; igual con 6 y 24 periodos |
| TC-FX-RATE-009 | dominio, PBT | Resolvedor idéntico al oráculo en `tryResolve`, `resolve` y `resolveForConversion`, con empates de `asOf`, reemplazos, anomalías, tipos de un solo lado, institución, providers y cruzadas |
| TC-FX-RATE-010 | unidad | Lecturas de `asOf` ≤ 2 × candidatas + 200 × solicitudes con 10 000 candidatas y 2 000 solicitudes |
| TC-REPORTING-REPORTS-056 | rendimiento | Fila `report-trends-24m` ≤ 800 ms siempre; objetivo interno ≤ 400 ms en AMD; sin regresión de las demás filas |

Los PBT llevan semilla fija, ≥ 300 corridas y timeout explícito (CI es más lento). Los contadores reemplazan a los tiempos en `unit` porque el tiempo depende de la CPU del runner, que es justamente lo que hace variar la fila.

## Riesgos / Trade-offs

- **Orden de `ratesUsed`:** depende del orden en que se consultan las tasas; la Decisión 1 lo preserva y TC-REPORTING-REPORTS-055 lo compara. Si una optimización futura de la matriz lo cambiara, sería un cambio visible del `meta` (no de cifras) y requeriría su propio requirement.
- **Resolvedor compartido:** un error en el índice afectaría toda valoración. Mitigación: oráculo por PBT con generadores que cubren todos los filtros del `pick` y los empates, y los tests existentes sin cambios.
- **Memoria:** el índice duplica referencias a las candidatas del lote (ya cargadas); despreciable frente a la lista actual.
- **Objetivo interno no alcanzado:** la Decisión 3 es la contingencia; si aun así un AMD supera 400 ms, se informa al owner con la medición en lugar de cerrar el change (tarea 6.3).

## Plan de migración

Sin migraciones ni configuración. Despliegue normal; reversión con el revert del PR (no hay estado persistido nuevo).

## Preguntas abiertas

Ninguna para el owner: la solución es técnica, no cambia el comportamiento y respeta D448. El objetivo interno de 400 ms es un criterio de cierre propuesto por el diseño, no un umbral nuevo.
