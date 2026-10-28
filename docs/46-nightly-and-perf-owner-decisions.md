# 46: Respuestas del owner sobre el nightly, la demo y el rendimiento (2026-10-21) y decisiones D283–D290

> **Estado:** Registrado · **Fecha:** 2026-10-21 · **Relacionado:** [44-fix-nightly-pipeline-questions.md](44-fix-nightly-pipeline-questions.md), [45-fix-demo-golden-clock-dependence-questions.md](45-fix-demo-golden-clock-dependence-questions.md), [43-phase-5-owner-answers-2026-10-16.md](43-phase-5-owner-answers-2026-10-16.md) (D256–D282), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), changes `fix-nightly-pipeline` (46), `fix-demo-golden-clock-dependence` (47), `investigate-perf-under-load` (48) y `optimize-rls-policy-overhead` (49), preguntas nuevas en [47-investigate-perf-under-load-questions.md](47-investigate-perf-under-load-questions.md)

La numeración continúa la de docs/43 (último id usado: D282). Este documento registra cada respuesta **tal cual** y su consecuencia en una línea; el detalle lo desarrolla cada change en su design, tasks, specs y TC.

## Mensaje del owner (tal cual)

- **2026-10-21:** "Toma mis recomendaciones y crea el change de investigación".

Se lee como la adopción de la opción recomendada en cada pregunta abierta de docs/44 y docs/45, que la sesión principal le presentó ese mismo día, y como la orden de redactar el change de investigación del rendimiento bajo carga. En la pregunta 1 de docs/44 la recomendación tocaba un check requerido; el owner la confirma de forma explícita con este mensaje, con el alcance que fija D283. En la pregunta 5 de docs/44 la recomendación era un change aparte de optimización; se redacta como `optimize-rls-policy-overhead` (D287).

## Respuestas del owner

### Nightly (docs/44, change 46 `fix-nightly-pipeline`)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D283 | docs/44, pregunta 1: cobertura del shared-kernel también en el gate de PR | "Toma mis recomendaciones" → (a) | El job `unit` de `pr.yml` (check requerido) pasa a ejecutar, además de `pnpm test`, la cobertura de `@pf/shared-kernel` con los mismos umbrales (≥ 95 % de líneas y ≥ 90 % de ramas, NFR-MAINT-002). El owner confirma de forma explícita que se acepta que ese check requerido exija más. **No cambian** la lista de checks requeridos, sus nombres, la protección de `main` ni el `timeout-minutes` del job (15 min): solo lo que ejecuta el job. Grupo 8.1 del change 46. |
| D284 | docs/44, pregunta 2: aviso por issue de `regression` y `mutation` | Ídem → (a) | Un issue por job con título fijo ("nightly regression: falló" y "nightly mutation: falló"), con el mismo patrón de D270: busca el abierto antes de crear, comenta si existe, y `issues: write` declarado solo en esos dos jobs (además de `perf` y `fx-smoke-live`), nunca a nivel de workflow. Grupo 8.2 del change 46. |
| D285 | docs/44, pregunta 3: el job `perf` mientras siga en rojo una fila de throughput | Ídem → (a) | El job `perf` sigue bloqueante en el nightly. El issue "nightly perf: umbral superado" (D270) queda abierto y recibe cada noche el resumen completo. Ninguna fila roja pasa a informativa ni se mueve a otro job mientras la investiga el change 48. |
| D286 | docs/44, pregunta 4: piso absoluto del criterio de RLS | Ídem → (a) | Se mantiene el piso de 0.5 ms junto con el 10 % de D43, el IC95 de 200 pares y la brecha estructural por plan distinto. TC-PLATFORM-PIPELINE-015..017 pasan de `provisional` a `confirmed`. |
| D287 | docs/44, pregunta 5: el sobrecosto de RLS resultó real | "Toma mis recomendaciones" → (a), change aparte | Se redacta el change `optimize-rls-policy-overhead` (49): reescribir las políticas para que el contexto de workspace no agregue un nodo por fila al plan, sin debilitar el aislamiento (RLS habilitada y forzada, fail-closed con `PF002`, registro en `platform.workspace_scoped_table`). La fila «saldo por cuenta (índice INCLUDE)» **no** pasa a informativa. |

