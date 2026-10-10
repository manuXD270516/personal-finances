# Tareas

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `identity/authentication`, `platform/api-conventions` y `audit/audit-trail`; `openspec validate fix-phase-2-gaps --strict`
- [ ] 1.2 Revisar TC-IDENTITY-AUTH-009, TC-PLATFORM-API-021, TC-PLATFORM-API-022 y TC-AUDIT-GLOBAL-008; pasar a `ready` y `requirement_status: confirmed`

## 2. IMPLEMENTACIÓN (TDD)

- [ ] 2.1 `LocaleTag.fromStored` con fallback a `APP_DEFAULT_LOCALE` en la rehidratación de usuario y workspace; el importer normaliza (TC-IDENTITY-AUTH-009)
- [ ] 2.2 Bucket `costly` (`RATE_LIMIT_COSTLY_PER_MIN`, config y `docs/config-reference.md`), extensión `x-rate-limit: costly` en el contrato para las 4 operaciones, interceptor que consume la cuota; la exportación de auditoría deja su política manual (TC-PLATFORM-API-021)
- [ ] 2.3 Hash idempotente de `requestWorkspaceImport` con el SHA-256 del archivo (TC-PLATFORM-API-022)
- [ ] 2.4 Puerto `UserDisplayNames` (audit) implementado por identity y columna `actorName` en el CSV global (TC-AUDIT-GLOBAL-008); actualizar los tests web/e2e del CSV si verifican columnas

## 3. TESTS Y DOCS

- [ ] 3.1 Automatizar los TC con el TC-ID en el nombre; los tests existentes de bulk edit, export/import y auditoría siguen verdes (subiendo la cuota costosa del harness donde no se prueba el límite)
- [ ] 3.2 Actualizar docs/10 §10 (bucket implementado), docs/config-reference.md y la matriz; `pnpm spec:validate` y `pnpm traceability:check`
