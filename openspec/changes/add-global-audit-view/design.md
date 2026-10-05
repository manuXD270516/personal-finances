# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: FR-AUDIT-005/006, docs/12 §13.2 (eventos de seguridad auditados; `/audit-log` OWNER/EDITOR), docs/10 §13 (`listAuditLog` "filtro `actor` en Phase 2") y §14 (leer audit log OWNER/EDITOR; exportar datos solo OWNER), docs/31 D22 (`/audit-log` Phase 1, columnas `origin` y `actor_process`) y D28 (VIEWER solo ve el historial de lo que puede ver), D52 (convenciones de CSV del recorrido: UTF-8 con BOM, `,`, punto decimal, TZ con desfase, neutralización). Tabla as-built `audit.audit_log` (particionada por `occurred_at`, índices por entidad, recientes y actor; acción con formato `contexto.entidad.verbo`).

| Capa | Cambios |
|---|---|
| domain | Catálogo `AuditActionCategory` (acción → `SECURITY` | `DATA`), test que exige que toda acción emitida esté catalogada. |
| application | `SearchAuditLog(filters, cursor)` y `ExportAuditLog(filters)`; `RecordAuthorizationDenial(userId, workspaceId, operationId, code)` con limitador. |
| infrastructure | Índices nuevos; limitador por clave `(userId, workspaceId, operationId, minuto)` en Valkey (`RATE_LIMIT_STORE`) con fallback en memoria del proceso. |
| interface | `listAuditLog` extendido, `exportAuditLog`; guard de roles/membresía de `@pf/platform` invoca el registrador; UI "Auditoría". |

## Objetivos / No objetivos

**Objetivos:** FR-AUDIT-006 y los eventos de seguridad de FR-AUDIT-005 de Phase 2 que no cubren otros changes (fallo de autorización; los de export los escribe `add-workspace-export` y la reapertura de periodo pf-p2a).

**No objetivos:** retención, hash encadenado, alertas, PDF.

## Decisiones

1. **Misma operación `listAuditLog`** con parámetros aditivos (no un endpoint nuevo): compatible con Phase 1. `action` admite lista separada por comas; `category=SECURITY|DATA`.
2. **Rango máximo**: sin `aggregateId` ni `correlationId`, el rango no puede superar 366 días (`VALIDATION_FAILED`) para acotar el escaneo de particiones; con `aggregateId`/`correlationId` no hay límite (índices selectivos).
3. **Export CSV síncrono** hasta 50000 filas (`VALIDATION_FAILED` si se excede: el usuario acota filtros); columnas: instante (TZ del workspace con desfase), actor (nombre visible e id), origen, acción, tipo de entidad, id de entidad, versión, motivo, correlación, diff resumido (`campo: antes → después`, con enmascarado ya aplicado al escribir, NFR-SEC-015). Mismo `CsvWriter` del recorrido (D52). Rol OWNER (`x-required-role: OWNER`); cada export se audita como `audit.log.exported` (categoría `SECURITY`) con los filtros. Rate limit de exports (10/min).
4. **Fallos de autorización**: el guard, al rechazar con `INSUFFICIENT_ROLE` o `WORKSPACE_ACCESS_DENIED` sobre un workspace existente, escribe `security.authorization.denied` (actor `USER`, `aggregate_type = 'Workspace'`, `aggregate_id = workspaceId`, `changes` con `operationId` y `code`, sin cuerpo de la solicitud) en una transacción propia con `SET LOCAL app.workspace_id` del workspace objetivo, usando el rol `pf_app`. Es la excepción documentada a "auditoría en la misma transacción que la mutación" (INV-029): no hay mutación. Limitador: 1 registro por `(user, workspace, operationId)` por minuto. Un workspace inexistente no se audita (no hay dónde; se cuenta en métrica `authz_denied_total`).
5. **Categoría derivada** de `action` (no columna nueva): `SECURITY` = `identity.session.*`, `security.authorization.denied`, `identity.workspace.settings_changed`, `identity.export.*`, `identity.workspace.restored`, `planning.period.reopened` (pf-p2a), `audit.log.exported`, `audit.lifecycle.exported`; el resto `DATA`. El filtro se traduce a `action = ANY(:securityActions)`.
6. **Índices**: `(workspace_id, correlation_id)` y `(workspace_id, action, occurred_at DESC)` en la tabla particionada (PostgreSQL los propaga a las particiones).

### Contratos

- `listAuditLog` — `GET W/audit-log?actorUserId=&action=&aggregateType=&aggregateId=&origin=&correlationId=&category=&from=&to=&cursor=&limit=` (EDITOR).
- `exportAuditLog` — `GET W/audit-log/export?format=csv&<mismos filtros>` (OWNER) ⇒ `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="audit-<workspace>-<from>-<to>.csv"`.

## Riesgos / Trade-offs

- **Escritura en el camino de un 403**: añade latencia al rechazo (aceptable) y no debe convertir un 403 en 500: la falla de escritura se traga y se registra en logs/métricas.
- **Catálogo de categorías desactualizado**: el test de catálogo falla si un change agrega una acción sin categoría.

## Plan de migración

Expand: índices nuevos (creación en la tabla padre particionada; en local es inmediata; en cloud se evalúa `CREATE INDEX` por partición `CONCURRENTLY` + `ATTACH` si el volumen lo requiere). Contrato: parámetros y operación nuevos (MINOR).

## Preguntas abiertas

1. **¿EDITOR puede usar la vista global?** FR-AUDIT-006 dice "(solo `OWNER`)" para la consulta global y el export; D28 y docs/10 §14 permiten leer el audit log a EDITOR. **Recomendación:** consulta global para OWNER y EDITOR (coherente con D28), export CSV solo OWNER.
2. **Auditar fallos de autorización de no miembros** (`WORKSPACE_ACCESS_DENIED`) en el workspace objetivo: revela al OWNER que un usuario ajeno intentó acceder (útil) pero escribe en un workspace por acción de un no miembro. **Recomendación:** sí, con el límite por minuto; en Phase 2 (un usuario) el caso es casi inexistente.

## Dependencias entre changes

- **Requiere aplicados:** `add-audit-trail`, `add-workspace-identity`, `add-lifecycle-timeline` (convenciones de CSV de D52).
- **Orden consolidado (docs/03 §7): 21**, después de `add-bulk-edit` (20), `add-reconciliation` (15) y `add-month-closing` (18), cuyas acciones ya existen al implementarlo; `add-workspace-export` (23) agrega `identity.export.*` al catálogo de categorías.
- **Se beneficia de** (no bloqueante): `add-bulk-edit` (filtro por operación masiva), `add-reconciliation`, `add-workspace-export` (acciones `identity.export.*` en la categoría `SECURITY`), pf-p2a (`planning.period.reopened`). El catálogo de categorías se amplía en cada change que agrega acciones de seguridad.
