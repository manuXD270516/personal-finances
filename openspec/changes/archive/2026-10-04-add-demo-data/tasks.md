# Tareas

> Requiere aplicados: `add-event-outbox`, `add-workspace-identity`, `add-audit-trail`, `add-ledger-core`, `add-classification`, `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-market-rate-providers`, `add-basic-dashboard`; recomendado `add-lifecycle-timeline`. Decisiones del owner docs/31 D36 y D41; ADR-0026 (Aceptado 2026-10-04).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `identity/demo-data` y las preguntas abiertas de design.md (habilitación en staging/producción, ventana del dataset, aceptación de ADR-0026); verificar con `openspec validate add-demo-data --strict`
  - Nota (2026-10-04): resueltas por el owner en docs/31 D41 — `DEMO_DATA_ENABLED` deshabilitado por defecto en `staging`/`production`, ventana de 21 meses (recorte a 6 si la carga supera 2 min), ADR-0026 Aceptado. La revisión de seguridad del amend a `forbid_mutation()` sigue como gate de implementación.
- [x] 1.2 Revisar TC-IDENTITY-DEMO-001..014 contra los scenarios (fechas fijas, `FixedClock`); verificar con `pnpm traceability:check` que todo requirement Must tiene ≥ 1 TC
  - Nota (2026-10-04): TC-IDENTITY-DEMO-001..014 revisados contra los scenarios (ancla fija 2026-09-30, `FixedClock`); `pnpm traceability:check` OK, los 14 automatizados.

## 2. DOMAIN (TDD)

- [x] 2.1 TDD de `Workspace.createDemo` y de la máquina de estados `demoStatus` (`LOADING → READY | FAILED → CLEANING → PURGED`; `is_demo` inmutable; `WORKSPACE_NOT_DEMO`; `DEMO_WORKSPACE_ALREADY_EXISTS`): tests con TC-IDENTITY-DEMO-005, -006, -009 antes del código
  - Nota: `packages/contexts/identity/src/domain/demo-workspace.test.ts` (TC-005/-006/-008/-010) escrito antes de `Workspace.createDemo`/máquina de estados; `DEMO_WORKSPACE_ALREADY_EXISTS` se aplica en aplicación + índice único parcial.
- [x] 2.2 Generadores deterministas del manifiesto de Phase 1 (`seeds/demo`, PRNG sembrado, montos como enteros de unidades mínimas → `Money`, sin `Math.random`/`Date.now`): test de que dos ejecuciones con la misma ancla producen los mismos comandos (TC-IDENTITY-DEMO-007)
  - Nota: `apps/api/src/demo/dataset/` (no `seeds/demo`: se empaqueta con la imagen del worker). mulberry32 sembrado, `bigint` → string decimal, ESLint prohíbe `Math.random`/`Date.now`/`new Date()`; `demo-plan.test.ts` (TC-007) + `golden-summary.json`.

## 3. APPLICATION

- [x] 3.1 `RequestDemoData` (rol OWNER en el origen, flag de entorno, límite por usuario, auditoría en el origen, job vía outbox); tests con TC-IDENTITY-DEMO-001, -002, -009, -012, -013
  - Nota: `DemoDataService.requestDemoData` (tests en memoria TC-001/-002/-009/-012/-013); el job se encola con `enqueueInTransaction` en la transacción del comando.
- [x] 3.2 `DemoDataLoader` (job `demo.load`): ejecución por casos de uso públicos con `SimulatedClock` y actor `system:demo`, lotes por mes, golden summary + invariant checker al final, `READY`/`FAILED`; tests con TC-IDENTITY-DEMO-007 y -008 (fallo inyectado a mitad de carga)
  - Nota: `apps/api/src/demo/demo-data-loader.ts`: casos de uso públicos vía `financeRuntimes`, `FixedClock` por fecha, RLS del OWNER y auditoría/eventos/recorrido con actor `system:demo`; lotes por mes; golden + balance de comprobación + `verifyLedgerIntegrity` acotado. Falla inyectada `transactions/2025-06` ⇒ FAILED (TC-008). Carga medida ~10 s en Testcontainers (< 2 min ⇒ se mantienen 21 meses).
- [x] 3.3 `CleanupDemoData` (archivo inmediato, auditoría en el origen, `DemoDataCleaned.v1`, job `demo.purge`, idempotente); tests con TC-IDENTITY-DEMO-006 y -010
  - Nota: archivo inmediato, auditoría en el origen, `DemoDataCleaned.v1` (en el origen), job `demo.purge`; idempotente; un demo `LOADING` ⇒ 409 `INVALID_STATUS_TRANSITION`.

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: columnas de `iam.workspace`, trigger de inmutabilidad de `is_demo`, índice único parcial por usuario, `platform.demo_workspace_run`, `platform.workspace_scoped_table` poblada; test de integración de TC-IDENTITY-DEMO-005
  - Nota: migración `20261004170000_identity_demo_data.sql` (también `PURGED`/`ARCHIVED`, `demo_requested_by`, guarda de transiciones). TC-005 en `apps/api/test/db/demo-purge.int.test.ts`.
