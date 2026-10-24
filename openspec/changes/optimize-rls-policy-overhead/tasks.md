# Tareas

> Cambio de seguridad sensible: RLS forzada y registro en `platform.workspace_scoped_table` no se debilitan; las pruebas de aislamiento existentes (TC-SECURITY-RLS-001..005, TC-SECURITY-ISOLATION-001) siguen verdes sin cambios. Sin dominio, aplicación, API ni UI. Sin Docker, el experimento, la suite de integración y el benchmark no corren en la sesión: los ejecutan el job `integration` del PR y `nightly` por `workflow_dispatch` desde la rama del PR, y se dice en el informe. Las preguntas de [docs/47](../../../docs/47-investigate-perf-under-load-questions.md) están resueltas ([docs/48](../../../docs/48-perf-and-rls-owner-decisions.md), 2026-10-23): alcance total de la reescritura tras validar en `ledger.posting` (D294); si ninguna variante quita el nodo, detenerse y volver al owner (D295); un hueco previo de fail-closed va a un change de seguridad aparte (D296).
>
> **Orden de implementación.** (1) Grupo 1: 1.1 y 1.2 sin Docker; el test del experimento (1.3) se escribe sin Docker y corre en el job `integration` del PR (CI). Con D295, si ninguna variante cumple, el change se detiene aquí. (2) Grupo 2 (TDD) escrito sin Docker y verificado en el job `integration`. (3) Grupo 3: la migración se genera y revisa sin Docker; `migrate:up`/`migrate:down` los verifica CI. (4) Grupo 4 con los gates locales sin Docker y CI para integración. (5) Grupo 5: `nightly` por `workflow_dispatch` desde la rama del PR antes de fusionar (design, decisión 6), y la primera corrida programada tras fusionar. (6) Grupo 6.

## 1. SPEC, TEST CASES y EXPERIMENTO (decisión 1)

- [x] 1.1 Revisar el delta de `security/access-control`; `pnpm exec openspec validate optimize-rls-policy-overhead --strict` (2026-10-23: delta revisado contra el design y `validate --strict` en verde)
- [x] 1.2 Revisar TC-SECURITY-RLS-006..011 contra los scenarios; pasarlos a `ready` al empezar (2026-10-23: revisados contra los scenarios del delta y pasados a `ready`)
- [ ] 1.3 `apps/api/test/db/rls-policy-variants.int.test.ts`: workspace con ~10 000 postings (y otro workspace), `ANALYZE`, variantes V0–V3 aplicadas a `ledger.posting` dentro de una transacción con `ROLLBACK`; `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)` de la consulta INCLUDE y de las sentencias de `PgBalanceQuery` con y sin RLS; imprimir planes y tiempos. Ejecutarlo en el job `integration` del PR y anotar aquí, por variante: nodos del plan, acceso por índice, fail-closed sin contexto y tiempo. Elegir la variante con los criterios del design; si ninguna cumple, detenerse antes del grupo 3 y volver al owner con la medición de cada variante (D295)

## 2. PRUEBAS de aislamiento y catálogo (decisiones 3 a 5; antes de la migración, TDD)

- [ ] 2.1 (escrita 2026-10-23, pendiente de verificar en `integration`; corre hoy) TC-SECURITY-RLS-006: lectura sin filtro y escritura cruzada W1/W2 sobre las tablas de ledger y cuentas (en `rls-isolation.int.test.ts`)
- [ ] 2.2 (escrita 2026-10-23, pendiente de verificar en `integration`; corre hoy, imprime el bloque `RLS-FAIL-CLOSED-MATRIX` con los hallazgos `RLS-FAIL-CLOSED-FINDING`) TC-SECURITY-RLS-007: equivalencia del fail-closed tabla por tabla de `platform.workspace_scoped_table` (lectura filtrada, sin filtro e inserción, sin contexto), con la política anterior y la nueva; registrar como hallazgo cualquier operación que ya devuelva vacío sin `PF002` con la política anterior, en las notas del TC y en docs/38, y proponer el change de seguridad aparte (D296); no corregirlo aquí
- [ ] 2.3 (escrita 2026-10-23, omitida hasta la migración) TC-SECURITY-RLS-008: catálogo tras migrar (`rlsCatalogViolations` vacío, mismas tablas y orden en el registro, misma cantidad de políticas por tabla)
- [ ] 2.4 (escrita 2026-10-23, omitida hasta la migración) TC-SECURITY-RLS-009: árbol de nodos de la consulta INCLUDE con y sin RLS, mismo acceso por índice y sin nodo entre el acceso y el `Aggregate`
- [ ] 2.5 (escrita 2026-10-23; la parte con fixtures corre hoy, la de «sin fixture» se omite hasta la migración) TC-SECURITY-RLS-011: regla de forma canónica en `apps/api/test/support/db.ts` (`pg_policies` de `pf_app` y `pf_worker`) con un fixture en la forma anterior que falla indicando tabla y política

