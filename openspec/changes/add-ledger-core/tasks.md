# Tareas

> DESIGN GATE aprobado el 2026-10-01 (docs/DESIGN-GATE.md). Requiere `bootstrap-platform-foundation` aplicado. La lógica de dinero y de validación de asientos se implementa **test-first (TDD)**: primero el test rojo nombrado con su TC-id, luego el código.

## 1. Spec y test cases (SPEC → TEST CASE)

- [x] 1.1 Revisar `specs/ledger/journal-posting/spec.md` y `specs/ledger/balances/spec.md` contra docs/09 §16; verificar que todo requirement Must tiene ≥ 1 TC no deprecado en `tests/cases/ledger/`
- [x] 1.2 Confirmar los TC modificados (requirement exacto, `requirement_status: confirmed`, `status: ready`) y los TC añadidos listados en proposal.md; verificar que el chequeo de catálogo de `scripts/traceability` los acepta y que todos los ejemplos numéricos suman cero por moneda
- [ ] 1.3 Consolidar en `contracts/` los cambios listados en design.md → Contratos (vía el proceso de consolidación); verificar con Spectral que los nuevos `ErrorCode` y la operación `getLedgerTrialBalance` pasan el ruleset
  > Pendiente (2026-10-03): según design.md los cambios de contrato se consolidaron el 2026-10-02 (los `ErrorCode` del ledger ya están en `finance-api.v1.yaml`); falta verificar con Spectral `getLedgerTrialBalance`, ligado a 6.3.
  > Verificado 2026-10-04 (parcial): los `ErrorCode` del ledger y `getLedgerTrialBalance` (con `TrialBalance`) están en el OpenAPI y Spectral corre en `pr.yml`. Falta: el contrato declara `x-required-role: VIEWER` para `getLedgerTrialBalance`, pero la tarea 6.3 y TC-LEDGER-TRIAL-001 dicen solo `OWNER` — corregir uno de los dos.

## 2. Dinero en el shared-kernel (DOMAIN, TDD)

- [x] 2.1 TDD: promover `Money`, `MoneyDecimal`, `Currency`, `Rate` y `rounding` desde `spikes/SPIKE-03-money/src` a `packages/shared-kernel/src/money`, migrando primero sus tests `[TC-LEDGER-MONEY-001]`, `[TC-LEDGER-MONEY-007]`, `[TC-LEDGER-MONEY-008]`; verificar que pasan y que `pnpm typecheck` valida los `@ts-expect-error` de TC-001
- [x] 2.2 TDD: rechazo de escala excedida con `AMOUNT_SCALE_EXCEEDED` (unificado; reemplaza `MONEY_SCALE_EXCEEDED` del spike) y rango con `AMOUNT_OUT_OF_RANGE`; tests `[TC-LEDGER-SCALE-001]`
- [x] 2.3 TDD: redondeo HALF_EVEN con cuantización racional exacta (H3) y reparto por mayor residuo truncando hacia cero (H5); tests `[TC-LEDGER-MONEY-003]`, `[TC-LEDGER-MONEY-005]` y propiedades `[TC-LEDGER-MONEY-004]`, `[TC-LEDGER-MONEY-006]` (100 runs en PR, 10 000 nightly)
- [x] 2.4 Mover la regla `pf/no-number-money` y `no-restricted-imports` del `Decimal` global a `packages/eslint-config`; verificar que el fixture malo falla y el bueno pasa (TC-PLATFORM-ARCH-002)
  > Hecho (2026-10-03): `@pf/eslint-config` (`packages/eslint-config`) con `pf/no-number-money` (capa sintáctica: `number` en nombres monetarios, `parseFloat`/`Number`/`+x` sobre montos, literales en `Money.of`, `toFixed(n)`/`toNumber()`) y `no-restricted-imports` de `decimal.js`, aplicado a todo el monorepo desde `eslint.config.js` (excepción: `packages/shared-kernel/src/money/**`, dueño de `MoneyDecimal`). `fixtures/bad.ts` falla y `fixtures/good.ts` pasa en `src/no-number-money.test.ts` (RuleTester + ESLint). Ver design.md → Registro 2026-10-03 (hardening).
