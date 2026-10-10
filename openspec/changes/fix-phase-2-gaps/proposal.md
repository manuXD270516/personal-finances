# Propuesta: fix-phase-2-gaps

## Why

Al implementar Phase 2 los agentes reportaron huecos pequeños que no bloquearon los merges pero que el owner nota al usar la app o que contradicen docs/10 y las convenciones de la API. Se agrupan en un solo change antes de Phase 3 (decisión del owner del 2026-10-09).

## What Changes

- **`GET /me` con locale no soportado:** hoy un `iam.user.locale` fuera de es/en/pt (p. ej. `fr-FR`, por un import o un dato antiguo) hace fallar `/me` porque la rehidratación usa el validador estricto de escritura. Al leer, un locale no soportado se reemplaza por `APP_DEFAULT_LOCALE`; la escritura sigue rechazándolo. El import de workspace normaliza igual los locales que escribe.
- **Bucket de operaciones costosas (10/min):** docs/10 §10 y los designs de `add-bulk-edit` y `add-workspace-export` lo exigen, pero la plataforma solo tiene lecturas (600/min) y escrituras (120/min). Se agrega el bucket `costly` (`RATE_LIMIT_COSTLY_PER_MIN`, por defecto 10) por usuario y workspace, aplicado a la edición masiva, a la solicitud de export e import de workspace y a la exportación CSV de auditoría (que hoy lo implementa a mano en su controller y pasa a usar el bucket común).
- **Nombre del actor en el CSV de auditoría:** el CSV global trae solo `actorId`. Se agrega la columna `actorName` (nombre visible actual del usuario; vacía para procesos o si no se puede resolver), sin quitar `actorId` (aditivo).
- **Idempotencia de la importación de workspace:** el hash de la petición multipart se calcula sin el archivo, así que la misma clave con otro archivo devuelve la importación anterior. El hash de las operaciones multipart incluye el SHA-256 del archivo subido; misma clave con otro archivo ⇒ 422 `IDEMPOTENCY_KEY_REUSED`.
- **Fuera de alcance:** `/patrimonio` en la sidebar. Es deliberado (docs/33 D104: tarjeta en el Home con enlace a la vista completa; `nav.ts` lo marca bajo Home). Adapter Valkey del rate limiter para varias réplicas (change aparte, con el despliegue).

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `identity/authentication`: `/me` tolera un locale guardado no soportado.
- `platform/api-conventions`: bucket de operaciones costosas; el payload idempotente incluye el archivo en multipart.
- `audit/audit-trail`: el CSV incluye el nombre del actor.

## Impact

**Componentes:** `@pf/identity` (rehidratación de `LocaleTag`, importer), `@pf/platform` (políticas de rate limit, `IdempotencyInterceptor`/hash multipart, config), `@pf/transactions` (bulk edit), `@pf/audit` (exporter con puerto `UserDisplayNames` implementado por identity, como `WorkspaceTimeZones`), `apps/api` (wiring).

**APIs:** `contracts/openapi/finance-api.v1.yaml`: extensión `x-rate-limit: costly` y `RateLimit-Policy` documentada en las 4 operaciones costosas; sin cambios de esquema. El CSV gana una columna.

**Tablas:** ninguna. **Eventos:** ninguno. **Migraciones:** ninguna, salvo que el puerto de nombres necesite leer usuarios fuera de la RLS de `iam.user`: entonces una función `SECURITY DEFINER` acotada a los actores del audit log del workspace (migración expand).
