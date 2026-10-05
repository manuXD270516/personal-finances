# Tareas

> DESIGN GATE aprobado el 2026-10-01 (docs/DESIGN-GATE.md). Requiere `add-workspace-identity`, `add-api-conventions` y `add-audit-trail` aplicados. El grupo 6 requiere además `add-ledger-core` y `add-transaction-recording`.

## 1. Spec y test cases (SPEC → TEST CASE)

- [x] 1.1 Revisar con el owner `specs/accounts/account-management/spec.md` y `specs/accounts/institutions/spec.md` (en especial tipos de docs/01 y defaults de liquidez); verificar con `openspec validate add-accounts-management --strict --no-interactive`
  > Verificado 2026-10-04: las preguntas abiertas de design.md quedan resueltas por decisiones de docs/31 — tipos de cuenta D3, estados D4, liquidez (enum y defaults) D5, get-or-create del ledger account (FR-ACCOUNTS-003) D6, cuentas archivadas fuera del resumen del dashboard y liquidez = solo `ASSET` + `LIQUID` (los pasivos quedan fuera del eje de liquidez) D35; `openspec validate add-accounts-management --strict` en verde.
- [x] 1.2 Confirmar los TC de `tests/cases/accounts/` listados en proposal.md con `status: ready` y cobertura ≥ 1 TC por requirement Must; verificar con el chequeo del catálogo
  > Verificado 2026-10-04: los 28 TC de proposal.md existen en `tests/cases/accounts/` con `status` `ready` o `automated` (ninguno `draft`); los 27 requirements Must tienen ≥ 1 TC (los 5 sin TC son Should/Could); `pnpm traceability:check` (R2) en verde.

## 2. Instituciones (`accounts/institutions`)

- [x] 2.1 Dominio TDD: `Institution`, `InstitutionKind`, validación de país ISO; tests `[TC-ACCOUNTS-INSTITUTION-001]`
- [x] 2.2 Aplicación: `CreateInstitution`, `UpdateInstitution`, `ArchiveInstitution`, `ListInstitutions` con `AuditPort`; tests `[TC-ACCOUNTS-INSTITUTION-003]`, `[TC-ACCOUNTS-INSTITUTION-004]`
- [x] 2.3 Infraestructura: migración `accounts.institution` (RLS WS, único parcial por nombre, sin DELETE) y repositorio Kysely; test de integración de aislamiento y `NAME_TAKEN`
- [x] 2.4 Seed de catálogo inicial ficticio por workspace (nunca en migraciones ni en código); verificar con `[TC-ACCOUNTS-INSTITUTION-002]`
  > Verificado 2026-10-04 (pendiente, código): no existe seed de instituciones ficticias por workspace (`apps/api/src/seed/run-seed.ts` y la provisión del workspace solo siembran Classification y FX). `[TC-ACCOUNTS-INSTITUTION-002]` (`pg-accounts.int.test.ts`) cubre aislamiento y ausencia de filas globales insertando la institución a mano; el TC pasó a `automated`.
  > Hecho (2026-10-04): catálogo inicial ficticio por workspace como archivo de seed (`apps/api/src/seed/minimal/institutions.json`: Banco Andino Demo, Cooperativa Illimani Demo, Billetera Altiplano Demo, P2P Exchange Demo) cargado por `seedInstitutionCatalog` (`apps/api/src/seed/institution-catalog.ts`) en W1 y W2 con la Minimal Seed v4: filas normales del workspace bajo RLS, una sola vez (re-ejecutar la seed no restaura lo renombrado/archivado), nunca en migraciones ni en el código de dominio/aplicación. La carga al crear un workspace "si el owner lo pide" (design §8) requeriría un campo nuevo en el contrato y queda fuera. Verificado con `[TC-ACCOUNTS-INSTITUTION-002]` (`apps/api/test/db/institution-catalog.int.test.ts`).
- [x] 2.5 API `institutions` según design.md §Contratos; tests de API y de contrato

## 3. Dominio de cuentas (`@pf/accounts/domain`)

