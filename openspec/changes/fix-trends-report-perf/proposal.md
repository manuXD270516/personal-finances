# Propuesta: fix-trends-report-perf

## Why

La fila `report-trends-24m` del nightly (`GET /reports/trends` con 24 meses calendario sobre el Large Seed, NFR-PERF-006, p95 ≤ 800 ms, `apps/api/test/perf/nightly.perf.ts`) quedó en rojo el 2026-11-23 y su resultado depende del runner:

| Run (nightly programado) | CPU | p50 | p95 |
|---|---|---|---|
| 45231166087 (2026-11-23) | AMD EPYC 7763 | 739 ms | 845 ms (falló) |
| 44760461447 (2026-11-20) | AMD EPYC 9V74 | 705 ms | 772 ms |
| 45032465801 (2026-11-22, mismo commit que el 23) | Intel Xeon 6975P-C | 491 ms | 514 ms |
| 44913986214 (2026-11-21) | Intel Xeon 6975P-C | — | 493 ms |

Diagnóstico a escala 1 (design §Diagnóstico; Large Seed con 40 346 porciones en los 24 meses, 21 212 filas agregadas por día, categoría y moneda, cuatro monedas y 730 días): de los 454 ms (p50) que tarda la petición dentro de la unidad de trabajo, **solo ~80 ms son SQL** (48 sentencias, sin N+1; la consulta de flujos tarda 67–74 ms con un plan correcto y 6 518 buffers en caché). **El resto es JavaScript de un solo hilo**, por eso escala con la CPU (≈ 1,65× entre el AMD EPYC 7763 y el Xeon 6975P-C, en línea con H1 de docs/67):

- **Matriz de tendencias, 200 ms (44 %)**: `TrendMatrix.build` filtra la lista completa de ~20 400 hechos por cada serie y cada periodo (8 × 24 = 192 pasadas) más una por categoría de primer nivel para el ranking: costo hechos × series × periodos. Crece de 27 ms (6 meses) a 64 ms (12) y 200 ms (24).
- **Resolución de tasas, 108 ms (24 %)**: `RateResolver.pick` (FX) recorre y vuelve a interpretar con `Date.parse` todas las tasas candidatas del rango por cada una de las ~2 000 solicitudes (moneda × día), hasta cuatro veces por solicitud con la cruzada: costo solicitudes × candidatas. Crece de 26 ms (6 meses) a 50 ms (12) y 108 ms (24). La consulta SQL de candidatas tarda 0,7 ms.
- **Lectura de hechos, 135 ms (30 %)**: 67 ms de SQL y ~65 ms de armado de `Money` (dos `Money.parse` por fila, uno en TRANSACTIONS y otro en REPORTING).

El owner decidió optimizar la consulta **sin tocar el umbral de 800 ms** (D448, [docs/70](../../../docs/70-trends-report-perf-decisions.md)).

## What Changes

- **Matriz de tendencias en una sola pasada** (REPORTING, dominio puro): cada hecho se asigna una vez a su categoría de primer nivel y a su periodo, con acumulación por (serie, día, moneda); el ranking, las celdas y los totales se valoran con la misma política sobre esos acumulados. Misma respuesta, incluido el orden de `meta.conversion.ratesUsed`.
- **Resolvedor de tasas indexado** (FX, dominio puro): al construirse, `RateResolver` filtra una vez las candidatas usables, interpreta su `asOf` una vez y las indexa por par no ordenado y por instante; cada `pick` toma por búsqueda binaria solo las de su par y su ventana, en el orden original. Mismo resultado para toda solicitud; beneficia a todos los usos de la valoración por lote (reportes, dashboard, cartera, deudas, compromisos).
- **Lectura de hechos (contingencia)**: solo si tras los dos puntos anteriores la medición local no alcanza el objetivo (design §Decisión 3), evitar el doble `Money.parse` y el `await` por fila en el armado de `summarizeNominalFlows`, sin cambiar el contrato.
- Sin índices ni migraciones: el plan de la consulta de flujos es el correcto para un agregado sobre el ~64 % de las porciones (design §Decisión 4).
- Sin cambios de API, eventos, tablas, configuración ni del umbral de NFR-PERF-006; la fila del nightly no cambia.
- Spec: 1 requirement ADDED en `reporting/financial-reports` y 1 en `fx/market-rates`, que fijan la misma respuesta y el costo acotado (no cambian el comportamiento observable).