> **Mecanismo de activación (2026-10-23).** Las pruebas que describen el estado POSTERIOR a la migración (TC-SECURITY-RLS-008, 009 y la parte «sin fixture» de 011) usan `describe.skipIf(!RLS_POLICY_REWRITE_MIGRATION_PRESENT)` (`apps/api/test/support/db.ts`): la constante es verdadera cuando existe en `apps/api/db/migrations/` un archivo `*_platform_rls_policy_initplan.sql`, así que pasan a activas solas al agregar la migración de la tarea 3.1, sin tocar los tests. La **forma canónica** vive en un único lugar, `RLS_CANONICAL_CONTEXT_FORM` y `RLS_CANONICAL_PREDICATE_EXAMPLE` (`db.ts`), hoy PROVISIONAL en la variante V1; al elegir la variante (1.3) se ajustan esas dos constantes y de ellas se derivan la regla de catálogo (TC-011), la reconstrucción de la política anterior para TC-007 (`legacyPolicyAlterStatements`) y los fixtures. TC-008 compara contra una línea base del catálogo: antes de migrar, el job `integration` imprime el bloque `RLS-CATALOG-BASELINE` (test `[TC-SECURITY-RLS-008] imprime la foto…`, que se omite una vez existe la migración); su JSON se guarda en `apps/api/test/db/fixtures/rls-catalog-baseline.json` (formateado con prettier) **antes** de agregar la migración en el grupo 3, y sin ese archivo TC-008 falla con un mensaje que lo indica. TC-007 corre hoy comparando «actual» con «anterior» (idénticas hasta la migración); tras la migración reconstruye la anterior con `ALTER POLICY` dentro de una transacción que se revierte.

## 3. INFRAESTRUCTURA: migración (decisión 2; alcance total, D294; solo después de validar la variante en `ledger.posting`, 1.3)

- [ ] 3.1 Migración nueva `apps/api/db/migrations/<timestamp>_platform_rls_policy_initplan.sql` (timestamp posterior a la última de `main` al implementarla): `ALTER POLICY` explícito por cada política que compara con el contexto de workspace (todas, D294), en el orden del catálogo, con la variante elegida (incluye las de `AND user_id = platform.current_user_id()`); `CREATE OR REPLACE FUNCTION audit.protect_partition` y `ALTER POLICY` de las particiones de auditoría existentes; `-- migrate:down` con las expresiones anteriores. Sin tocar `ENABLE`/`FORCE ROW LEVEL SECURITY`, `GRANT` ni `platform.workspace_scoped_table`
- [ ] 3.2 Verificar que `migrate:down` seguido de `migrate:up` deja el catálogo idéntico (test o comprobación en el job `integration`)

## 4. TESTS AUTOMATIZADOS y regresión

- [ ] 4.1 `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`
- [ ] 4.2 `pnpm test:integration` dos veces seguidas en verde (CI si la sesión no tiene Docker), con TC-SECURITY-RLS-001..009, 011 y TC-SECURITY-ISOLATION-001 en verde
- [ ] 4.3 `pnpm test:e2e` no aplica (sin cambios de UI); `pnpm test:stack` lo corre CI (aplica migraciones al stack)

## 5. MEDICIÓN antes y después (decisión 6)

- [ ] 5.1 `nightly` por `workflow_dispatch` desde la rama del PR antes de fusionar; anotar en TC-SECURITY-RLS-010 las filas de RLS (INCLUDE, `getAccountBalances`, `getBalance`, agregado sintético) frente a la corrida 39669892721 (0,805 ms, IC95 [0,800, 0,811]; 2,80 vs 1,99 ms; +7,8 ms)
- [ ] 5.2 Primera corrida programada tras fusionar: confirmar el resultado y anotarlo en TC-SECURITY-RLS-010 y en TC-PLATFORM-PIPELINE-015

## 6. DOCS

- [ ] 6.1 docs/23 §5.5 (resultado del experimento, forma canónica de las políticas, medición antes y después), docs/08 o el doc de modelo de datos donde se describan las políticas (forma canónica para migraciones nuevas), docs/38 (fila 49 y quitar el pendiente de la fila RLS)
- [ ] 6.2 Estados de TC-SECURITY-RLS-006..011 a `automated`; `pnpm traceability:check` y `pnpm exec openspec validate optimize-rls-policy-overhead --strict`