- [x] 3.1 TDD: `AccountType` → `AccountNature` y `Liquidity.defaultFor(type)`; tests `[TC-ACCOUNTS-TYPES-001]`, `[TC-ACCOUNTS-LIQUIDITY-001]`
- [x] 3.2 TDD: inmutabilidad de tipo, cambio de moneda solo sin movimientos; tests `[TC-ACCOUNTS-TYPES-002]`, `[TC-ACCOUNTS-CURRENCY-002]`
- [x] 3.3 TDD: transiciones ACTIVE/CLOSED/ARCHIVED (cerrar exige saldo cero, reactivar, transiciones inválidas); tests `[TC-ACCOUNTS-CLOSE-001]`, `[TC-ACCOUNTS-ARCHIVE-001]`, `[TC-ACCOUNTS-ARCHIVE-003]`
- [x] 3.4 TDD: `MaskedAccountNumber` y regla cripto (moneda `CRYPTO`, escala); tests `[TC-ACCOUNTS-MASK-001]`, `[TC-ACCOUNTS-CRYPTO-001]`

## 4. Aplicación de cuentas

- [x] 4.1 `OpenAccount` (sin saldo inicial), `UpdateAccount`, `ArchiveAccount`, `CloseAccount`, `ReactivateAccount`, `ReorderAccounts` con `AuditPort` + outbox en la `UnitOfWork`; tests `[TC-ACCOUNTS-NAME-001]`, `[TC-ACCOUNTS-INSTLINK-001]`, `[TC-ACCOUNTS-METADATA-001]`
- [x] 4.2 `AccountsQueryPort.getPostingEligibility` (estado, moneda, naturaleza) con bloqueo `FOR SHARE`; tests de aplicación para INV-026 `[TC-ACCOUNTS-ARCHIVE-002]` (con un poster de prueba hasta que exista Transactions)
- [x] 4.3 Queries `GetAccount`, `ListAccounts` (filtros, `groupBy`, orden manual) con `LedgerBalancesPort` y `FxRateQueryPort` simulados; tests `[TC-ACCOUNTS-LIST-001]`, `[TC-ACCOUNTS-LIST-002]`

## 5. Infraestructura y API de cuentas

- [x] 5.1 Migración `accounts.account` y `accounts.account_tag` (checks de tipo/naturaleza/liquidez, únicos parciales, FKs compuestas, RLS WS, grants sin DELETE en `account`); verificar con test de migración y `[TC-ACCOUNTS-NODELETE-001]`
- [x] 5.2 Repositorios Kysely con optimistic locking (`version`) y mapeo de violaciones únicas a `ACCOUNT_NAME_TAKEN`
- [x] 5.3 Esquemas de eventos `AccountOpened.v1` (corregido), `AccountClosed.v1`, `AccountReactivated.v1`, `AccountUpdated.v1` consolidados en `contracts/events/` (proceso de contratos); tests de contrato de eventos con los payloads emitidos
- [x] 5.4 Controllers `accounts` (`list/get/create/update/archive/close/reactivate/order`) con `x-required-role`, ETag/If-Match e `Idempotency-Key`; tests de API y test de contrato contra el OpenAPI consolidado

## 6. Apertura con saldo inicial y saldos (tras add-ledger-core y add-transaction-recording)