- [x] 4.2 `platform.purge_demo_workspace()` (`SECURITY DEFINER`, `pf_migrator`, `EXECUTE` solo `pf_worker`) y nueva versión de `platform.forbid_mutation()`; tests de seguridad con Testcontainers: purga completa (TC-IDENTITY-DEMO-011), rechazo sobre workspace real incluso con la GUC fijada por `pf_app` (TC-IDENTITY-DEMO-006), y que TC-LEDGER-* de inmutabilidad y TC-AUDIT-IMMUTABLE-001 siguen verdes
  - Nota: tests de seguridad en `demo-purge.int.test.ts` (DELETE directo 42501 para pf_app/pf_worker y roles asumibles; PF006 para real, no CLEANING, nulo, inexistente y llamadores ≠ pf_worker; semántica exacta del trigger; purga completa contra el catálogo; real intacto + invariante). Suites TC-LEDGER-*/TC-AUDIT-IMMUTABLE-001 verdes en `pnpm test:integration`.
- [x] 4.3 Ampliar el chequeo de catálogo de RLS: toda tabla con `workspace_id` registrada en `platform.workspace_scoped_table`; verificar que CI falla con una tabla de prueba no registrada
  - Nota: `demoPurgeCatalogViolations` (sin registrar, registrada inexistente, orden de FKs) en TC-SECURITY-RLS-004 ampliado; la migración registra además toda tabla previa con `workspace_id` no listada (cubre `audit.lifecycle_transition` de add-lifecycle-timeline).
- [x] 4.4 Consumidores e ingesta de FX ignoran workspaces demo archivados/purgados (no-op idempotente); `DEMO_DATA_ENABLED` en `@pf/platform/config` y `.env.example`
  - Nota: `platform.workspace_is_retired()` en `EventConsumerRuntime` (no-op sin inbox); FX ya filtra `status='ACTIVE'`; `DEMO_DATA_ENABLED` en el contrato de configuración, `.env.example` y docs/config-reference.md.

## 5. API

- [x] 5.1 `POST W/demo-data`, `GET W/demo-data`, `POST W/demo-data/cleanup`, `Workspace.isDemo`/`demoStatus` y códigos nuevos según design.md § Contratos; tests de API y de contrato (TC-IDENTITY-DEMO-002, -006, -009, -012); eventos `DemoDataLoaded.v1`/`DemoDataCleaned.v1` validados con Ajv strict
  - Nota: `demo-data.api.test.ts` valida respuestas contra el contrato; extras aditivos `DemoDataStatus.errorCode`, `Me.memberships[].isDemo`, `Me.features.demoData`; `Workspace.isDemo` siempre presente (opcional en el schema por compatibilidad de harness). Eventos validados con Ajv strict en `demo-data.service.test.ts`.

## 6. UI

- [x] 6.1 Configuración del workspace (solo OWNER): "Cargar datos de demostración" con confirmación y progreso; "Limpiar datos de demostración" con confirmación explícita; oculto si `DEMO_DATA_ENABLED = false`
  - Nota: `apps/web/src/ui/DemoDataPanel.tsx` en `/configuracion` (ConfirmPanel `alertdialog`, progreso, oculto si `features.demoData=false`).
- [x] 6.2 Indicador persistente "Datos de demostración" en el layout y etiqueta en el selector de workspaces; estado `FAILED` con acción de limpiar; textos en español vía i18n (TC-IDENTITY-DEMO-004)
  - Nota: indicador `demo-indicator` en `AppFrame` (no descartable) y etiqueta "(demostración)" en el selector; textos es/en/pt.

## 7. TESTS automatizados y E2E

- [x] 7.1 Test de integración extremo a extremo: cargar → verificar golden e invariantes → limpiar → purgar → 0 filas (TC-IDENTITY-DEMO-007, -010, -011, -013)
  - Nota: `apps/api/test/demo/demo-data.int.test.ts` (API + worker reales).
- [x] 7.2 E2E Playwright: el OWNER carga la demo desde la configuración, ve el indicador y el Home con datos, limpia y el workspace desaparece; el workspace real no cambia (TC-IDENTITY-DEMO-001, -003, -004, -014)
  - Nota: `tests/e2e/specs/demo-data.spec.ts` y `/configuracion` agregado a `a11y.spec.ts`.
- [x] 7.3 `pnpm db:seed -- --profile=demo` reutiliza el cargador (solo local/CI); test de `run-seed` actualizado
  - Nota: `seed-demo.int.test.ts`; rechazado con `DEMO_DATA_ENABLED=false`.

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/29 (perfil demo vía app), docs/08 (columnas y tablas nuevas), docs/10 §9.1 (códigos), docs/12 (función de purga y amend de `forbid_mutation`), docs/11 (eventos), docs/26 (nuevo RISK de purga física) y docs/19 (guion de demo); registrar en ADR-0026 (Aceptado 2026-10-04, docs/31 D41) el resultado de la revisión de seguridad
  - Nota: docs/08, /10 §9.1, /11, /12 §5.1 (tabla PF001–PF006), /19, /26 (RISK-026), /29 y ADR-0026 (resultado de la revisión de seguridad) actualizados; threat model en design.md.
- [x] 8.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
  - Nota: TC-IDENTITY-DEMO-001..014 `automated`; `pnpm spec:validate` y `pnpm traceability:check` OK. La matriz (`pnpm traceability:matrix`) se regenera en el cierre del change.