- [x] 2.5 Verificar cobertura del shared-kernel ≥ 95 % líneas / 90 % ramas y mutation score ≥ 80 % (Stryker) en Money/rounding/allocation (NFR-MAINT-002)
  > Pendiente: no se ejecutó Stryker ni cobertura en esta sesión (`stryker.config.json` ya incluye `src/money/**`).
  > Verificado 2026-10-04 (pendiente, CI): existe `packages/shared-kernel/stryker.config.json` (umbral break 80) y el script `test:mutation`, pero no hay umbrales de cobertura 95/90 ni proveedor de coverage, y ningún job de CI ejecuta Stryker ni coverage.
  > Hecho 2026-10-04 (ci/nightly-perf): `@vitest/coverage-v8` + umbrales `lines: 95` / `branches: 90` en `packages/shared-kernel/vitest.config.ts` (`pnpm --filter @pf/shared-kernel run test:coverage`) y Stryker 10 con `break: 80`; ambos corren en el job `mutation` de `.github/workflows/nightly.yml`. Medido localmente: líneas **98.05 %**, ramas **91.49 %**; mutation score **83.26 %** (592/711; `money/` 83.81 %, `rounding.ts` 84.51 %, `money.ts` 85.99 %, `rate.ts` 72.13 % como el más débil). Pendiente: primera corrida en GitHub tras el merge.

## 3. Dominio del ledger (DOMAIN, TDD)

- [x] 3.1 TDD: AR `LedgerAccount` (naturaleza y moneda inmutables) y VO `LedgerAccountCode`; tests `[TC-LEDGER-CHART-001]`
- [x] 3.2 TDD: AR `JournalEntry` + `EntryValidator` con el orden de validación de design.md §Decisiones 2; tests `[TC-LEDGER-BALANCE-001]`, `[TC-LEDGER-STRUCTURE-001]`, `[TC-LEDGER-CURRENCY-001]`, `[TC-LEDGER-SPLITREF-001]`, `[TC-LEDGER-SIGN-001]`
- [x] 3.3 TDD: `ReversalFactory` (negación exacta, rechazo de revertir un `REVERSAL`); tests `[TC-LEDGER-REVERSAL-001]`, `[TC-LEDGER-REVERSAL-002]` (parte de dominio) y propiedad `[TC-LEDGER-REVERSAL-003]`
- [x] 3.4 TDD: chequeo de periodo bloqueado en dominio y `BalanceCalculator` (saldo contable y presentado por naturaleza); tests `[TC-LEDGER-PERIOD-001]` (dominio), `[TC-LEDGER-BALANCES-004]`
- [x] 3.5 Propiedades de ledger en memoria: `[TC-LEDGER-BALANCE-003]` (balance de comprobación en cero tras cada paso) y `[TC-LEDGER-VALUATION-001]` (identidad de valoración con tasas aleatorias, precisión 40)

## 4. Casos de uso (APPLICATION)

- [x] 4.1 `PostJournalEntry` con `LedgerAccountResolver` (get-or-create de cuentas de usuario y de sistema), idempotencia por `sourceRef` y escritura de `ledger.JournalEntryPosted.v1` en el outbox; tests de aplicación con fakes `[TC-LEDGER-METADATA-001]`, `[TC-LEDGER-OPENING-001]`, `[TC-LEDGER-TRANSFER-001]`
- [x] 4.2 `ReverseJournalEntry(entryId, reverseDate, reason)` validando periodo abierto y reversa única
- [x] 4.3 `LedgerPeriodLockPort` (`lockPeriod`, `unlockPeriod`, idempotentes) para uso de Planning en Phase 2; verificar con `[TC-LEDGER-PERIOD-001]` usando el puerto directamente
- [x] 4.4 `BalanceQuery` (`GetBalance`, `GetBalances` agrupado por moneda, `GetTrialBalance`, `GetEntriesBySource`); tests `[TC-LEDGER-BALANCES-005]` (el saldo contable ignora pendientes)
  > Hecho (2026-10-03): saldo "actual" por defecto = hoy en la zona horaria del workspace (`Clock`), TC-LEDGER-BALANCES-002 completo y TC-LEDGER-BALANCES-005 en `test/integration/ledger-maintenance.int.test.ts`.
- [x] 4.5 Comandos internos `RebuildBalanceSnapshots` y `VerifyLedgerIntegrity` con `MetricsPort` y log estructurado
  > Hecho (2026-10-03): `application/ledger-maintenance.ts` (puertos `LedgerMaintenanceRepository`, `MetricsPort`, `LedgerLogPort`), `infrastructure/pg-ledger-maintenance.ts` y `createLedgerMaintenance`; métricas `ledger_invariant_violations_total{invariant}` y `ledger_balance_snapshots_rebuilt_total`; tests unitarios en `ledger-maintenance.test.ts`.

## 5. Persistencia (INFRASTRUCTURE)

