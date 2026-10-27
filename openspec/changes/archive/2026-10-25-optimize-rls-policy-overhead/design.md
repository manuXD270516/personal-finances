# Diseño: optimize-rls-policy-overhead

> **Reconvertido el 2026-10-24 a «no migrar» (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)).** Las secciones describen el estado final del change; la historia del experimento y de la fase b queda en el Contexto y en las tareas.

## Contexto

Las tablas de negocio tienen RLS habilitada y forzada (ADR-0023, NFR-SEC-003) con políticas para `pf_app` y `pf_worker` de la forma `USING (workspace_id = platform.current_workspace_id()) [WITH CHECK (…)]`. `platform.current_workspace_id()` es plpgsql `STABLE PARALLEL SAFE`: lee `app.workspace_id` y, si falta, lanza `PF002` (fail-closed). Las consultas de la aplicación filtran además por `workspace_id = $1`.

**Evidencia de partida** (docs/23 §5.5, issue #147): en la consulta «saldo por cuenta (índice INCLUDE)» el planner une `workspace_id = $1` y `workspace_id = current_workspace_id()` en una clase de equivalencia y deriva `current_workspace_id() = $1`, que ejecuta como `One-Time Filter` en un nodo `Result` sobre el `Index Only Scan`; las 10 864 filas pasan por ese nodo (≈ 55 ns por fila). Run 39669892721: 2,80 frente a 1,99 ms, +0,805 ms, IC95 [0,800, 0,811].

**Fase a (#162, fusionada): experimento de variantes** (`rls-policy-variants.int.test.ts`, job `integration`, PostgreSQL 18.6, 13 000 postings en `ledger.posting`), diferencia de la mediana de la consulta INCLUDE con y sin RLS:

| Var. | Expresión | Diferencia | Resultado |
|---|---|---|---|
| V0 | `workspace_id = platform.current_workspace_id()` (actual) | +0,268 ms | Nodo `Result` presente |
| V1 | `workspace_id = (SELECT platform.current_workspace_id())` | +0,269 ms | No quita el nodo (clase de equivalencia) |
| V2 | `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])` | 0,000 ms | Quita el nodo; `PgBalanceQuery` pasa de `Bitmap` a `Index Scan`, más rápido con 13 000 filas |
| V3a | función SQL `STABLE` envolvente | +0,263 ms | No quita el nodo |
| V3b | `workspace_id IN (SELECT …)` | +0,274 ms | Cambia el fail-closed (vacío en vez de `PF002`) |

**Fase b (#165, cerrada sin fusionar):** migración de las 125 políticas a V2. Nightly manual 39931324467 (Large Seed, PostgreSQL 18): la fila INCLUDE deja de fallar (≈ 0 ms), pero `PgBalanceQuery.getAccountBalances` (+46,8 %) y `getBalance` (+69 %) pasan a brecha con «plan distinto» (`Bitmap Heap/Index Scan` → `Index Scan` sobre `ledger.journal_entry`); antes pasaban. Además, con V2 una tabla sin filas devolvía vacío sin `PF002` sin contexto (D297, sin efecto).

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D298 | docs/49 | No migrar; conservar V0; la fila INCLUDE pasa a informativa; el resto de la comparación con la consulta real sigue bloqueante (decisiones 1 y 2) |
| D295 | docs/48 | Si ninguna forma quita el nodo sin efectos adversos, el change se detiene antes de migrar (aplicada por D298) |
| D296 | docs/48 | El hallazgo de fail-closed previo (`platform.idempotency_key`, `iam.workspace_export`) va a un change de seguridad aparte (decisión 3) |
| D43 | docs/31 | Objetivo < 10 % sobre la consulta real; agregado sintético informativo; fail-closed `PF002` intacto |
| D286 | docs/46 | Criterio del benchmark sin cambios: 10 %, piso de 0.5 ms, IC95 de 200 pares, plan distinto |
| D285 | docs/46 | El job `perf` sigue bloqueante por las filas que lo son |
| D287 | docs/46 | Origen del change (optimizar la fila INCLUDE); su «la fila no pasa a informativa» queda reemplazado por D298 |
| D294 | docs/48 | Alcance total de la reescritura: sin objeto tras D298 |
| D297 | rama cerrada | Aceptar V2 y enmendar el fail-closed: sin efecto, no llegó a `main` |

| Elemento | Capa | Cambio |
|---|---|---|
| `apps/api/test/perf/nightly.perf.ts` | tests de rendimiento | Fila `saldo por cuenta (índice INCLUDE)` con `gate: false` (mismo nombre e `id`) |
| `apps/api/test/perf/perf-report.test.ts` | tests unitarios | TC-SECURITY-RLS-010 y 012: test de política de filas informativas y bloqueantes |
| `apps/api/test/db/rls-isolation.int.test.ts` | tests de integración | Retirar los bloques de TC-SECURITY-RLS-008, 009 y 011; simplificar TC-SECURITY-RLS-007 a la matriz de la política vigente |
| `apps/api/test/support/db.ts` | soporte de tests | Retirar `RLS_POLICY_REWRITE_MIGRATION_PRESENT`, `RLS_CANONICAL_*`, `legacyPolicyAlterStatements`, `rlsNonCanonicalPolicies`, `rlsCatalogSnapshot` y lo que solo usen ellas |
| `apps/api/test/db/rls-policy-variants.int.test.ts`, `apps/api/test/support/rls-ledger-seed.ts`, `apps/api/test/support/rls-plans.ts` | tests de integración | Retirar el experimento (y los soportes que nadie más use); la evidencia queda en docs/49 y en la rama |
| Migraciones, dominio, aplicación, API, UI, OpenAPI, eventos | — | Sin cambios |

## Objetivos / No objetivos

**Objetivos**

- Cerrar el change con la política actual y una fila INCLUDE informativa, sin cambiar el criterio para las filas bloqueantes.
- Dejar el aislamiento y el fail-closed tabla por tabla como verificación permanente de la suite de integración.
- Retirar el código de prueba que solo tenía sentido con la migración, sin perder pruebas activas.

**No objetivos**

- Reescribir las políticas o ajustar el planner (estadísticas, `ANALYZE`, variantes parciales) para la fila INCLUDE.
- Cambiar el umbral, el piso, el número de pares o qué otras filas son bloqueantes.
- Corregir el hallazgo de D296.

## Decisiones

1. **Sin migración (D298).** Se conservan las políticas V0. Ninguna migración nueva; la de la fase b queda en la rama `claude/impl-optimize-rls-policy-overhead-b` (con la línea base del catálogo y la spec de D297) por si se retoma con una decisión nueva del owner, con otro timestamp.
2. **Fila INCLUDE informativa, consulta real bloqueante.** En `nightly.perf.ts` la fila `saldo por cuenta (índice INCLUDE)` pasa a `gate: false` (como el agregado sintético), sin cambiar su nombre para que el `id` de `perf-results.json` siga comparable con las corridas anteriores; `rlsResult` ya reporta `informativo` y no cuenta la fila como brecha. Las filas `rls-consulta real de saldos en lote (PgBalanceQuery.getAccountBalances)`, `rls-consulta real de saldo por cuenta (PgBalanceQuery.getBalance)` y `página de transacciones (1 mes)` siguen bloqueantes. Un test de política en `perf-report.test.ts` lee `nightly.perf.ts` y exige exactamente ese reparto (TC-SECURITY-RLS-010 para la fila informativa con los valores de la línea base; TC-SECURITY-RLS-012 para que una brecha con plan distinto en la consulta real siga fallando el reporte), de modo que pasar otra fila a informativa exija tocar el test y la spec. El EXPLAIN de la fila INCLUDE (`rls-explain.md`, `perf-summary.md`) se sigue publicando.
3. **Verificación del aislamiento y del fail-closed (Must).** TC-SECURITY-RLS-006 (cruce W1/W2 sobre el ledger y cuentas) y TC-SECURITY-RLS-007 (matriz sin contexto por tabla de `platform.workspace_scoped_table`, lectura filtrada, sin filtro e inserción; falla si alguna devuelve filas; imprime `RLS-FAIL-CLOSED-MATRIX` y un `RLS-FAIL-CLOSED-FINDING` por operación que devuelve vacío sin `PF002`) siguen en `rls-isolation.int.test.ts`. TC-SECURITY-RLS-007 deja de comparar con una «política anterior» reconstruida (sin migración son idénticas) y se queda con la matriz de la política vigente. Los hallazgos actuales (`platform.idempotency_key` lectura filtrada; `iam.workspace_export` lectura filtrada y sin filtro) quedan en las notas del TC y en docs/38 para el change de seguridad de D296.
4. **Descarte de TC-SECURITY-RLS-008, 009 y 011.** Describían el catálogo y el plan tras la migración y la regla de forma canónica V2; sin migración no tienen objeto (la regla de catálogo de TC-SECURITY-RLS-004 sigue cubriendo el `FORCE` y la política). Se deprecan en el mismo commit que retira sus tests, para que `traceability:check` no falle por R5 (test que referencia un TC deprecado). Hasta entonces quedan con `requirement_status: provisional`.
5. **Retiro del experimento.** `rls-policy-variants.int.test.ts` cuesta tiempo del job `integration` (13 000 postings) y su TC (009) se descarta; se retira con sus soportes si nadie más los usa. Sus resultados quedan en docs/49, en la tarea 1.3 y en la rama.

## Contratos

Sin cambios en OpenAPI, eventos ni `ErrorCode`. `PF002` sigue igual. `perf-results.json` no cambia de forma: la fila INCLUDE solo cambia su `gate` a `false`.

## Riesgos / Trade-offs

- **Regresión inadvertida en la fila INCLUDE.** Al ser informativa, un empeoramiento no falla el job. Mitigación: se sigue publicando en `perf-summary.md` con su veredicto y su EXPLAIN, y la consulta real de saldos sigue bloqueante.
- **Retiro de una prueba activa por error.** Mitigación: la tarea 4.2 enumera los símbolos y bloques que se retiran; TC-SECURITY-RLS-001..007 y TC-SECURITY-ISOLATION-001 deben seguir en verde dos veces seguidas.
- **El sobrecosto de ~0,8 ms crece con el historial** (`ledger.posting` es la tabla más grande). Se acepta por D298; la consulta real usa snapshots y se mide aparte.

## Plan de migración

No hay migración de base de datos. Despliegue: solo cambian archivos de prueba. Rollback: revertir el commit de la tarea 4.

## Preguntas abiertas

Ninguna. Las preguntas 4 a 6 de [docs/47](../../../docs/47-investigate-perf-under-load-questions.md) se resolvieron en [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md) (D294–D296) y el resultado de la fase b en [docs/49](../../../docs/49-rls-no-migration-decision.md) (D298).