### Datos demo y reloj (docs/45, change 47 `fix-demo-golden-clock-dependence`)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D288 | docs/45, pregunta 1: ¿la demo sigue el reloj de la instalación después de la carga? | "Toma mis recomendaciones" → (a) | Demo viva: el workspace demo evoluciona con el reloj como un workspace real. El requirement Should "El workspace demo sigue el reloj de la instalación después de la carga" queda confirmado y TC-IDENTITY-DEMO-024 pasa de `provisional` a `confirmed`. No se abre el change de "demo congelada". La opción (c) (aviso "Cargada el <fecha>") queda como posible mejora de UI, sin change. |
| D289 | docs/45, pregunta 2: ¿se recalcula la ancla si el job de carga corre otro día? | Ídem → (a) | Se mantiene la ancla de la solicitud (`anchorDate` de `identity.demo.load_requested`); no se recalcula al empezar el job. Con D288 y D289 se cierra la tarea 6.3 del change 47. |

### Rendimiento bajo carga (nuevo change)

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D290 | docs/38 §4: rendimiento de los consumidores tras el Large Seed y p95 de disponible para gastar en el nightly | "crea el change de investigación" | Se redacta el change `investigate-perf-under-load` (48), que reúne los tres síntomas rojos o bajo meta del job `perf` con un posible origen común (el backlog del outbox del Large Seed): TC-COMMITMENTS-MATCH-012, los dos benchmarks de `spendable.perf` (TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018) y el throughput informativo de NFR-PERF-008. Reemplaza las propuestas sin redactar `investigate-consumer-throughput` y "una investigación del spendable" de docs/38 §4. Su entregable es un informe con la causa medida y un camino por cada rojo; sus preguntas nuevas están en [docs/47](47-investigate-perf-under-load-questions.md). |

## Efecto en los changes

- **46 `fix-nightly-pipeline`:** D283 y D284 entran al delta (`platform/delivery-pipeline`: 2 requirements ADDED más, 1 Must y 1 Should) con TC-PLATFORM-PIPELINE-020..023; el grupo 8 queda listo para implementar. D285 y D286 confirman lo implementado. D287 confirma que la fila RLS INCLUDE sigue bloqueante y sale de este change hacia el 49.
- **47 `fix-demo-golden-clock-dependence`:** D288 y D289 confirman la implementación; la tarea 6.3 se marca `[x]`.
- **48 `investigate-perf-under-load`:** nuevo (D290).
- **49 `optimize-rls-policy-overhead`:** nuevo (D287).

## Decisiones posteriores

| ID | Pregunta | Decisión |
|---|---|---|
| D304 | `fix-demo-golden-clock-dependence` 3.1: TC-IDENTITY-DEMO-023 también pasa con el código anterior al arreglo (el cargador viejo compara saldos a la fecha ancla y el retiro del 2026-10-02 no entra), así que no hubo rojo previo del TDD | **Se acepta como guarda de regresión** (2026-10-28). El arreglo lo respaldan el CI de #154, TC-IDENTITY-DEMO-022 y el diagnóstico de la tarea 5.2, que reproduce el fallo con el código anterior. El change se archiva. |
| D305 | `fix-nightly-pipeline` 8.6: verificación en GitHub con un PR de prueba que baja la cobertura y fuerza fallos en `regression` y `mutation` | **Autorizada** (2026-10-28): PR en borrador sin auto-merge, se cierra sin fusionar y se borran la rama y los issues de prueba. |

## Pendiente del owner

Las preguntas nuevas de los changes 48 y 49 están en [docs/47](47-investigate-perf-under-load-questions.md). Ninguna bloquea la redacción; las marcadas allí como bloqueantes condicionan el orden de implementación.