- [x] 5.1 Migraciones dbmate en `db/migrations/ledger/` según design.md → Plan de migración (tablas, FKs compuestas, triggers PF001/PF003/PF004/PF005, RLS ENABLE+FORCE, grants); verificar con el test de migraciones sobre PG vacío
- [x] 5.2 Repositorios Kysely append-only sobre la Unit of Work (`Transaction<DB>` con `SET LOCAL app.workspace_id`) y type parser de `NUMERIC` → string; tests `[TC-LEDGER-MONEY-002]`, `[TC-LEDGER-IDEMPOTENCY-001]`, `[TC-LEDGER-CHART-002]`, `[TC-LEDGER-CHART-003]` (incluye concurrencia)
- [x] 5.3 Tests de base de datos con rol `pf_app`: `[TC-LEDGER-BALANCE-002]`, `[TC-LEDGER-STRUCTURE-002]`, `[TC-LEDGER-IMMUTABILITY-001]`, `[TC-LEDGER-PERIOD-002]`, `[TC-LEDGER-REVERSAL-002]` (PK de `entry_reversal` bajo concurrencia), `[TC-LEDGER-ISOLATION-001]`
- [x] 5.4 Mapeo de SQLSTATE (`PF001/PF004/PF005` → `DomainError`; `PF002/PF003/42501` → `INTERNAL_ERROR` + métrica); verificar con tests de integración que el código llega íntegro
- [ ] 5.5 Consultas de saldo con el índice `INCLUDE (amount)` y snapshots (`balance_snapshot`, worker); tests `[TC-LEDGER-BALANCES-001]`, `[TC-LEDGER-BALANCES-002]`, `[TC-LEDGER-BALANCES-003]`, `[TC-LEDGER-SNAPSHOT-001]`; medir p95 ≤ 50 ms por cuenta (NFR-PERF-005) y overhead de RLS < 10 % con `EXPLAIN ANALYZE`
  > Parcial (2026-10-03): lectura = snapshot vigente + Σ postings posteriores (descarta en la misma consulta los snapshots invalidados por asientos retroactivos); TC-LEDGER-BALANCES-001/002 y SNAPSHOT-001 automatizados. Falta medir p95 y el overhead de RLS (sin dataset `large` en esta sesión).
  > Verificado 2026-10-04 (parcial): tests `[TC-LEDGER-BALANCES-001]`, `-002`, `[TC-LEDGER-SNAPSHOT-001]` (`ledger-maintenance.int.test.ts`) y `[TC-LEDGER-BALANCES-003]` (`pg-ledger.int.test.ts`). Falta: medir p95 ≤ 50 ms (NFR-PERF-005) y el overhead de RLS con `EXPLAIN ANALYZE` (no hay benchmark).
  > Medido 2026-10-04 (ci/nightly-perf, job nightly `perf`; Medido en local 2026-10-04 (`pnpm perf:bench`, Large Seed completo: 97 374 transacciones / 200 617 postings en el principal + 20 satélites; Windows 11 + Docker Desktop, PostgreSQL 18 por Testcontainers; tiempos de ida y vuelta HTTP en el mismo host)): saldo **por cuenta** p95 **4.43 ms** con el snapshot del job diario y 4.12 ms sin snapshots (Index Only Scan `posting_balance_ix`) ≤ 50 ms ✔; **todas las cuentas** (`getAccountBalances`, 24 cuentas) p95 **259 ms > 150 ms** ✘. Causa (EXPLAIN ANALYZE): el `NOT EXISTS` que invalida snapshots se planifica con `journal_entry_date_ix` y recorre todos los asientos con `entry_date ≤ as_of_date` filtrando `sequence > last_sequence`, una vez por cada ledger account (37 en el principal), en vez de usar `journal_entry_sequence_ix`; además `getAccountBalances` calcula también las cuentas de sistema y filtra en memoria. Overhead de RLS (EXPLAIN ANALYZE `pf_app` vs superusuario, medianas): saldo por cuenta +0.48 ms (1.56 vs 1.08 ms, 44 %, bajo el piso de ruido de 0.5 ms), página de transacciones +0.01 ms, agregado de todo el workspace +3.6 ms (22.06 vs 18.43 ms, **19.7 % > 10 %**, Seq Scan con el predicado `platform.current_workspace_id()` por fila). Sigue abierta hasta corregir la consulta de saldos en lote y decidir el criterio de RLS.
- [x] 5.6 Job diario del verificador de invariantes en el worker y enganche en `restore:local`; test `[TC-LEDGER-INTEGRITY-001]`
  > Hecho (2026-10-03): cola `ledger.daily-maintenance` (pg-boss cron `LEDGER_INTEGRITY_CRON`/`LEDGER_INTEGRITY_CRON_TZ`, default `0 4 * * *` UTC; `off` lo desactiva) que ejecuta `VerifyLedgerIntegrity` y luego `RebuildBalanceSnapshots`; también se encola al arrancar el worker, de modo que `restore:local` (que reinicia finance-worker) verifica el ledger restaurado. TC-LEDGER-INTEGRITY-001 automatizado.

