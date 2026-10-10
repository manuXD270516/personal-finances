# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas de `identity/authentication`, `platform/api-conventions` y `audit/audit-trail`; `openspec validate fix-phase-2-gaps --strict`
  - 2026-10-09: deltas revisados contra proposal/design; `pnpm spec:validate` verde (`openspec validate fix-phase-2-gaps --strict`).
- [x] 1.2 Revisar TC-IDENTITY-AUTH-009, TC-PLATFORM-API-021, TC-PLATFORM-API-022 y TC-AUDIT-GLOBAL-008; pasar a `ready` y `requirement_status: confirmed`
  - 2026-10-09: TC-IDENTITY-AUTH-009, TC-PLATFORM-API-021, TC-PLATFORM-API-022 y TC-AUDIT-GLOBAL-008 revisados contra sus scenarios; `requirement_status: confirmed` y, con sus tests, `automated`.

## 2. IMPLEMENTACIÓN (TDD)

- [x] 2.1 `LocaleTag.fromStored` con fallback a `APP_DEFAULT_LOCALE` en la rehidratación de usuario y workspace; el importer normaliza (TC-IDENTITY-AUTH-009)
  - 2026-10-09: `LocaleTag.fromStored(raw, fallback)`; `PgUserRepository`/`PgWorkspaceRepository` la usan con `APP_DEFAULT_LOCALE` (por defecto `es-BO` en los helpers de solo lectura de `identity.module`); `PgWorkspaceImporter` normaliza el locale del workspace (opción `defaultLocale`, cableada en el worker). La escritura sigue con `LocaleTag.of`. Sin log `warn` (identity no tiene logger): ver informe.
- [x] 2.2 Bucket `costly` (`RATE_LIMIT_COSTLY_PER_MIN`, config y `docs/config-reference.md`), extensión `x-rate-limit: costly` en el contrato para las 4 operaciones, interceptor que consume la cuota; la exportación de auditoría deja su política manual (TC-PLATFORM-API-021)
  - 2026-10-09: política `costly` (`RATE_LIMIT_COSTLY_PER_MIN`, config y `docs/config-reference.md`); extensión `x-rate-limit: costly` en `bulkEditTransactions`, `requestWorkspaceExport`, `requestWorkspaceImport` y `exportAuditLog` (regla Spectral `pfos-rate-limit-extension`); `RateLimitInterceptor` la consume y, con `Idempotency-Key`, la cobra `IdempotencyInterceptor` solo en ejecuciones reales (un replay no la consume; un 429 libera la reserva). Se eliminaron las políticas manuales `EXPORT_POLICY` (auditoría) y `EXPORT_REQUEST_POLICY` (export de workspace). `pnpm contract:breaking` limpio y Spectral/Redocly sin errores.
- [x] 2.3 Hash idempotente de `requestWorkspaceImport` con el SHA-256 del archivo (TC-PLATFORM-API-022)
  - 2026-10-09: `ImportUploadGuard` (guard de la operación) lee el archivo antes de la idempotencia y fija `{ fileSha256 }` como payload (`ApiRequestState.idempotencyPayload`); el handler reutiliza el archivo ya leído. Misma clave con otro archivo ⇒ 422 `IDEMPOTENCY_KEY_REUSED`; repetir el mismo reproduce la respuesta.
- [x] 2.4 Puerto `UserDisplayNames` (audit) implementado por identity y columna `actorName` en el CSV global (TC-AUDIT-GLOBAL-008); actualizar los tests web/e2e del CSV si verifican columnas
  - 2026-10-09: puerto `UserDisplayNames` en audit, implementado por `identityUserDisplayNames()` (identity) con la función `iam.audit_actor_names` (SECURITY DEFINER acotada al workspace del contexto RLS y a los actores de su log; migración expand `20261009120000_identity_audit_actor_names.sql`); resolución en bloque por exportación; columna `actorName` tras `actorId`. Actualizado el spec e2e del CSV.

## 3. TESTS Y DOCS

- [x] 3.1 Automatizar los TC con el TC-ID en el nombre; los tests existentes de bulk edit, export/import y auditoría siguen verdes (subiendo la cuota costosa del harness donde no se prueba el límite)
  - 2026-10-09: TC con el TC-ID en el nombre del test; el harness sube `RATE_LIMIT_COSTLY_PER_MIN` en los tests de API que no prueban el límite.
- [x] 3.2 Actualizar docs/10 §10 (bucket implementado), docs/config-reference.md y la matriz; `pnpm spec:validate` y `pnpm traceability:check`
  - 2026-10-09: docs/10 §10 (bucket as-built), §7 (hash multipart), tabla de audit-log, docs/19 y `docs/config-reference.md` (`pnpm config:docs`); `pnpm spec:validate` y `pnpm traceability:check` verdes.
