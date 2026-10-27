# 52: Respuestas del owner sobre el informe de rendimiento bajo carga (2026-10-27) y decisiones D299–D303

> **Estado:** Registrado · **Fecha:** 2026-10-27 · **Relacionado:** [51-perf-under-load-questions.md](51-perf-under-load-questions.md) (preguntas), [50-perf-under-load-findings.md](50-perf-under-load-findings.md) (informe), [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D291–D296), [49-rls-no-migration-decision.md](49-rls-no-migration-decision.md) (D298), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), changes [`investigate-perf-under-load`](../openspec/changes/investigate-perf-under-load/proposal.md) (48) y [`fix-imports-perf-connection-budget`](../openspec/changes/fix-imports-perf-connection-budget/proposal.md)

La numeración continúa la de docs/49 (último id usado: D298). Este documento registra cada respuesta **tal cual** y su consecuencia; el detalle lo desarrolla cada change en su design, tasks y TC.

## Mensaje del owner (tal cual)

- **2026-10-27:** "Toma mis recomendaciones de docs/51".

Se lee como la adopción de la opción recomendada en cada una de las cinco preguntas de docs/51: 1 → (a), 2 → (a), 3 → (b), 4 → (a), 5 → (a).

## Evidencia nueva desde docs/51

Las preguntas se redactaron el 2026-10-25, antes de dos nightlies programados con todo el change 48 fusionado:

| Corrida | Fecha | Commit | Resultado |
|---|---|---|---|
| 40186569273 (programada, `main`) | 2026-10-25, 10:52–11:51 UTC | 72ff10d | `regression`, `mutation`, `fx-smoke-live` y `perf` en verde. S1 (TC-COMMITMENTS-MATCH-012) y S2 (`spendable`) en OK con la purga, la espera de quietud y el orden fijo |
| 40322158874 (programada, `main`) | 2026-10-26 | 69d8388 | `regression`, `mutation` y `fx-smoke-live` en verde. `perf` en rojo **solo** por `imports.perf.ts` [TC-IMPORTS-CSV-029]: `AssertionError: expected 123458.95 to be less than or equal to 120000` (el drenado de los consumidores tardó 123,5 s después de la persistencia, frente a 120 s; la suite entera, 335 s). En las demás suites, purga y quietud correctas (solo `spendable` esperó 40 s, con carga 2,97, y purgó 1 386 726 trabajos); MATCH-012 y `spendable` sin fallo |

El fallo del 26 **no** es el de conexiones que vio el informe (`timeout exceeded when trying to connect`, E10). El síntoma de `imports.perf` es entonces doble: conexiones (E10, sin medir) y un drenado marginal (123,5 s frente a 120 s). S1 y S2 pasaron en dos nightlies programados seguidos.

## Respuestas del owner

