# ADR-0023: Multi-tenancy y Row-Level Security — `workspace_id` en toda tabla + RLS como defense-in-depth

- Estado: Aceptado (2026-10-02, tras SPIKE-02; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §1, §9; docs/08-data-model.md; ADR-0005, ADR-0007, ADR-0010, ADR-0020, ADR-0022; OpenSpec capabilities `identity/workspace-membership`, `security/access-control`; SPIKE-02, SPIKE-06

## Contexto y problema

PFOS arranca con un usuario y un workspace, pero el modelo es multi-usuario/multi-workspace desde el día 1 (compartir finanzas familiares, separar finanzas personales de un negocio). Un fallo de aislamiento (un `WHERE workspace_id = ?` olvidado) expondría datos financieros de otra persona: el peor incidente posible del producto. Retro-adaptar multi-tenancy más tarde es costoso (migrar todas las tablas, todos los índices, todas las queries).

Hay que decidir el modelo de tenancy y cómo se garantiza el aislamiento.

## Drivers de decisión

- Aislamiento robusto ante errores de código (defense-in-depth).
- Costo y simplicidad operativa (una sola BD).
- Rendimiento (índices por tenant).
- Compatibilidad con pooling de conexiones y con el patrón Unit of Work (ADR-0007).
- Facilidad de backup/export/borrado por workspace.

## Opciones consideradas

1. **Base compartida, schema compartido, columna `workspace_id` + RLS** (elegida).
2. Columna `workspace_id` **sin RLS** (solo filtros en aplicación).
3. **Schema por tenant**.
4. **Base de datos por tenant**.

## Decisión

- **Toda tabla de negocio** tiene `workspace_id uuid NOT NULL` (FK a `iam.workspace`, única FK cross-schema permitida junto con `currency`, ADR-0003), incluida en índices compuestos con la clave de acceso (`(workspace_id, …)`).
- **RLS habilitado y forzado** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) en cada tabla de negocio con política:
  `USING (workspace_id = current_setting('app.workspace_id')::uuid)` y `WITH CHECK` equivalente.
  `current_setting` sin `missing_ok` → si la variable no está definida, la query **falla** (fail-closed).
- **Contexto por transacción:** la Unit of Work ejecuta `SET LOCAL app.workspace_id = '<uuid>'` (y `app.user_id`) al inicio de cada transacción; **nunca** `SET` de sesión (evita fuga entre requests en conexiones del pool).
- **Roles:** `pf_app` sin `BYPASSRLS`, **no owner** de las tablas, solo DML necesario (y sin UPDATE/DELETE en tablas append-only del ledger); `pf_migrator` owner de objetos para DDL; `pf_readonly` para soporte/reporting con RLS igualmente aplicado. Jobs de mantenimiento cross-workspace (purga de outbox, métricas globales) usan un rol específico `pf_maintenance` con `BYPASSRLS` limitado a tablas de `platform`, o iteran por workspace estableciendo el contexto.
- **Capa de aplicación** sigue siendo la **primera barrera**: guards de membership/rol (ADR-0010) y repositorios que filtran por `workspace_id` explícitamente. RLS es la **segunda barrera** (defense-in-depth), no la única.
- Tablas globales sin RLS: catálogo `currency`, configuración de sistema; `iam.user` y `iam.workspace_membership` con políticas específicas por `user_id`.
- Eventos outbox llevan `workspaceId`; los consumidores establecen el contexto RLS antes de procesar.
- Export y borrado por workspace (derecho del usuario) implementables con queries filtradas por `workspace_id`.

## Análisis de opciones

### 1. Schema compartido + `workspace_id` + RLS (elegida)
- **Pros:** aislamiento reforzado por la BD incluso ante bugs de aplicación; una BD, un conjunto de migraciones; escalable a miles de workspaces; compatible con pooling usando `SET LOCAL` dentro de transacción.
- **Contras:** toda operación debe ir en transacción con contexto (incluidas lecturas); políticas en cada tabla (riesgo de olvidar una → mitigado con test); ligero overhead de evaluación de políticas; depuración más confusa ("0 filas" en lugar de error).
- **Costo:** 0. **Complejidad operativa:** media-baja.

### 2. `workspace_id` sin RLS
- **Pros:** más simple, sin transacción obligatoria para lecturas.
- **Contras:** un solo `WHERE` olvidado = fuga; depende 100% de disciplina y code review (equipo de 1 + agentes de IA = riesgo alto).
- **Costo:** 0. **Complejidad:** baja; **riesgo:** alto.

### 3. Schema por tenant
- **Pros:** aislamiento fuerte; backup/restore por tenant sencillo.
- **Contras:** choca con "schema por contexto" (ADR-0003) → schemas = tenants × contextos; migraciones N veces; catálogo de PG crece; pooling por `search_path` propenso a errores.
- **Costo:** medio. **Complejidad operativa:** alta.

### 4. Base por tenant
- **Pros:** aislamiento máximo, residencia de datos por cliente.
- **Contras:** costo y operación inviables para un producto personal/familiar; conexiones y migraciones por BD.
- **Costo:** alto. **Complejidad operativa:** muy alta.

## Consecuencias

**Positivas**
- Doble barrera contra fugas entre workspaces.
- Multi-usuario listo sin migración futura.
- Modelo uniforme para todos los contextos.

**Negativas**
- Todas las queries (incluido reporting) deben ejecutarse dentro de una transacción con contexto.
- Herramientas ad-hoc (psql) requieren `SET` explícito o rol de mantenimiento.

**Riesgos**
- Tabla nueva sin RLS. *Mitigación:* **architecture test SQL** en CI: toda tabla con columna `workspace_id` en schemas de negocio tiene `relrowsecurity = true`, `relforcerowsecurity = true` y al menos una política; falla si no.
- Rol de app con privilegios excesivos. *Mitigación:* test que verifica `rolbypassrls = false` y que `pf_app` no es owner de ninguna tabla.
- `SET` de sesión accidental. *Mitigación:* lint/grep en CI contra `SET app.` sin `LOCAL`; uso exclusivo del helper de UoW.
- Rendimiento de políticas con funciones. *Mitigación:* política simple con `current_setting`, índices con `workspace_id` como primera columna; medir en SPIKE-02.

## Validación

- **SPIKE-02:** con dos workspaces sembrados, un repositorio que omite el filtro por `workspace_id` devuelve solo filas del workspace del contexto; sin contexto establecido la query falla; benchmark con/sin RLS (overhead esperado < 10%).
- **SPIKE-06:** token de usuario A con `workspaceId` de B → 404/403 en API y 0 filas en BD.
- Tests de integración permanentes de aislamiento por contexto (`TC-IDENTITY-ISOLATION-*`).
- Architecture test SQL descrito en Riesgos.

## Notas

- Verificado 2026-10-01: el patrón recomendado en la comunidad para RLS con pooling es `set_config('app.…', value, true)`/`SET LOCAL` dentro de transacción; `SET` de sesión con poolers en modo transacción filtra contexto entre requests.
- Si en el futuro se usa un pooler externo (PgBouncer/RDS Proxy) en modo transacción, el patrón `SET LOCAL` sigue siendo seguro; verificar compatibilidad de RDS Proxy (pinning) en SPIKE-09.
