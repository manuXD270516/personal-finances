# 59: Informe de rendimiento de los consumidores de eventos (change 51, `optimize-consumer-throughput`)

> **Fecha:** 2026-10-29 · **Change:** `optimize-consumer-throughput` (Phase 6, D300, D301, D307, D311, D312) · **Rama de experimentos (no fusionada):** `claude/throughput-experiments` · **Relacionado:** [50](50-perf-under-load-findings.md), [53](53-imports-perf-findings.md), [57](57-phase-6-consolidation-decisions.md)

Medición previa a la optimización (E6–E10b del diseño), conversión de los consumidores y medición posterior. Todas las corridas son `workflow_dispatch` de `nightly` sobre la rama de experimentos, con un grupo de concurrencia propio por corrida (no cancelan a las programadas), `ubuntu-latest` (2 vCPU, Testcontainers, PostgreSQL 18). Los números son del job `perf`; «ráfaga» = 5 000 transacciones importadas cuyos 15 000 hechos quedan pendientes a la vez (peor caso del perfil de `add-bulk-imported-transactions`).

## 1. Método

- **Suite nueva `throughput.perf.ts` (informativa, D300).** Fase A (E6, E7, E9, E10b): se persisten 5 000 transacciones con el worker sin los seis consumidores de la ráfaga (el relay sigue publicando en sus colas), se detiene ese worker y arranca otro con la **configuración de la plantilla del host** (`EVENT_CONSUMER_CONCURRENCY=1`, `DATABASE_POOL_MAX=34`); se mide el drenado de cada cola y del outbox desde el arranque, la duración por evento de cada consumidor (histograma exacto del worker, no por buckets) y las esperas por bloqueos (`pg_stat_activity` con `wait_event_type = 'Lock'` cada segundo, una conexión propia). Fase B (E8): otro backlog igual y cada consumidor lo drena **solo**, uno tras otro.
- **`imports.perf.ts`** mide el import de 5 000 filas con las dos configuraciones (código: concurrencia 4, pool 52; host: concurrencia 1, pool 34; API 22 en ambas; suma de pools 85 y 67 de 97 útiles). Desde D311 la fila del host es bloqueante y la del código informativa.
- Motivo de los reintentos (E10b): cada cola con trabajos reintentados se clasifica en `expiración` o `fallo del handler` por el último error de pg-boss.

## 2. Antes: la ráfaga con la configuración del host (E9)

Tiempo desde el arranque del worker hasta dejar la cola en 0, en segundos (presupuesto 120 s, D112):

| Consumidor (entregas) | A. `40844615946` (sin Large Seed, runner rápido) | B. `40844583500` (sin Large Seed, runner lento) | C. `40844620056` (con Large Seed) |
|---|---|---|---|
| `reporting.data-version` (15 000) | 70,0 | **114,3** | **176,8** |
| `debt.card-activity` (10 000) | 59,4 | 90,3 | **127,9** |
| `commitments.occurrence-matcher` (5 000) | 49,3 | 72,8 | 95,4 |
| `goals.balance-watch` (5 000) | 41,9 | 59,0 | 76,0 |
| `planning.budget-thresholds` (5 000) | 41,9 | 58,4 | 76,0 |
| `planning.journal-entry-posted` (5 000) | 37,7 | 54,7 | 71,8 |
| outbox | 0,3 | 0,7 | 1,4 |
| persistencia del import (s) | 52,7 | 98,0 | 132,9 |

Run ids: A `40844615946`, B `40844583500` y C `40844620056` (2026-10-29, 08:46–10:00 UTC, commit `c60c382` de la rama de experimentos, que es `main` `ae23536` más la instrumentación).

**Hallazgos.**