### Change 48 `investigate-perf-under-load` y su seguimiento

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D299 | docs/51, pregunta 1: `imports.perf` falla por conexiones | "Toma mis recomendaciones de docs/51" → (a) | Se abre el change de seguimiento **`fix-imports-perf-connection-budget`**, con el alcance ampliado a las **dos manifestaciones** del rojo de `imports.perf.ts`: (1) adquisición de conexiones que vence (`timeout exceeded when trying to connect`, E10) y (2) drenado marginal de los consumidores por encima de 120 s después de la persistencia (123,5 s en el programado 40322158874 del 2026-10-26). Primero se mide (conexiones por pool frente a `max_connections` del contenedor, y drenado por consumidor) y después se corrige el benchmark o el producto según la causa. El umbral de 120 s (D112, TC-IMPORTS-CSV-029) no cambia, no se sube `max_connections` del contenedor sin medir (descarta la opción c) y el presupuesto de conexiones de producción no cambia sin una justificación medida. No se incluye en el change 48 (descarta la opción b). |
| D300 | docs/51, pregunta 2: umbral de throughput por consumidor con handler real | Ídem → (a) | La fila de throughput por consumidor con handler real del nightly **sigue informativa y sin umbral** hasta que un change de optimización mida E6–E8 (duración por evento, locks y un consumidor a la vez) y proponga umbrales por consumidor, que se decidirán en una pregunta aparte. No se fija un piso con la corrida 39669892721 ni un umbral único de 42 ev/s. NFR-PERF-008 sigue verificándose con handler trivial (TC-PLATFORM-EVENTS-014). Precisa D292. |
| D301 | docs/51, pregunta 3: change de producto para el throughput de los consumidores | Ídem → (b) | **`optimize-consumer-throughput` se difiere a Phase 6**, junto con la escritura masiva del import (`RecordImportedTransactions`, D152), que cambia el perfil de eventos por import. No se redacta ahora. La fila informativa de D300 es la señal: si empeora, se vuelve a abrir la pregunta con esa evidencia. Queda en el roadmap de Phase 6 (docs/38). |
| D302 | docs/51, pregunta 4: runner del job `perf` con la precondición de quietud | Ídem → (a) | Se sigue con el **runner estándar** de 4 CPU (D293) y la espera de quietud del host con tope (5 min; si no se alcanza, la suite falla con `interferencia`). No se contrata un runner más grande ni se mueve `perf` al VPS N1. Se vuelve a preguntar **solo** si la duración del job se acerca a `timeout-minutes: 240`. Duración real de los nightlies recientes: `perf` ≈ 60 min (2026-10-25: 10:52–11:51 UTC; el 2026-10-26, del mismo orden), lejos del tope. |
| D303 | docs/51, pregunta 5: cierre del change 48 con S3 sin causa por consumidor | Ídem → (a) | El change 48 **se cierra con S1 y S2 medidos y confirmados por la tarea 7.2**: dos nightlies programados seguidos con la purga y la quietud, ya cumplidos el 2026-10-25 (40186569273) y el 2026-10-26 (40322158874; su único rojo es `imports.perf`, fuera del alcance y cubierto por D299). S3 queda con camino (d), change de optimización, diferido por D300 y D301. **No** se repiten E10 ni E11 ×3 ni se lanzan E6–E8: los experimentos 3.x no hechos se cierran como no necesarios o diferidos. |

## Efecto en los changes

| Change | Efecto |
|---|---|
| 48 `investigate-perf-under-load` | Sin preguntas abiertas. Tareas 3.1–3.6 cerradas como no necesarias o diferidas (D300–D303, con la evidencia de [docs/50](50-perf-under-load-findings.md)); 8.1 y 8.2 cerradas con el resumen en docs/23 §5.5 y las notas de los TC; TC-PLATFORM-PIPELINE-027 pasa a `manual`. **Listo para archivar** tras fusionar el PR de este registro. |
| `fix-imports-perf-connection-budget` (nuevo) | Redactado con este registro (D299): medir primero conexiones y drenado por consumidor, luego corregir el benchmark o el producto. Orden de implementación: **ahora**, antes de Phase 6; es lo único que deja el nightly en rojo. Mediciones por `workflow_dispatch` de `nightly` desde una rama no fusionada. |
| `optimize-consumer-throughput` (sin redactar) | Diferido a Phase 6 con la escritura masiva del import (D301); medirá E6–E8 y propondrá los umbrales por consumidor de D300. |
| Job `perf` del nightly | Sin cambios de runner ni de umbrales (D302); la fila de throughput con handler real sigue informativa (D300). |

## Pendiente del owner

Ninguna pregunta de docs/51 queda abierta. Puede volver al owner: la duración del job `perf` si se acerca a 240 min (D302), el umbral por consumidor cuando el change de optimización mida E6–E8 (D300), y, dentro de `fix-imports-perf-connection-budget`, una pregunta nueva si la medición pide cambiar el presupuesto de conexiones de producción o el umbral de 120 s.