## 6. Contratos de API y eventos (API)

- [x] 6.1 Test de contrato de `ledger.JournalEntryPosted.v1` contra `contracts/events/ledger/JournalEntryPosted.v1.schema.json` + Σ por moneda = 0 + escala canónica; test `[TC-LEDGER-EVENT-001]`
- [x] 6.2 Mapeo de los nuevos códigos de error a problem+json (status según design.md → Contratos); verificar con tests de API
- [ ] 6.3 (Could) Endpoint `GET /api/v1/workspaces/{workspaceId}/ledger/trial-balance` solo `OWNER`; test `[TC-LEDGER-TRIAL-001]`
  > Pendiente (Could): endpoint técnico trial-balance (TC-LEDGER-TRIAL-001).
  > Verificado 2026-10-04 (pendiente, código): solo existen la consulta `getTrialBalance` (`pg-balance.queries.ts`) y la operación del contrato; no hay ruta HTTP `/ledger/trial-balance` ni test `[TC-LEDGER-TRIAL-001]`.
  > Nota 2026-10-04: no se implementa — pendiente de decisión del owner (rol). El contrato declara `getLedgerTrialBalance` con `x-required-role: VIEWER`, mientras la tarea, design.md (decisión 13) y TC-LEDGER-TRIAL-001 dicen solo `OWNER`; cambiar el rol del contrato no sería aditivo y no hay decisión en docs/31.

## 7. UI

- [x] 7.1 Sin UI de usuario (el ledger es invisible). Verificar que ningún componente de `apps/web` muestra débitos/créditos ni códigos de cuentas contables

## 8. Tests automatizados, regresión y E2E

- [x] 8.1 Marcar los TC críticos en la Financial Regression Suite y verificar que corren en cada PR (unit/PBT/integración) y nightly (10 000 runs)
  > Parcial: los TC del ledger con `regression_suite: true` corren en cada PR (unit/PBT con 100 corridas y semilla fija; integración en `pnpm test:integration`); `NIGHTLY=1` sube a 10 000 corridas (verificado localmente). Falta el job nightly en CI.
  > Verificado 2026-10-04 (parcial): unit, PBT e integración corren en cada PR (`pr.yml`) y `NIGHTLY=1` sube los PBT a 10 000 runs. Falta: workflow nightly (no hay `schedule`) y una selección explícita de la Financial Regression Suite (hoy solo el flag `regression_suite`).
  > Hecho 2026-10-04 (ci/nightly-perf): `pnpm traceability:regression` deriva la suite del front matter (168 TC, 158 con tests; `tests/traceability/regression-suite.{json,md}`), el job `traceability` del PR la publica como artefacto y el job nightly `regression` la ejecuta agrupada (`--run`, unit + integración filtrados por TC-ID) con `NIGHTLY=1`. Corrida local con `NIGHTLY=1`: 23 grupos en verde (14 unit + 9 integración, ~3.5 min); los TC del ledger: 16 unit/PBT + 14 integración. Pendiente: primera corrida programada en GitHub tras el merge.
- [x] 8.2 E2E: cubierto por los slices consumidores (`add-accounts-management`, `add-transaction-recording`); aquí solo un smoke de integración que postea y revierte un asiento de 120.00 BOB y verifica saldo 1000.00 BOB y evento publicado

## 9. Documentación y cierre

- [ ] 9.1 Reportar al owner las correcciones de docs detectadas (PF002 duplicado en docs/08, FR-ACCOUNTS-003 vs get-or-create de docs/09 §2.2, prioridades FR-LEDGER-014/015 vs NFR-DATA-008/009, FR erróneos en TC previos) y actualizar docs/09/docs/08 cuando el owner lo apruebe
  > Pendiente de aprobación del owner: ver design.md → "Registro de implementación (2026-10-03)".
- [ ] 9.2 Actualizar `automation_status`/`status` de los TC, regenerar `tests/traceability/matrix.{md,json}` y ejecutar `openspec validate add-ledger-core --strict --no-interactive`
  > Parcial (2026-10-03): TC-LEDGER-BALANCES-001/002/005, SNAPSHOT-001 e INTEGRITY-001 y TC-PLATFORM-ARCH-002 marcados automatizados; queda TC-LEDGER-TRIAL-001 (6.3, Could).