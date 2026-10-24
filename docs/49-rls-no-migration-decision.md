# 49: Decisión del owner de no migrar las políticas de RLS a la forma V2 (2026-10-24) y decisión D298

> **Estado:** Registrado · **Fecha:** 2026-10-24 · **Relacionado:** [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D291–D296), [46-nightly-and-perf-owner-decisions.md](46-nightly-and-perf-owner-decisions.md) (D285–D287), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), [23-ci-cd.md](23-ci-cd.md) §5.5, change [`optimize-rls-policy-overhead`](../openspec/changes/optimize-rls-policy-overhead/proposal.md) (49), [ADR-0023](adr/0023-multi-tenancy-and-row-level-security.md)

La numeración continúa la de docs/48 (último id vigente en `main`: D296). El id D297 se usó en la rama cerrada `claude/impl-optimize-rls-policy-overhead-b` (aceptar V2 y enmendar el fail-closed sin contexto, en un `docs/49-rls-failclosed-decision.md` que nunca llegó a `main`); **queda sin efecto** con esta decisión y no se reutiliza. Este documento registra la respuesta **tal cual** y su consecuencia; el detalle lo desarrollan el design, el delta spec, las tareas y los TC del change 49.

## Contexto

La fila «saldo por cuenta (índice INCLUDE)» del benchmark de RLS del job `perf` es bloqueante desde D287 y falla por un sobrecosto real: 0,805 ms (IC95 [0,800, 0,811]; 2,80 frente a 1,99 ms) en el run 39669892721. El origen es un nodo `Result` con `One-Time Filter` que el planner pone sobre el `Index Only Scan` cuando la consulta filtra por `workspace_id = $1` y la política compara con `platform.current_workspace_id()`.

El change 49 se implementó en dos fases:

