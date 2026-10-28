# Tareas

> Change de seguridad de D296 ([docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)), dentro de D298 ([docs/49](../../../docs/49-rls-no-migration-decision.md)): no se reescriben las políticas que ya cumplen. Preguntas en [docs/55](../../../docs/55-rls-fail-closed-questions.md): la 1 bloquea el grupo 3. Sin Docker en la sesión, `pnpm test:integration` y `pnpm test:stack` los valida CI y se dice en el informe.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `security/access-control` (2 ADDED y 1 MODIFIED) contra el design; `pnpm exec openspec validate fix-rls-fail-closed-gaps --strict`
- [ ] 1.2 Revisar TC-SECURITY-RLS-013..018 y la versión endurecida de TC-SECURITY-RLS-007 contra los scenarios; pasar los nuevos a `ready` al empezar

## 2. PRUEBAS primero (rojo con la política vigente)

- [ ] 2.1 `[TC-SECURITY-RLS-013]` en `apps/api/test/db/rls-isolation.int.test.ts`: como `pf_app`, sin `app.workspace_id` ni `app.user_id`, la lectura de `platform.idempotency_key` filtrada por un workspace sin claves, la lectura sin filtro con la tabla vacía (filas borradas por el superusuario en la misma transacción revertida), la búsqueda por `scope_id` y `key` y la inserción fallan con `PF002`. Debe fallar antes de la migración (lectura filtrada y tabla vacía)
- [ ] 2.2 `[TC-SECURITY-RLS-014]` en `apps/api/test/db/idempotency-key.int.test.ts`: con solo el usuario fijado se ven sus claves de alcance de usuario y no la clave de W1 (sin filtro ni filtrando por W1); con W1 fijado se ven solo las de W1 y no las de alcance de usuario; el store (`PgIdempotencyStore`) reserva, completa y repite una clave de alcance de usuario y otra de workspace como hoy. Actualizar en el mismo archivo el catálogo de políticas de la tabla si cambia (los nombres no cambian)
- [ ] 2.3 `[TC-SECURITY-RLS-015]` en `rls-isolation.int.test.ts`: como `pf_app` y como `pf_worker` (`SET LOCAL ROLE`), sin contexto, la lectura de `iam.workspace_export` filtrada por W1 y sin filtro, con una exportación `READY` de W1 y con la tabla vacía, falla con `PF002`. Debe fallar antes de la migración
- [ ] 2.4 `[TC-SECURITY-RLS-016]` en `rls-isolation.int.test.ts`: sin contexto y con `SET LOCAL ROLE pf_maintenance` desde `pf_worker`, el `SELECT id, workspace_id, requested_by` de los vencidos ve solo el `READY` vencido de W1 (no el `READY` vigente ni el `DISCARDED` de W2); leer `wrapped_key` u `object_key` falla con `42501`; un `UPDATE … SET status = 'EXPIRED'` falla. Además, `WorkspaceExportService.expireDue` con los adapters reales y el pool de `pf_worker` expira el de W1 y deja su auditoría `identity.export.expired`
- [ ] 2.5 `[TC-SECURITY-RLS-007]` endurecido: en la transacción revertida de la matriz, el superusuario vacía antes `platform.idempotency_key` e `iam.workspace_export` (`session_replication_role = 'replica'`); el bloque `RLS-FAIL-CLOSED-MATRIX` y los `RLS-FAIL-CLOSED-FINDING` se conservan y el test falla con `expect(findings).toEqual([])`. Título nuevo del test: `[TC-SECURITY-RLS-007] sin contexto ninguna tabla registrada devuelve filas ni un vacío sin PF002`
- [ ] 2.6 `[TC-SECURITY-RLS-017]` en `rls-isolation.int.test.ts`: la misma matriz con `SET LOCAL ROLE pf_worker` y la lista declarada en el test (lectura filtrada y sin filtro de `platform.outbox`, `platform.inbox` y `platform.dead_letter`) como únicas operaciones admitidas sin `PF002` ni `42501`; cualquier otra hace fallar el test con su tabla y su operación
- [ ] 2.7 `[TC-SECURITY-RLS-018]` en `rls-isolation.int.test.ts`: consulta a `pg_policies` de las políticas con rol `pf_app` o `pf_worker` cuyo `qual` o `with_check` mencione `current_workspace_id_if_set`; deben ser exactamente `iam.workspace.workspace_member_read` e `iam.workspace_membership.membership_read`, y las dos deben mencionar `current_user_id`. Debe fallar antes de la migración (`iam.workspace_export.ws_isolation`)