- [x] 6.1 TDD en `apps/api`: `OpenAccountWithOpeningBalance` (unidad de trabajo, idempotencia, `RecordOpeningBalance`, signo de pasivos); tests `[TC-ACCOUNTS-OPENING-001]` con montos de docs/09 §6.7 y 100.000000 USDT
- [x] 6.2 Atomicidad e idempotencia con Testcontainers: `[TC-ACCOUNTS-OPENING-002]` (escala inválida ⇒ nada persistido), `[TC-ACCOUNTS-OPENING-003]` (reintento ⇒ una cuenta, un asiento)
- [x] 6.3 Integración real con Ledger: `[TC-ACCOUNTS-LEDGERLINK-001]`, `[TC-ACCOUNTS-BALANCE-001]`, `[TC-ACCOUNTS-CURRENCY-001]`, `[TC-ACCOUNTS-ARCHIVE-002]` contra Transactions real (incluye anulación ⇒ `ACCOUNT_ARCHIVED`)
  > Verificado 2026-10-04 (parcial): LEDGERLINK-001 con API real (`accounts.api.test.ts`) + get-or-create concurrente en `[TC-LEDGER-CHART-002]`; anulación ⇒ `ACCOUNT_ARCHIVED` cubierta en Transactions (`[TC-TRANSACTIONS-ARCHIVED-001]`, en memoria). Falta: `[TC-ACCOUNTS-BALANCE-001]` (sin test) y `[TC-ACCOUNTS-CURRENCY-001]`/`[TC-ACCOUNTS-ARCHIVE-002]` contra Transactions real (hoy con poster de prueba).
  > Hecho (2026-10-04): `apps/api/test/api/accounts-ledger.api.test.ts` contra Ledger y Transactions reales: `[TC-ACCOUNTS-BALANCE-001]` (925.00 BOB = Σ postings; PATCH de `balance` ⇒ `VALIDATION_FAILED` sin asientos), `[TC-ACCOUNTS-CURRENCY-001]` (gasto en BOB sobre USD Savings ⇒ `CURRENCY_MISMATCH` sin transacción, asiento, auditoría ni outbox) y `[TC-ACCOUNTS-ARCHIVE-002]` (gasto, anulación de T9, ingreso en cerrada y transferencia hacia archivada rechazados sin escribir nada; carrera archivo ↔ gasto). Bug corregido: el 201 de `createAccount` devolvía `createdAt` 1970-01-01 (la cuenta no se releía tras el insert); regresión en el mismo archivo. Divergencia anotada en el TC: "EUR no habilitada" no se puede reproducir (EUR activa en el catálogo global y sin habilitación por workspace en Phase 1); se usa un código inexistente.
  > Actualizado 2026-10-05 (docs/31 D45): la moneda de una cuenta debe estar habilitada en el workspace (`fx.workspace_currency` vía `FxValuationPort.enabledCurrencies` de `@pf/fx/contracts`) al abrirla y al cambiarla; `[TC-ACCOUNTS-CURRENCY-001]` vuelve a la precondición original (EUR activa pero no habilitada ⇒ `CURRENCY_NOT_ENABLED` en `/currency`, sin escribir nada) en API (`accounts-ledger.api.test.ts`) y aplicación; el formulario web solo ofrece monedas habilitadas (`accountCurrencyOptions`). Seed `large` y demo habilitan BTC con `FxService.enableCurrencies` antes de abrir sus cuentas; los tests de API que abren cuentas BTC/TRX la habilitan primero.
- [x] 6.4 Con `add-transfers` y `add-basic-dashboard`: `[TC-ACCOUNTS-CREDITCARD-001]`, `[TC-ACCOUNTS-NETWORTH-001]` y liquidez en el resumen
  - Nota (2026-10-03): cubierto por E2E: `tests/e2e/specs/transfers.spec.ts` (tarjeta: compra, pago y patrimonio, TC-ACCOUNTS-CREDITCARD-001) y `tests/e2e/specs/accounts.spec.ts` (cuenta excluida del patrimonio, TC-ACCOUNTS-NETWORTH-001; liquidez en "¿Cuánto dinero tengo?", TC-ACCOUNTS-LIQUIDITY-001); corrido localmente contra el stack desechable `pfos-e2e*` (perfil core, Minimal Seed, `FX_PROVIDER_* = none`).

## 7. UI

- [x] 7.1 Pantalla Cuentas: listado agrupable/filtrable con saldo, equivalente BOB (fecha/fuente de tasa o "sin tasa"), pasivos como "adeuda", archivadas ocultas por defecto; textos vía i18n `es` (preparado `en`, `pt`); verificar con tests de componente
  - Nota (2026-10-03): `apps/web/src/ui/accounts/AccountsPage.tsx` + `AccountsListView.tsx` (ruta `/cuentas`): filtros por tipo, moneda, estado e institución, agrupación por tipo/institución, "mostrar archivadas"; tests de componente en `AccountsListView.test.tsx`. Textos en `messages/{es,en,pt}.json` (namespace `Accounts`).