- **Fase a (#162, fusionada).** Experimento de variantes `rls-policy-variants.int.test.ts` en el job `integration` (PostgreSQL 18.6, 13 000 postings en `ledger.posting`) y pruebas de aislamiento TC-SECURITY-RLS-006 y 007 activas; TC-SECURITY-RLS-008, 009 y la parte «sin fixture» de 011 omitidas hasta la migración (`RLS_POLICY_REWRITE_MIGRATION_PRESENT`). Diferencia de la mediana de la consulta INCLUDE con y sin RLS por variante:

  | Variante | Expresión | Diferencia | Resultado |
  |---|---|---|---|
  | V0 (actual) | `workspace_id = platform.current_workspace_id()` | +0,268 ms | Nodo `Result` presente |
  | V1 | `workspace_id = (SELECT platform.current_workspace_id())` | +0,269 ms | No quita el nodo (misma clase de equivalencia con `workspace_id = $1`) |
  | V2 | `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])` | 0,000 ms | Quita el nodo; elegida en la fase b |
  | V3a | función SQL `STABLE` envolvente | +0,263 ms | No quita el nodo |
  | V3b | `workspace_id IN (SELECT …)` | +0,274 ms | Cambia el fail-closed (vacío en vez de `PF002`) |

  En ese experimento, con V2 las sentencias de `PgBalanceQuery` pasaban de `Bitmap` a `Index Scan` y eran más rápidas (saldos 0,295 ms frente a 0,434 ms).

- **Fase b (PR #165, cerrado sin fusionar).** Migración `20261023120000_platform_rls_policy_initplan.sql` con las 125 políticas que comparan con `platform.current_workspace_id()` en la forma V2, más la enmienda del fail-closed sin contexto (D297, ahora sin efecto). `integration`, `unit`, `e2e`, `stack-smoke` y `migrate up`/`down` pasaron.

## Evidencia: nightly manual de la fase b

Run 39931324467 (`workflow_dispatch` desde la rama de #165, Large Seed, PostgreSQL 18):

| Fila del benchmark de RLS | Antes (V0, run 39669892721) | Con V2 (run 39931324467) |
|---|---|---|
| saldo por cuenta (índice INCLUDE), bloqueante | brecha demostrada, +0,805 ms, IC95 [0,800, 0,811] | sin brecha (≈ 0 ms); deja de figurar entre los incumplimientos |
| consulta real de saldos en lote (`PgBalanceQuery.getAccountBalances`), bloqueante | OK (< 10 %) | **brecha: +46,8 % (0,468 > 0,1)**, plan distinto |
| consulta real de saldo por cuenta (`PgBalanceQuery.getBalance`), bloqueante | OK (< 10 %) | **brecha: +69 % (0,69 > 0,1)**, plan distinto |

Con RLS el plan de ambas consultas reales cambia de `Bitmap Heap Scan`/`Bitmap Index Scan` a `Index Scan` sobre `ledger.journal_entry`: con el Large Seed el planner no ve el valor del InitPlan al estimar y elige otro acceso. El experimento de 13 000 filas no lo anticipó (allí el lote era más rápido). Las otras filas rojas del `perf` (TC-COMMITMENTS-MATCH-012, drenaje de imports, p95 de disponible para gastar) son las de `main` y no dependen de la política.

V2 cambia, por tanto, un sobrecosto de ~0,8 ms absolutos en una consulta de índice que no usa la aplicación tal cual, por un sobrecosto del 47 % al 69 % en las dos consultas que sí usa, que es lo que mide el objetivo de D43.

## Respuesta del owner

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D298 | Medición del nightly de la fase b del change 49 (run 39931324467, 2026-10-24): V2 quita el sobrecosto de la fila INCLUDE pero hace fallar las dos consultas reales de saldos con otro plan | Cerrar #165 y quedarse con la política actual (V0) | **No se migran las políticas** (aplica D295): se conserva la forma `workspace_id = platform.current_workspace_id()` en todas las tablas, con su fail-closed `PF002`. La fila «saldo por cuenta (índice INCLUDE)» (~0,8 ms absolutos) **pasa de bloqueante a informativa**: se sigue midiendo y publicando con el mismo criterio, sin hacer fallar el job `perf`. El resto de la comparación de RLS con la consulta real (`getAccountBalances`, `getBalance`) y las demás consultas de índice bloqueantes **siguen bloqueantes** con el criterio de D286. D297 queda sin efecto. El change 49 se reconvierte a «no migrar» y se cierra con la implementación de la fila informativa y el retiro del código de la forma nueva. |

## Alternativas descartadas

- **Probar una variante intermedia directamente sobre el Large Seed** (p. ej. V2 solo en `ledger.posting`, o V2 con estadísticas extendidas o `ANALYZE` adicional para que el planner vuelva al `Bitmap`). Exige otra ronda de experimento con el nightly (cerca de una hora por corrida y sin Docker en las sesiones), deja dos formas de política o ajustes del planner que dependen del volumen, y contradice el alcance total de D294 y la regla de forma canónica. La ganancia máxima es ~0,8 ms en una consulta de índice que no es la consulta real.
- **Fusionar V2 relajando el gate** (pasar a informativas las filas de `getAccountBalances` y `getBalance`, o subir el umbral). Contradice D43 (el objetivo < 10 % se mide sobre la consulta real) y D286 (criterio sin cambios), empeora en un 47 % a 69 % la consulta que usa la aplicación para ganar en una sintética, y además debilitaba el fail-closed en las tablas vacías (D297), que D43 pide mantener.

## Consecuencias

- **Seguridad:** sin cambios. Las políticas, el `FORCE ROW LEVEL SECURITY`, el registro `platform.workspace_scoped_table` y el fail-closed `PF002` quedan como en `main`. El requirement «Aislamiento fail-closed sin contexto de workspace» no se modifica.
- **Benchmark:** la fila INCLUDE se reporta como informativa (como el agregado sintético, D43). El job `perf` deja de fallar por ella; sigue bloqueante por las demás filas (D285) y puede seguir en rojo por TC-COMMITMENTS-MATCH-012 y los benchmarks de `spendable.perf` (change 48).
- **Change 49:** el delta de `security/access-control` se reconvierte: un requirement para la fila informativa con la consulta real bloqueante y otro para la verificación del aislamiento y del fail-closed tabla por tabla con las políticas vigentes. TC-SECURITY-RLS-008, 009 y 011 (estado posterior a la migración y forma canónica) se descartan; los grupos 3 (migración) y 5 (medición después de migrar) se cierran como diferidos por esta decisión. Queda una tarea de código (fila informativa y su test de política; retiro del código de la forma nueva). Detalle en el design y las tareas del change.
- **Rama conservada:** `claude/impl-optimize-rls-policy-overhead-b` guarda la migración V2 (`20261023120000_platform_rls_policy_initplan.sql`, con su reversa), la línea base del catálogo `rls-catalog-baseline.json`, la spec y el TC enmendados por D297 y el docs/49 de esa rama, por si se retoma la optimización. Retomarla exige una decisión nueva del owner y otro timestamp de migración (posterior a la última de `main` en ese momento); el número de doc 49 ya lo usa este documento.
- **D296 sigue pendiente:** el hallazgo de TC-SECURITY-RLS-007 (job `integration` de #162) sigue vigente con la política actual: sin contexto, `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) devuelven vacío sin `PF002`. Se corrige en un **change de seguridad aparte**, por redactar; el change 49 no lo toca.

## Pendiente del owner

Ninguna pregunta queda abierta por esta decisión. Puede volver al owner: la propuesta del change de seguridad de D296, y una decisión nueva si se quiere retomar la optimización de la fila INCLUDE.
