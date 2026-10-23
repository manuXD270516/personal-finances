# Diseño: optimize-rls-policy-overhead

## Contexto

Las tablas de negocio tienen RLS habilitada y forzada (ADR-0023, NFR-SEC-003) con políticas para `pf_app` y `pf_worker` de la forma `USING (workspace_id = platform.current_workspace_id()) [WITH CHECK (…)]`. `platform.current_workspace_id()` es plpgsql `STABLE PARALLEL SAFE`: lee `app.workspace_id` y, si falta, lanza `PF002` (fail-closed). Las migraciones tienen unas 128 cláusulas de política con esa función en 39 archivos, incluidas variantes con `AND user_id = platform.current_user_id()` y políticas que crea en tiempo de ejecución `audit.protect_partition(regclass)` para cada partición de `audit.audit_log`. Las consultas de la aplicación filtran además por `workspace_id = $1` (defensa en profundidad).

Evidencia de partida (docs/23 §5.5, issue #147, corridas 39401809245 y 39669892721):

| Medida | Sin RLS | Con RLS | Diferencia |
|---|---|---|---|
| Fila «saldo por cuenta (índice INCLUDE)», mediana (run 39669892721) | 1,99 ms | 2,80 ms | +0,805 ms, IC95 [0,800, 0,811] (40–55 % según la corrida) |
| `Index Only Scan` sobre `posting_balance_ix` (run 39401809245) | 0,589 ms | 0,586 ms | igual; 207 buffers, Heap Fetches 0 |
| Agregado sintético de todo el workspace (~200 000 filas, informativo) | — | — | +4,7 a +7,8 ms |

En el plan con RLS, `platform.current_workspace_id()` aparece una sola vez, como `One-Time Filter: (platform.current_workspace_id() = '<uuid>')`, en un nodo `Result` que el planner coloca sobre el `Index Only Scan`; todas las filas (10 864) pasan por ese nodo antes del `Aggregate` (≈ 55 ns por fila).

**Hipótesis del origen del nodo (a verificar en el experimento).** La consulta trae `workspace_id = $1` y la política `workspace_id = current_workspace_id()`. El planner las une en una clase de equivalencia, usa `$1` como condición del índice y deriva `current_workspace_id() = $1`, que no depende de ninguna fila: una cualificación pseudoconstante que se ejecuta como `One-Time Filter` en un `Result` de compuerta. Si es así, cualquier expresión estable que entre en la misma clase de equivalencia producirá el mismo nodo, y la variante InitPlan podría no bastar. Por eso el change empieza con un experimento con varias variantes y no con la migración.

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D287 | docs/46 | Change aparte para optimizar las políticas; la fila no pasa a informativa |
| D286 | docs/46 | Criterio del benchmark sin cambios: 10 % y piso de 0.5 ms, IC95 de 200 pares, brecha estructural por plan distinto |
| D43 | docs/31 | Objetivo < 10 % sobre la consulta real; agregado sintético informativo |
| D285 | docs/46 | El job `perf` sigue bloqueante hasta que la fila pase |
| D294 | docs/48 | Alcance: todas las políticas que usan el contexto de workspace, en una migración explícita, con la regla de catálogo para todas; la forma se valida antes en `ledger.posting` (decisiones 1, 2 y 5) |
| D295 | docs/48 | Si ninguna variante quita el nodo sin debilitar el aislamiento, el change se detiene antes de migrar y vuelve al owner con la medición de cada variante (decisión 1) |
| D296 | docs/48 | Un hueco previo de fail-closed que encuentre TC-SECURITY-RLS-007 se registra y se corrige en un change de seguridad aparte (decisión 3) |
| CLAUDE.md | Regla del proyecto | RLS forzada y registro en `platform.workspace_scoped_table` para toda tabla con `workspace_id`; migraciones nuevas con timestamp posterior a la última de `main`, nunca editar una fusionada |

| Elemento | Capa | Cambio |
|---|---|---|
| `apps/api/db/migrations/<timestamp>_platform_rls_policy_initplan.sql` (nuevo) | infraestructura (base de datos) | `ALTER POLICY` de las políticas del alcance y `CREATE OR REPLACE FUNCTION audit.protect_partition` con la forma nueva; reversa con la forma anterior |
| `apps/api/test/support/db.ts` | soporte de tests | Regla de catálogo de forma canónica junto a `rlsCatalogViolations` |
| `apps/api/test/db/rls-isolation.int.test.ts` | tests de integración | TC-SECURITY-RLS-006..009 y 011 |
| `apps/api/test/db/rls-policy-variants.int.test.ts` (nuevo, puede quedar como test del experimento) | tests de integración | Experimento de variantes (decisión 1) |
| `apps/api/test/perf/nightly.perf.ts` | tests de rendimiento | Sin cambios de criterio; se lee su resultado (TC-SECURITY-RLS-010) |
| Dominio, aplicación, API, UI, OpenAPI, eventos | — | Sin cambios |

## Objetivos / No objetivos

**Objetivos**

- Quitar el trabajo por fila que agrega la política en las consultas de la aplicación, empezando por la fila bloqueante INCLUDE.
- Demostrar con pruebas que el aislamiento, el fail-closed y el catálogo no cambian.
- Medir antes y después con el mismo benchmark y el mismo criterio.

**No objetivos**

- Cambiar el criterio del benchmark o qué filas son bloqueantes.
- Quitar el filtro explícito por workspace de las consultas de la aplicación (si ninguna variante funciona, se vuelve al owner con la evidencia, D295).
- Corregir un hueco de fail-closed que ya exista con la política actual (si el experimento lo encuentra, se registra y va a un change de seguridad aparte, D296).
- Las políticas que no usan el contexto de workspace.

## Decisiones

1. **Experimento de variantes antes de migrar.** Un test de integración (Testcontainers, PostgreSQL 18, mismo `global-setup`) crea un workspace con ~10 000 postings repartidos en varias cuentas (y otro workspace con datos para comprobar aislamiento), ejecuta `ANALYZE` y, para cada variante aplicada a `ledger.posting` dentro de una transacción con `ROLLBACK`, obtiene `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)` de las sentencias reales de `PgBalanceQuery` y de la consulta de índice INCLUDE con y sin RLS. Variantes:

   | Var. | Expresión de la política | Qué se espera verificar |
   |---|---|---|
   | V0 | `workspace_id = platform.current_workspace_id()` (actual) | Reproduce el `Result` con `One-Time Filter` |
   | V1 | `workspace_id = (SELECT platform.current_workspace_id())` | Hipótesis principal (InitPlan): el contexto se evalúa una vez; ver si el `Result` desaparece o reaparece por la clase de equivalencia |
   | V2 | `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])` | Comparación que no entra en la clase de equivalencia, con la condición todavía usable por el índice |
   | V3 | Otras formas que el experimento sugiera (p. ej. función SQL `STABLE` envolvente), con la misma verificación | — |

   Criterios de elección, en este orden: (a) aislamiento y fail-closed iguales a V0 en las pruebas de la decisión 3; (b) el plan con política tiene los mismos nodos que procesan filas y el mismo acceso por índice que sin política; (c) menor diferencia de tiempo en 200 pares. El resultado (planes y tiempos por variante) se anota en la tarea 1.3 y en docs/23 §5.5. Si ninguna variante cumple (a) y (b) a la vez, el change se detiene antes de la migración y vuelve al owner con la medición de cada variante (D295); no se quita el filtro explícito de las consultas ni se revisa el criterio del benchmark sin una decisión nueva.

   *Medición sin Docker:* las sesiones sin Docker no pueden ejecutar el experimento ni el benchmark. El test del experimento corre en el job `integration` del PR (CI) e imprime los planes en su salida; el benchmark lo corre `nightly` por `workflow_dispatch` desde la rama del PR. El design no depende de medir en local.

2. **Migración: `ALTER POLICY` explícitos, compatibles en ambos sentidos.** Alcance (D294): **todas** las políticas que comparan con el contexto de workspace. Una migración nueva (timestamp posterior a la última de `main` al implementarla; hoy `20261019100100`) con un `ALTER POLICY <política> ON <tabla> USING (…) [WITH CHECK (…)]` por política del alcance, en el mismo orden que el catálogo, escrita de forma explícita para que la revisión vea cada una (un script puede generar el texto, pero lo que se fusiona es SQL legible, no un `DO` que reescribe por coincidencia de texto). Incluye `CREATE OR REPLACE FUNCTION audit.protect_partition(regclass)` con la forma nueva y el `ALTER POLICY` de las particiones de auditoría que ya existen. `-- migrate:down` restaura la expresión anterior de cada política y la función anterior. Solo cambia expresiones de políticas, no columnas, datos ni el registro de `platform.workspace_scoped_table`; la aplicación desplegada funciona con la forma vieja y con la nueva (misma semántica), por lo que no requiere fases expand/contract. No toca `ENABLE`/`FORCE ROW LEVEL SECURITY` ni los `GRANT`. Las variantes con `AND user_id = platform.current_user_id()` aplican la misma forma a ambas funciones. Ninguna migración fusionada se edita.
3. **Pruebas de aislamiento (Must).** Además de TC-SECURITY-RLS-001..005 y TC-SECURITY-ISOLATION-001 sin cambios:
   - TC-SECURITY-RLS-006: lectura sin filtro y escritura cruzada W1/W2 sobre las tablas del ledger y de cuentas con la forma nueva (los nombres de la Minimal Seed).
   - TC-SECURITY-RLS-007 (equivalencia del fail-closed): recorre `platform.workspace_scoped_table`; para cada tabla, sin contexto, ejecuta una lectura filtrada por un workspace existente, una lectura sin filtro y una inserción, con la política anterior (dentro de una transacción que la restaura) y con la nueva; exige el mismo resultado (error `PF002` o el mismo error de la política) en cada operación. Si con la política **anterior** alguna operación ya devuelve vacío sin `PF002` (p. ej. una lectura secuencial de una tabla vacía), el test lo registra como hallazgo y exige que la nueva no empeore; ese hueco previo se registra en las notas del TC y en docs/38 y se corrige en un change de seguridad aparte (D296), no en este.
   - TC-SECURITY-RLS-008: catálogo después de migrar: `rlsCatalogViolations` vacío, mismas tablas y orden en `platform.workspace_scoped_table`, misma cantidad de políticas por tabla.
4. **Plan sin nodo por fila (Should).** TC-SECURITY-RLS-009 compara el árbol de nodos que procesan filas de la consulta INCLUDE con y sin RLS sobre los datos del experimento (sin contar el InitPlan del contexto) y exige el mismo acceso por índice y ningún nodo entre el acceso y el `Aggregate`. Corre en el job `integration` del PR. TC-SECURITY-RLS-010 es la verificación del benchmark nocturno: la fila INCLUDE sin "brecha demostrada" ni "plan distinto", con la diferencia publicada para comparar con 0,805 ms.
5. **Forma canónica en el catálogo (Should).** Una regla nueva junto a `rlsCatalogViolations` recorre `pg_policies` de los roles `pf_app` y `pf_worker` y exige que toda expresión `qual`/`with_check` que mencione `current_workspace_id` lo haga con la forma elegida (comparando el texto que devuelve `pg_get_expr`). Con un fixture de tabla y política en la forma anterior falla indicando tabla y política (TC-SECURITY-RLS-011). Corre en el job `integration`, como TC-SECURITY-RLS-004.
6. **Medición antes y después.** Antes: corrida 39669892721 (0,805 ms, IC95 [0,800, 0,811]; 2,80 vs 1,99 ms; agregado sintético +7,8 ms). Después: `nightly` por `workflow_dispatch` desde la rama del PR antes de fusionar (la migración del PR se aplica en la base del benchmark) y la primera corrida programada tras fusionar. Se anotan las filas de RLS (INCLUDE, `PgBalanceQuery.getAccountBalances`, `getBalance` y el agregado sintético) en las notas de TC-SECURITY-RLS-010 y en docs/23 §5.5.

## Contratos

Sin cambios en OpenAPI, eventos ni `ErrorCode`. `PF002` (contexto ausente) sigue igual.

## Riesgos / Trade-offs

- **Debilitar el aislamiento o el fail-closed.** Es un cambio de seguridad sensible. Mitigación: pruebas de equivalencia tabla por tabla (decisión 3), regresión completa de RLS e integración, regla de catálogo y revisión de cada `ALTER POLICY` explícito. Un InitPlan se evalúa de forma diferida: si la consulta no lee ninguna fila, la función puede no ejecutarse; por eso la prueba de equivalencia compara con la política actual en cada tabla y forma de consulta.
- **Ninguna variante quita el nodo** (la hipótesis de la clase de equivalencia lo anticipa). Mitigación: el experimento va primero; si falla, el change se detiene y vuelve al owner con la evidencia (D295) en vez de forzar una solución.
- **Planes distintos en otras consultas:** una forma nueva puede cambiar el plan de consultas que hoy usan la condición de la política como condición de índice. Mitigación: la brecha estructural del benchmark de RLS y la suite de integración; el experimento compara también las sentencias de `PgBalanceQuery`.
- **Migración grande:** más de cien políticas en una migración. Mitigación: generada, explícita, con reversa y verificada por la regla de catálogo; el owner eligió el alcance total (D294) después de validar la forma en `ledger.posting`, y el riesgo se cubre con la prueba de equivalencia tabla por tabla y la reversa.

## Plan de migración

1. Experimento (grupo 1) en el PR, sin migración, con sus planes en la salida del job `integration` (CI; la sesión sin Docker solo lo escribe). Si se da D295, se detiene aquí.
2. Con la variante elegida: pruebas de aislamiento y regla de catálogo primero (TDD, grupo 2), después la migración (grupo 3).
3. `nightly` por `workflow_dispatch` desde la rama del PR; fusionar con los 17 checks en verde.
4. Rollback: `migrate:down` de la migración nueva restaura la forma anterior; ningún dato cambia.

## Preguntas resueltas

Las preguntas 4 a 6 de [docs/47](../../../docs/47-investigate-perf-under-load-questions.md) se resolvieron el 2026-10-23 con la recomendación de cada una ([docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)):

4. Alcance de la reescritura: todas las políticas que usan el contexto de workspace, una vez validada la variante en `ledger.posting` (D294). Desbloquea el grupo 3.
5. Si ninguna variante quita el nodo sin debilitar el aislamiento (condicional): volver al owner con la medición antes de cambiar nada (D295).
6. Si el experimento encuentra un hueco de fail-closed previo (condicional): registrarlo y corregirlo en un change de seguridad aparte (D296).

No quedan preguntas abiertas.