1. **Con handler real y concurrencia 1, la ráfaga completa NO cabe en 120 s con el Large Seed** (C): `reporting.data-version` tarda 176,8 s y `debt.card-activity` 127,9 s; en el runner lento sin seed (B) `reporting.data-version` queda a 5,7 s del límite. El margen depende del runner y del volumen de la base: entre A y C el mismo código pasa de 70 a 177 s.
2. **La causa es el costo fijo por entrega, no el efecto ni los bloqueos.** Duración por evento (p50/p95, C): `reporting.data-version` 1,92/6,88 ms; `debt.card-activity` 2,98/9,27; `planning.journal-entry-posted` 7,05/12,64; `planning.budget-thresholds` 8,31/14,78; `goals.balance-watch` 8,61/15,72; `commitments.occurrence-matcher` 12,78/23,80. Cada entrega son 5–6 sentencias de transacción (BEGIN, contexto RLS, retirado, inbox, COMMIT) además del efecto, y con 6 consumidores simultáneos en un servidor de 2 vCPU el ritmo compartido cae a menos de la mitad del ritmo aislado.
3. **Ritmo aislado (E8, C):** `reporting.data-version` 140,9 ev/s, `debt.card-activity` 118,9, `planning.budget-thresholds` 140,7, `planning.journal-entry-posted` 166,8, `goals.balance-watch` 147,7, `commitments.occurrence-matcher` 105,5. `reporting.data-version` necesita ≥ 125 ev/s y `debt.card-activity` ≥ 84 ev/s **solos**; los seis juntos rinden 52–85 ev/s.
4. **Bloqueos (E7): 0 ms en las tres corridas, fase A y B.** Ninguna espera por bloqueos de base de datos; los `FOR UPDATE` de `debt.card-activity` y las filas de `reporting.workspace_data_version` no se disputan con concurrencia 1.
5. **Relay (E9): no es un cuello.** El outbox queda en 0 entre 0,3 y 1,4 s después del arranque (el relay publicó durante la persistencia). Tarea 5.4 no aplica.
6. **Reintentos sin excepción (E10b): ninguno.** Sin trabajos reintentados ni `job failed` en las tres corridas; los lotes de 10 y `expireInSeconds` 300 s no producen expiraciones con la ráfaga.
7. **Perfil actual del import (persistencia lenta), `imports.perf.ts` en C:** persistencia 228 s (código) y 203 s (host); drenado tras la persistencia 14,7 s (código) y 23,2 s (host), ambas filas dentro del presupuesto: los consumidores van drenando mientras el import persiste. El problema aparece con la escritura masiva (persistencia ≤ 20 s), cuando los eventos llegan juntos: es el perfil de la fase A.

## 3. Consumidores agrupados

Condición de la decisión 3: el efecto sobre un conjunto de eventos de agregados distintos es el mismo en cualquier orden y equivale a aplicarlos de a uno. Los seis consumidores de la ráfaga la cumplen y se convirtieron; cada uno lleva un test de equivalencia (entregado de a uno frente a agrupado, órdenes y particiones al azar, PBT con timeout explícito):

| Consumidor | Efecto por grupo | Equivalencia |
|---|---|---|
| `reporting.data-version` | `bumpBy(workspace, n, max(occurredAt))`: una sentencia por grupo | misma versión y mismo `updated_at` |
| `debt.card-activity` | resuelve las tarjetas tocadas una vez, cancela los planes de compras anuladas o corregidas y sincroniza una vez cada tarjeta | mismos planes y mismos hechos de umbral (la sincronización lee el estado vigente y es idempotente) |
| `planning.journal-entry-posted` | `EnsurePeriods` a lo sumo una vez si alguna fecha cae fuera del rango cubierto | mismos periodos |
| `planning.budget-thresholds` | una `evaluateWorkspace` por grupo (reemplaza `WorkspaceCoalescer`, que se elimina) | mismos cruces y hechos |
| `goals.balance-watch` | reevalúa una vez cada cuenta distinta | mismo estado de sobre-asignación y mismos hechos |
| `commitments.occurrence-matcher` | una lectura de transacciones y vínculos por grupo y búsqueda de candidatas compartida por (tipo, cuenta, ventana); las anulaciones siguen expirando sus propuestas | exactamente 12 sugerencias con 12 compatibles entre 40 y reentregas (TC-PLATFORM-THROUGHPUT-010) |