## 3. INFRAESTRUCTURA: migración y worker (bloqueado por la pregunta 1 de docs/55)

- [ ] 3.1 Migración expand `apps/api/db/migrations/<timestamp>_platform_rls_fail_closed_gaps.sql` (timestamp posterior a la última de `main`), según el design (decisiones 1 y 2): `platform.current_idempotency_scope_id()` (plpgsql `STABLE PARALLEL SAFE`, `PF002` sin workspace ni usuario, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO pf_app`); `ALTER POLICY idempotency_key_scope` con el conjunto `scope_id = platform.current_idempotency_scope_id() AND <CASE vigente>` en `USING` y `WITH CHECK`; `ALTER POLICY ws_isolation ON iam.workspace_export` a `workspace_id = platform.current_workspace_id()`; `ALTER POLICY retention_scan ON iam.workspace_export TO pf_maintenance`; `GRANT USAGE ON SCHEMA iam` y `GRANT SELECT (id, workspace_id, requested_by, status, expires_at) ON iam.workspace_export` a `pf_maintenance`. Comentario de cabecera con la causa (design §Contexto) y D296
- [ ] 3.2 `migrate:down` que restaura las expresiones anteriores (copiadas literalmente de `20261002130000` y `20261009010000`), devuelve `retention_scan` a `pf_worker`, revoca los grants de `pf_maintenance` y borra la función; verificar `down` seguido de `up` (`pnpm test:stack` o CI)
- [ ] 3.3 `PgExportRepository.findExpired` (`packages/contexts/identity/src/infrastructure/portability/pg-portability.ts`): `SET LOCAL ROLE pf_maintenance` antes del `SELECT`, en la transacción de la unidad de trabajo sin contexto; actualizar el comentario de `findExpired` y el de `WorkspaceExportService.expireDue`. Verificar con `grep` que ninguna consulta de producción usa sentencias preparadas con nombre (`name:` en la configuración de la consulta de `pg`) y anotarlo en ADR-0023 (riesgo de planes genéricos, design §Riesgos)
- [ ] 3.4 Con la migración: TC-SECURITY-RLS-013, 015, 007 (estricto), 017 y 018 pasan a verde; TC-SECURITY-RLS-014 y 016 en verde

## 4. TESTS AUTOMATIZADOS y regresión

- [ ] 4.1 Regresión: TC-SECURITY-RLS-001..006, TC-SECURITY-ISOLATION-001, TC-IDENTITY-EXPORT-007 (expiración por la cola real del worker en `workspace-export-lifecycle.api.test.ts`) y los TC de idempotencia de `platform/api-conventions` en verde sin cambios
- [ ] 4.2 `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check` (sin advertencias nuevas), `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking` (sin cambios de contrato)
- [ ] 4.3 `pnpm test:integration` dos veces seguidas en verde (CI si la sesión no tiene Docker), con el bloque `RLS-FAIL-CLOSED-MATRIX` sin hallazgos para `pf_app` y `pf_worker`
- [ ] 4.4 `pnpm test:stack` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` (migración desde cero y job de retención en el stack) o CI. `pnpm test:e2e` no aplica (sin cambios de UI)

## 5. DOCS

- [ ] 5.1 TC-SECURITY-RLS-007 y 013..018 a `automated` con sus `automated_tests`; notas de TC-SECURITY-RLS-007 sin los hallazgos de D296 (corregidos por este change)
- [ ] 5.2 docs/38: quitar el hallazgo de D296 de §4 y actualizar la fila del change; docs/12 (roles: `pf_maintenance` lee los exports vencidos) y ADR-0023 (nota de la variante `current_workspace_id_if_set()` limitada a tablas de usuario y del riesgo de planes genéricos)
- [ ] 5.3 `pnpm exec openspec validate fix-rls-fail-closed-gaps --strict` y `pnpm traceability:check`