**Fuera de alcance:** cambiar el umbral, el rango o las iteraciones del benchmark; un read model o caché de reportes (la alerta `ReportsReadModelRecommended` sigue como está); el runner del nightly (D444); la consulta de flujos y su contrato; los demás reportes más allá del beneficio indirecto del resolvedor.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `reporting/financial-reports`: el reporte de tendencias se calcula sin recorrer los hechos por cada celda, con la misma respuesta (1 requirement ADDED, Should, 2 scenarios).
- `fx/market-rates`: la resolución de tasas por lote tiene un costo acotado, con el mismo resultado que la consulta individual (1 requirement ADDED, Should, 2 scenarios).

## Impact

**Specs impactadas:** `reporting/financial-reports` (1 ADDED), `fx/market-rates` (1 ADDED).

**Componentes/contextos impactados:** REPORTING dominio (`TrendMatrix` en `packages/contexts/reporting/src/domain/extended-reports.ts`); FX dominio (`RateResolver` en `packages/contexts/fx/src/domain/rate-resolver.ts`). Contingente: TRANSACTIONS infraestructura (`pg-nominal-flows.ts`) y REPORTING aplicación (`loadFacts`). Ningún puerto ni contrato público cambia.

**APIs impactadas:** ninguna; `contracts/openapi` sin cambios (oasdiff limpio).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna (ni índice ni `CREATE INDEX CONCURRENTLY`).

**Test cases:** AÑADIDOS TC-REPORTING-REPORTS-055 (equivalencia de la matriz contra la implementación anterior, PBT), TC-REPORTING-REPORTS-056 (rendimiento: umbral de 800 ms y objetivo interno de 400 ms en AMD), TC-REPORTING-REPORTS-057 (costo lineal de la matriz, sin medir tiempo), TC-FX-RATE-009 (equivalencia del resolvedor contra la implementación anterior, PBT) y TC-FX-RATE-010 (costo acotado del lote, sin medir tiempo). MODIFICADOS: ninguno (TC-REPORTING-REPORTS-041 y -053 y los de `rate-resolver.test.ts` siguen sin cambios). DEPRECADOS: ninguno.

**Invariantes:** INV-020 (tasa válida dentro de la ventana) e INV-032 (inversa vinculada, sin redondeo) no cambian; las prueba TC-FX-RATE-009. La valoración de reportes sigue sin redondeo intermedio y con HALF_EVEN solo al presentar.

**Impacto de regresión:** el resolvedor es compartido por toda valoración por lote; la equivalencia por PBT contra el resolvedor anterior y los tests existentes de FX, reportes, dashboard y cartera cubren el riesgo. Las filas `report-*`, `reports-summary` y de dashboard del nightly no deben empeorar (TC-REPORTING-REPORTS-056).

**Riesgos introducidos:** ninguno registrado. El índice del resolvedor ocupa memoria proporcional a las candidatas del lote (ya cargadas hoy); el orden de las tasas usadas en `meta.conversion.ratesUsed` depende del orden de valoración y se preserva explícitamente (design §Decisión 1).

**Relación con otros changes:** D449 (mismo doc): el nightly del 2026-11-23 cuenta para la tarea 8.1 de `stabilize-import-persist-perf`. La causa común de la sensibilidad a la CPU del runner (H1 de docs/67) no cambia; este change baja el trabajo de CPU de la fila.
