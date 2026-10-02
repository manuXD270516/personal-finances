# Tareas

> DESIGN GATE aprobado el 2026-10-01 (docs/DESIGN-GATE.md). Requiere `bootstrap-platform-foundation` y `add-workspace-identity` aplicados.

## 1. Spec y test cases (SPEC → TEST CASE)

- [ ] 1.1 Revisar `specs/audit/audit-trail/spec.md` con el owner y confirmar que cada requirement Must tiene ≥ 1 TC; verificar con `openspec validate add-audit-trail --strict --no-interactive`
- [ ] 1.2 Confirmar los TC en `tests/cases/audit/` (ATOMIC-001, CONTENT-001, ACTOR-001, REDACTION-001, IMMUTABLE-001, ISOLATION-001, HISTORY-001, RANGE-001, ACCESS-001, SESSION-001) con `status: ready`; verificar que el chequeo del catálogo los acepta

## 2. Dominio (`@pf/audit/domain`)

- [ ] 2.1 TDD: `AuditRecord`, `AuditActor`, `AuditOrigin`, `AuditAction` con tests unitarios nombrados `[TC-AUDIT-CONTENT-001]` / `[TC-AUDIT-ACTOR-001]`; verificar que el registro es inmutable y exige `userId` para actor USER y `process` para SYSTEM/WORKER
- [ ] 2.2 TDD: `ChangeSet` y serialización de `Money` como string decimal + moneda (nunca `number`); verificar con PBT de round-trip a escalas 0, 2, 6, 8, 18
- [ ] 2.3 TDD: `RedactionPolicy` por allow-list (identificador de cuenta → últimos 4, sin tokens/cookies/secretos, campos desconocidos omitidos); tests `[TC-AUDIT-REDACTION-001]` con test "canario"

## 3. Aplicación (`@pf/audit/application`)

- [ ] 3.1 `AuditPort` en `contracts` y `AuditRecorder` que completa contexto (actor, workspace, correlación, origen, `Clock`) y falla fuera de una unidad de trabajo; verificar con tests de aplicación
- [ ] 3.2 Queries `GetAuditHistory` y `SearchAuditLog` (rango en zona del workspace, orden por defecto según filtro); verificar con tests `[TC-AUDIT-HISTORY-001]`, `[TC-AUDIT-RANGE-001]` usando `FixedClock`
- [ ] 3.3 Propagación de actor de sistema y `correlationId`/`causationId` en jobs y consumidores del worker; verificar con `[TC-AUDIT-ACTOR-001]`

## 4. Infraestructura

- [ ] 4.1 Migración `audit_0001_create_audit_log` (schema, tabla particionada mensual + DEFAULT, índices, RLS WS-RO fail-closed, grants SELECT/INSERT, trigger `forbid_mutation`); verificar con test de migración y `[TC-AUDIT-IMMUTABLE-001]` (UPDATE/DELETE/TRUNCATE como `pf_app` fallan)
- [ ] 4.2 `KyselyAuditLogRepository` sobre la transacción de la `UnitOfWork` y `HmacIpHasher`; verificar con `[TC-AUDIT-ATOMIC-001]` (rollback único con fallo inyectado)
- [ ] 4.3 Job `audit.ensure-partitions` en el worker y alerta si la partición DEFAULT recibe filas; verificar con test de integración que crea la partición del mes siguiente
- [ ] 4.4 Test de aislamiento con dos workspaces; verificar con `[TC-AUDIT-ISOLATION-001]`

## 5. API

- [ ] 5.1 Consolidar en `contracts/openapi/finance-api.v1.yaml` los cambios de design.md §Contratos (lo hace el proceso de contratos); verificar con Spectral/Redocly lint
- [ ] 5.2 `AuditLogController` `GET /audit-log` con guard EDITOR, paginación por cursor y problem+json; verificar con tests de API `[TC-AUDIT-ACCESS-001]` y test de contrato
- [ ] 5.3 Interceptor de sesión (primer request autenticado de la sesión → `identity.session.started`; logout → `identity.session.ended`); verificar con `[TC-AUDIT-SESSION-001]`

## 6. Arquitectura

- [ ] 6.1 Regla de dependency-cruiser/test de arquitectura: todo `*CommandHandler` mutante depende de `AuditPort`; verificar que un fixture sin auditoría hace fallar el chequeo

## 7. UI

- [ ] 7.1 Componente "Historial" reutilizable (lista cronológica con actor, acción, instante en zona del workspace, diff antes/después con montos formateados por locale `es-BO`), visible solo para OWNER/EDITOR; textos vía catálogo i18n; verificar con test de componente y axe sin violaciones serias

## 8. Tests automatizados y E2E

- [ ] 8.1 Integración con Testcontainers para todos los TC de `tests/cases/audit/` nombrados con su TC-id; verificar en CI
- [ ] 8.2 E2E smoke: editar una entidad de fixture y ver su historial en la UI; verificar en Playwright contra Compose `core`

## 9. Documentación y cierre

- [ ] 9.1 Actualizar docs/08 §5.16 (columnas `origin`, `actor_process`), docs/04 §3.17 y docs/10 (operación `listAuditLog` ya en Phase 1); verificar enlaces
- [ ] 9.2 Actualizar `automation_status`/`status` de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict --no-interactive`; archivar el change
