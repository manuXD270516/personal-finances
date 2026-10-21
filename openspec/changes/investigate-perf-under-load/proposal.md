# Propuesta: investigate-perf-under-load

## Why

Tras `fix-nightly-pipeline`, el job `perf` del nightly sigue en rojo (y bloqueante, D285) por filas que no tienen una causa medida. En la corrida manual 39669892721 (2026-10-21, commit 68f01e5) aparecen tres síntomas que podrían compartir un origen, el backlog del outbox que deja el Large Seed (~470 165 eventos pendientes al terminar la carga, que los consumidores drenan a 0,1–8 ev/s mientras se miden otros benchmarks sobre la misma base):

1. **TC-COMMITMENTS-MATCH-012:** el matcher de compromisos no drena su ráfaga a tiempo: ~6 ev/s frente a ≥ 42 ev/s (NFR-PERF-008, D112).
2. **Disponible para gastar (`spendable.perf`):** los dos benchmarks de TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018 dan p95 de 352,2 ms y 341,1 ms frente a 300 ms (NFR-PERF-004). Es la primera vez que se miden: antes caían con 429 por las cuotas.
3. **Throughput de los consumidores (NFR-PERF-008, informativo):** todos los consumidores reales procesan entre 0,04 y 9 ev/s frente a ≥ 42 ev/s.

No se sabe si son defectos del producto o un artefacto del benchmark: todas las suites comparten una sola base y el orden de los archivos no está fijado, de modo que una suite puede medir con el backlog del Large Seed todavía en las colas. Ajustar umbrales o pasar filas a informativas sin conocer la causa escondería un problema real; corregir el producto sin medir puede atacar la causa equivocada. El owner pidió un change de investigación (D290, docs/46).

## What Changes

- **Instrumentación del benchmark:** el reporte de `perf` publica, al empezar cada suite y cada benchmark, la carga de fondo de la base (eventos pendientes en el outbox, trabajos pendientes por cola de consumidor, conexiones activas por rol y estado, esperas de locks) y la carga del host (CPU, promedio de carga), y el orden real en que corrieron los archivos.
- **Mediciones controladas** (experimentos E1–E8 del design) desde una rama de investigación por `workflow_dispatch`, para aceptar o descartar cada hipótesis: backlog compartido en las colas, contención de CPU y de conexiones en el runner de 4 CPU, volumen y estado de la base tras el Large Seed (estadísticas, autovacuum, bloat), contención de locks e índices, consumidores concretos lentos (p. ej. `planning.journal-entry-posted`, `reporting.data-version`), presupuesto de conexiones 22 + 33 = 55 de 60, y lentitud real de las consultas de disponible para gastar.
- **Informe con la causa medida** de cada síntoma, en un doc nuevo de `docs/`, con la evidencia, la propuesta de arreglo y, si procede, los changes de seguimiento.
- **Aislamiento del benchmark de la carga de fondo** (requirement Must): cada suite empieza sin backlog ajeno, o falla indicando la interferencia; el mecanismo lo decide el owner (pregunta 1 de docs/47).
- **Umbrales protegidos:** un test de política fija los umbrales de los benchmarks a los de docs/02; cambiar uno exige una decisión del owner registrada.
- **Criterio de salida:** al cerrar el change, cada test rojo de `perf` tiene causa medida y un camino: arreglo del benchmark, arreglo del producto (change de seguimiento), ajuste de umbral justificado y aprobado por el owner, o change de optimización.
- **Fuera de alcance:** optimizar las políticas RLS (change `optimize-rls-policy-overhead`, D287); implementar dentro de este change un arreglo del producto (va en un change de seguimiento); cambiar umbrales de NFR sin decisión del owner; pasar filas a informativas (D285); cambiar la protección de `main` o los checks requeridos; la persistencia del import ≤ 20 s (Phase 6, D152).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/delivery-pipeline`: el benchmark nocturno mide sin interferencia de carga de fondo y publica esa carga; causa de los rojos de rendimiento documentada antes de cambiar un umbral (2 requirements ADDED: 1 Must, 1 Should).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (2 requirements ADDED; no cambia los 4 de la spec principal ni los que agregan `add-dependency-updates` y `fix-nightly-pipeline`, sin archivar). Leídas sin cambios: `platform/event-delivery` (rendimiento sostenido de los consumidores), `reporting/dashboard` (rendimiento del disponible), `commitments/recurrence-engine` (candidatas para filas de un import).

**Componentes/contextos impactados:** ningún código de producción en este change. Harness de rendimiento `apps/api/test/perf/` (`perf-report.ts` y su test, `nightly.perf.ts`, `commitments.perf.ts`, `spendable.perf.ts`, un helper de carga de fondo y el mecanismo de aislamiento que elija el owner); test de política `scripts/delivery-policy/test/nightly-policy.test.ts`; `.github/workflows/nightly.yml` solo si el mecanismo de aislamiento elegido lo requiere (pregunta 1 de docs/47). Los experimentos corren desde una rama de investigación que no se fusiona. Los arreglos del producto, si los hay, van en changes de seguimiento.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna (solo lectura de `platform.outbox`, las colas de eventos y las vistas de estadísticas de PostgreSQL en la base efímera del benchmark).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-PIPELINE-024..028 (5). MODIFICADOS — ninguno en su comportamiento esperado; al cerrar el change se anotan causa y camino en TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018. DEPRECADOS — ninguno.

**Impacto de regresión:** el job `perf` puede tardar más (instrumentación y, según la opción de aislamiento, purga del backlog o una base por suite). No se quita ni se relaja ningún benchmark.

**Riesgos introducidos:** ninguno registrado. Riesgos del diseño: experimentos caros (cada corrida del job `perf` tarda 2–4 h) y con varianza entre runners; un `workflow_dispatch` de `nightly` cancela una corrida en curso (`concurrency: nightly`); aislar el backlog puede esconder un defecto real si no se mide también el escenario con carga (por eso el informe mide ambos).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX, periodos ni redondeo).
