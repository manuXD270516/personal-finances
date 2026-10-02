# Propuesta: add-audit-trail

## Why

Las transacciones de PFOS son editables y anulables; sin una pista de auditoría confiable no se puede responder "quién cambió este monto y cuándo", ni detectar errores o manipulación. ARCHITECTURE §7 y §13.2 exigen que la auditoría de mutaciones financieras sea **síncrona y atómica** (INV-029, NFR-DATA-007), por lo que este change debe existir antes que cualquier slice que mute dinero (cuentas, ledger, transacciones, conversiones). Es el change 2 del plan de Phase 1 (docs/03 §7).

## What Changes

- Se introduce el contexto AUDIT con un puerto público síncrono (`AuditPort`) que todo comando mutante invoca dentro de su unidad de trabajo: si la escritura de auditoría falla, el comando completo hace rollback.
- Cada registro guarda actor (usuario o sistema/proceso), workspace, acción, entidad y versión, diff antes/después con montos como decimal exacto + moneda, motivo, instante UTC, correlación y origen (`ui`, `api`, `import`, `rule`, `recurring`, `system`).
- Política de redacción: nunca secretos, tokens, cookies ni identificadores completos de cuenta; IP solo como HMAC.
- Almacenamiento append-only, particionado por mes, aislado por workspace (RLS) y con mutaciones bloqueadas para los roles de aplicación.
- Consulta del historial por entidad (Must) y por rango de fechas (Should) vía `GET /audit-log`, solo para OWNER/EDITOR.
- Auditoría de inicio y cierre de sesión (parte Phase 1 de FR-AUDIT-005).
- Chequeo de arquitectura que exige que todo command handler mutante use `AuditPort` dentro de la unidad de trabajo.
- **Fuera de alcance:** consulta global con filtros por actor/acción y export CSV (FR-AUDIT-006, Phase 2; aquí solo se adelanta el filtro por rango); auditoría de fallos de autorización, cambios de rol/membresía, export y reapertura de periodos (FR-AUDIT-005, Phase 2: cada change que introduzca esas acciones las audita usando este puerto); política de retención configurable (FR-AUDIT-007, Phase 9); hash encadenado de evidencia de manipulación (FR-AUDIT-008, Phase 9 — las columnas quedan reservadas); registro de lecturas de documentos (Phase 6); UI de auditoría más allá de la pestaña "Historial" de una entidad.

## Capabilities

### New Capabilities
- `audit/audit-trail`: registro atómico, contenido, atribución, redacción, inmutabilidad, aislamiento, consulta por entidad y por rango, autorización de lectura y auditoría de sesión.

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `audit/audit-trail` (10 requirements: 9 Must, 1 Should).

**Componentes/contextos impactados:** nuevo paquete `@pf/audit` (domain/application/infrastructure/interface/contracts); `@pf/platform` (unidad de trabajo expone la transacción al adapter de auditoría; contexto de actor/correlación/origen); `apps/api` (controller `audit-log`, interceptor de login/logout del primer request autenticado); `apps/web` (pestaña "Historial" reutilizable); reglas de dependency-cruiser y test de arquitectura de command handlers. Todos los contextos de Phase 1 que mutan datos consumen `AuditPort`.

**APIs impactadas:** agrega `GET /api/v1/workspaces/{workspaceId}/audit-log` (operación `listAuditLog`) y los schemas `AuditLogEntry`, `AuditLogPage`, `AuditActor`, `AuditChange`, `AuditOrigin`; el tag `Audit` pasa de "LATER" a Phase 1. Detalle exacto en design.md §Contratos.

**Tablas impactadas:** `audit.audit_log` (nueva, particionada por mes) y sus particiones; función `platform.forbid_mutation()` (reutilizada del ledger o creada aquí si aún no existe).

**Eventos impactados:** ninguno (la auditoría es síncrona; no produce ni consume eventos en Phase 1).

**Migraciones requeridas:** expand-only: crear schema `audit`, tabla particionada, particiones iniciales (mes actual + 2 siguientes) y job de creación de particiones; grants `SELECT, INSERT` a `pf_app`/`pf_worker`; RLS **WS-RO**. No destructiva.

**Test cases:** AÑADIDOS — TC-AUDIT-ACTOR-001, TC-AUDIT-REDACTION-001, TC-AUDIT-IMMUTABLE-001, TC-AUDIT-ISOLATION-001, TC-AUDIT-HISTORY-001, TC-AUDIT-RANGE-001, TC-AUDIT-ACCESS-001, TC-AUDIT-SESSION-001. MODIFICADOS — TC-AUDIT-ATOMIC-001 (requirement confirmado; invariante corregida de INV-015 a INV-029), TC-AUDIT-CONTENT-001 (requirement confirmado; la verificación de inmutabilidad pasa a TC-AUDIT-IMMUTABLE-001). DEPRECADOS — ninguno. AÑADIDOS (2026-10-02, decisiones D27/D28 del owner): TC-AUDIT-ACCESS-002.

**Impacto de regresión:** ninguno sobre comportamiento existente (no hay slices de negocio implementados). Desde este change, todo command handler mutante sin `AuditPort` hace fallar el test de arquitectura; agrega latencia de un INSERT por comando, dentro del presupuesto de NFR-PERF-003 (p95 ≤ 150 ms).

**Riesgos introducidos:** crecimiento del volumen de `audit.audit_log` (mitigado con particionado mensual); fuga de datos sensibles en el diff (mitigado con redacción por allow-list y TC-AUDIT-REDACTION-001); olvido de auditar un comando nuevo (mitigado con el test de arquitectura). Invariantes afectadas: **INV-029** (implementada aquí), INV-025 (aislamiento de workspace aplicado a auditoría), INV-001 (montos del diff como string decimal).