Consumidores descartados por no ser independientes del orden: **ninguno** de los seis. Los demás consumidores del worker (22) no se tocan: reciben eventos de baja frecuencia.

Cambio de la plataforma: `EventConsumerDefinition.grouping`/`groupHandler`, lotes de `EVENT_CONSUMER_GROUP_BATCH_SIZE` (100; 1–500) por workspace en una transacción con inbox multi-fila, respaldo evento por evento y métricas `pf.events.consumer.group_size` y `pf.events.consumer.group_fallbacks`. Sin conexiones nuevas: 28 consumidores de concurrencia 1 + 4 reservadas = 32 de 34 (TC-PLATFORM-THROUGHPUT-009).

## 4. Después: la misma ráfaga con la entrega agrupada

Misma medición, commit `4868ad5` de la rama de experimentos (consumidores agrupados). Tiempo hasta dejar la cola en 0 desde el arranque del worker (s):

| Consumidor | D. `40854120702` (sin seed, runner rápido) | E. `40854130627` (sin seed, runner lento) | F. `40854125548` (con Large Seed) |
|---|---|---|---|
| `reporting.data-version` | 11,4 | 22,1 | 17,1 |
| `debt.card-activity` | 9,2 | 12,1 | 14,1 |
| `commitments.occurrence-matcher` | 9,2 | 12,7 | 15,1 |
| `goals.balance-watch` | 5,0 | 6,2 | 8,5 |
| `planning.budget-thresholds` | 5,6 | 6,2 | 8,5 |
| `planning.journal-entry-posted` | 5,0 | 6,2 | 8,5 |
| total (todos los consumidores) | 11,4 | 22,1 | 17,1 |
| persistencia del import (s) | 58,9 | 103,2 | 124,7 |

**Lectura.**

- La ráfaga con el Large Seed pasa de **176,8 s a 17,1 s** (10 veces) y en el runner lento sin seed de 114,3 s a 22,1 s (5 veces); el peor consumidor queda a 17 s de un presupuesto de 120 s, con un margen de 7 veces (antes de 0,7 veces).
- El costo por evento p50 baja de 1,9–12,8 ms a 0,08–1,8 ms (el grupo reparte su duración entre sus eventos); el ritmo aislado sube de 105–167 ev/s a 545–1 178 ev/s (F, fase B).
- `imports.perf.ts` con el Large Seed (F): drenado tras la persistencia 2,0 s (código) y 5,6 s (host), frente a 14,7 s y 23,2 s antes (C); la persistencia también baja (147 s y 123 s frente a 228 s y 203 s) probablemente porque los consumidores dejan de competir por CPU con la escritura (no se aisló la causa). El `outbox` de la fila del host tardó 5,6 s en vaciarse (1 664 hechos al cierre de la persistencia), dentro del presupuesto; sigue sin ser un cuello.
- Bloqueos 0 ms, sin reintentos ni fallos en las tres corridas posteriores. Los reportes no incluyen las métricas de grupo (no se exportan en el job); no hubo `job failed` que indique respaldos.
- Run ids de la medición posterior: D `40854120702`, E `40854130627` y F `40854125548` (2026-10-29, 10:00–11:00 UTC, commit `4868ad5`).

## 5. Umbrales por consumidor (D312)

El owner aceptó la recomendación: el umbral por consumidor es el **drenado de la ráfaga del import ≤ 120 s con la configuración del host**; el throughput sobre el backlog de 1,39 M del Large Seed queda informativo. Esa es la fila bloqueante de `imports.perf.ts` (D311). La suite `throughput.perf.ts` publica el costo por evento y el ritmo aislado como filas informativas. Ningún umbral de docs/02 cambió. Observación para el owner: la fila bloqueante de `imports.perf.ts` mide el perfil **actual** del import (persistencia lenta, los consumidores drenan mientras persiste: 23 s con el seed); el perfil de la ráfaga (peor caso con la escritura masiva) lo mide `throughput.perf.ts`, informativa. Si se quiere proteger ese perfil con un umbral bloqueante hay que decidirlo (pregunta 1 de [59](60-consumer-throughput-questions.md)).