- [x] 7.2 Formularios crear/editar cuenta (tipo inmutable al editar, recorte del identificador a 4 caracteres en el cliente, saldo inicial con validación de escala por moneda, liquidez con default por tipo); acciones archivar/cerrar/reactivar con confirmación; pestaña "Historial" de add-audit-trail
  - Nota (2026-10-03): `AccountForm.tsx` (alta `/cuentas/nueva` y edición con `If-Match`; el identificador se recorta a 4 caracteres al salir del campo y solo se envía `accountNumberLast4`), `AccountDetail.tsx` (`/cuentas/{id}`: archivar/cerrar/reactivar con confirmación `alertdialog` y pestaña Historial reutilizando `AuditHistory`).
- [x] 7.3 Pantalla Instituciones (crear/editar/archivar, icono/color); verificar con axe sin violaciones serias
  - Nota (2026-10-03): pantalla mínima hecha (`InstitutionsPage.tsx`, `/instituciones`: crear con icono/color, renombrar, archivar); falta la verificación con axe (el repo aún no tiene `@axe-core/playwright`).
  - Nota (2026-10-04): /instituciones (y /cuentas, /cuentas/nueva, detalle de cuenta) verificado con axe-core (`@axe-core/playwright`, WCAG 2.1 A/AA) en `tests/e2e/specs/a11y.spec.ts`: sin violaciones serious/critical (2026-10-04).

## 8. Tests automatizados y E2E

- [x] 8.1 Ejecutar en CI todos los tests nombrados con TC-ids de `tests/cases/accounts/` (unit, aplicación, integración Testcontainers, API, contrato); agregar los críticos a la Financial Regression Suite
  > Verificado 2026-10-04 (parcial): unit, integración (Testcontainers), API y E2E corren en `.github/workflows/pr.yml`. Falta: tests de TC-ACCOUNTS-BALANCE-001 y CURRENCY-001 (no automatizados) y un mecanismo que ejecute la Financial Regression Suite como grupo (hoy solo existe el flag `regression_suite`; no hay job nightly).
  > Nota 2026-10-04: BALANCE-001 y CURRENCY-001 ya tienen tests (6.3). Sigue pendiente el job que ejecute la Financial Regression Suite como grupo (lo lleva el agente de nightly/CI).
  > Actualización 2026-10-04 (ci/nightly-perf): el mecanismo existe (`pnpm traceability:regression --run`, job nightly `regression`; los TC de accounts de la suite corren: 6 unit + 2 integración en verde localmente). Sigue pendiente la automatización de TC-ACCOUNTS-BALANCE-001 y CURRENCY-001.
  > Cerrada 2026-10-04 (integración de ramas): BALANCE-001 y CURRENCY-001 automatizados (PR #37) y la suite corre como grupo en el job nightly `regression`.
- [x] 8.2 E2E Playwright: crear "Banco BOB" con 10000.00 BOB y "Visa BOB" adeudando 2000.00 BOB, ver patrimonio 8000.00 BOB, archivar y reactivar una cuenta; verificar contra Compose `core` con la Minimal Seed
  - Nota (2026-10-03): `tests/e2e/specs/accounts.spec.ts` (Banco BOB 10.000,00 + Visa BOB adeudando 2.000,00 ⇒ patrimonio 8.000,00 BOB en el Home; archivar y reactivar la Visa; identificador enmascarado; móvil 360 px); corrido localmente contra el stack desechable `pfos-e2e*` (perfil core, Minimal Seed, `FX_PROVIDER_* = none`).

## 9. Documentación y cierre

- [ ] 9.1 Actualizar docs/04 §3.2, docs/08 §5.2 (tipos, liquidez, sin `ledger_account_id`, `account_tag`), docs/10 §9.1 (códigos nuevos), docs/11 §3.2 (eventos nuevos) y docs/29 (tipos de la Minimal Seed); verificar enlaces
- [ ] 9.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict --no-interactive`; archivar el change
