# 48: Respuestas del owner sobre el rendimiento bajo carga y la reescritura de RLS (2026-10-23) y decisiones D291–D296

> **Estado:** Registrado · **Fecha:** 2026-10-23 · **Relacionado:** [47-investigate-perf-under-load-questions.md](47-investigate-perf-under-load-questions.md), [46-nightly-and-perf-owner-decisions.md](46-nightly-and-perf-owner-decisions.md) (D283–D290), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), changes [`investigate-perf-under-load`](../openspec/changes/investigate-perf-under-load/proposal.md) (48) y [`optimize-rls-policy-overhead`](../openspec/changes/optimize-rls-policy-overhead/proposal.md) (49)

La numeración continúa la de docs/46 (último id usado: D290). Este documento registra cada respuesta **tal cual** y su consecuencia en una línea; el detalle lo desarrolla cada change en su design, tasks y TC.

## Mensaje del owner (tal cual)

- **2026-10-23:** "Toma las recomendaciones".

Se lee como la adopción de la opción recomendada en cada una de las seis preguntas de docs/47. Las preguntas 5 y 6 son condicionales: la decisión fija qué se hace **si** el experimento del change 49 llega a ese caso; no se adelanta ningún resultado.

## Respuestas del owner

### Change 48 `investigate-perf-under-load`

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D291 | docs/47, pregunta 1: cómo aislar las suites del backlog residual del Large Seed | "Toma las recomendaciones" → (a) | **Purgar el backlog residual** en la base efímera del benchmark al terminar la medición de throughput (marcar o borrar los eventos pendientes del outbox y vaciar las colas `events.*`), solo en el harness de pruebas y en un solo job. La medición con el backlog completo (S3) se conserva y la precondición de aislamiento hace fallar la suite con el veredicto `interferencia` si la purga no alcanza. No se crea una base por suite ni un job aparte; si el informe muestra que el volumen de la base (H3) también influye, se reconsidera la opción (b) con una pregunta nueva. Desbloquea el grupo 5 del change 48; TC-PLATFORM-PIPELINE-024 y 025 pasan de `provisional` a `confirmed`. |
| D292 | docs/47, pregunta 2: la fila de throughput por consumidor con handler real después del informe | Ídem → (a) | La fila de throughput por consumidor con handler real **sigue informativa** hasta que el informe proponga un umbral por consumidor; ese umbral se decide en una pregunta aparte. No pasa a bloqueante con 42 ev/s ni se elimina del nightly. NFR-PERF-008 sigue verificándose con handler trivial (TC-PLATFORM-EVENTS-014). |
| D293 | docs/47, pregunta 3: runner del job `perf` | Ídem → (a) | Se sigue con el **runner estándar** de GitHub (`ubuntu-latest`, 4 CPU, 16 GiB) y los umbrales de docs/02 se tratan como locales; la investigación mide la contención (H2) y propone arreglos dentro de ese límite. No se contrata un runner de pago ni se mueve `perf` al VPS N1. Si el informe demuestra que la contención del runner es la única causa, se vuelve a preguntar con la evidencia. |

### Change 49 `optimize-rls-policy-overhead`

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D294 | docs/47, pregunta 4: alcance de la reescritura de las políticas | "Toma las recomendaciones" → (a) | Se reescriben **todas** las políticas que comparan con el contexto de workspace (las de `platform.current_workspace_id()`, incluidas las que suman `platform.current_user_id()`, y las de `audit.protect_partition` y sus particiones), en una migración explícita, y la regla de catálogo de forma canónica aplica a todas (TC-SECURITY-RLS-011). **Antes**, la forma se valida en `ledger.posting` con el experimento del grupo 1. Desbloquea el grupo 3 (migración) del change 49. |
| D295 | docs/47, pregunta 5 (condicional): ninguna forma quita el nodo sin debilitar el aislamiento | Ídem → (a) | Si el experimento confirma que ninguna variante cumple a la vez el aislamiento y fail-closed de V0 y el plan sin nodo adicional, el change 49 **se detiene antes de la migración** y se vuelve al owner con la medición de cada variante (planes y tiempos). No se quita el filtro explícito por workspace de las consultas ni se revisa el criterio del benchmark (D43, D286) sin una decisión nueva. |
| D296 | docs/47, pregunta 6 (condicional): el experimento encuentra un hueco de fail-closed que ya existe | Ídem → (a) | Si TC-SECURITY-RLS-007 encuentra que la política **anterior** ya devuelve vacío sin `PF002` en alguna tabla u operación, se registra como hallazgo (en las notas del TC y en docs/38) y se corrige en un **change de seguridad aparte**, con su propio diseño; no se corrige dentro del change 49 ni se precisa la spec para aceptarlo. El change 49 sigue exigiendo que la forma nueva no empeore el resultado. |

## Efecto en los changes

- **48 `investigate-perf-under-load`:** sin preguntas abiertas. El grupo 5 (aislamiento por purga) queda desbloqueado; el orden de los grupos no cambia. TC-PLATFORM-PIPELINE-024 y 025 pasan a `confirmed`. La fila de throughput con handler real sigue informativa (D292) y el runner no cambia (D293).
- **49 `optimize-rls-policy-overhead`:** sin preguntas que bloqueen. El grupo 3 (migración) queda desbloqueado con alcance total (D294), siempre después de que el experimento (grupo 1) valide la forma en `ledger.posting`. D295 y D296 fijan la salida de los dos casos condicionales.

## Pendiente del owner

Ninguna pregunta de docs/47 queda abierta. Puede volver al owner: una pregunta de umbral por consumidor con handler real (D292) o del runner (D293) si el informe del change 48 lo pide; la evidencia del experimento si se da D295; y la propuesta del change de seguridad si se da D296.
