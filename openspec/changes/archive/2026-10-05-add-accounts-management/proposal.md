# Propuesta: add-accounts-management

## Why

Ninguna funcionalidad financiera de Phase 1 (gastos, transferencias, conversiones USDT↔BOB↔USD, dashboard) puede existir sin cuentas. El usuario necesita registrar sus bancos, efectivo, billeteras, tarjetas, préstamos y billeteras cripto —cada una en una sola moneda—, cargar el saldo con el que entran al sistema y retirarlas sin perder historia. Este change implementa el contexto ACCOUNTS (FR-ACCOUNTS-001..016) respetando el modelo financiero canónico: el saldo nunca vive en la cuenta, se deriva del ledger (ARCHITECTURE §4.1), y el saldo inicial es un asiento de apertura creado por orquestación en la capa de composición (ARCHITECTURE §7, docs/06 §3.1). Es el change 3 del plan de Phase 1 (docs/03 §7).

## What Changes

- Agregado `Account` con los 11 tipos de docs/01, naturaleza derivada (activo/pasivo), moneda única habilitada, liquidez `LIQUID | SEMI_LIQUID | ILLIQUID` con default por tipo, inclusión en patrimonio neto, identificador enmascarado (últimos 4), icono, color, notas, etiquetas, red cripto opcional y orden manual.
- Ciclo de vida activa → cerrada (exige saldo cero) / archivada → reactivada; ninguna cuenta se borra. Cuentas archivadas o cerradas rechazan todo movimiento nuevo, incluidas reversas (INV-026).
- Apertura de cuenta con saldo inicial: unidad de trabajo en `apps/api` que invoca `Accounts.OpenAccount` y `Transactions.RecordOpeningBalance` (asiento `OPENING` contra `EQUITY:OPENING_BALANCE:<CCY>`), atómica e idempotente.
- Listado con saldo derivado del ledger, equivalente en moneda base con fecha/fuente de la tasa, filtros y agrupación.
- Agregado `Institution` configurable por workspace (sin catálogo hardcodeado; seed inicial opcional y editable), archivable, nunca eliminado.
- Tarjeta de crédito como cuenta de pasivo con saldo presentado como monto adeudado.
- Eventos `accounts.AccountOpened.v1`, `accounts.AccountArchived.v1`, `accounts.AccountReactivated.v1`, `accounts.AccountClosed.v1`, `accounts.AccountUpdated.v1` vía outbox; auditoría síncrona de toda mutación.
- **Fuera de alcance:** perfil de tarjeta de crédito (límite, corte, vencimiento, estados de cuenta — `debt/credit-cards`, Phase 4); préstamos con amortización (Phase 4); valoración de inversiones (Reporting, Phase 7); subida de logos de institución (Documents, Phase 6; aquí solo icono por identificador); tasas automáticas (Phase 5; aquí se usan tasas manuales de `add-manual-conversions`); transacciones de ajuste (`transactions/transaction-recording`); cuentas compartidas entre workspaces.

## Capabilities

### New Capabilities
- `accounts/account-management`: tipos y naturaleza, moneda, vínculo con el ledger, saldo inicial, saldo derivado, unicidad de nombre, enmascarado, liquidez, patrimonio neto, ciclo de vida (archivar/cerrar/reactivar), no eliminación, metadatos, listado y filtros, cripto, virtuales y orden manual (27 requirements: 23 Must, 3 Should, 1 Could).
- `accounts/institutions`: alta configurable, sin catálogo fijo, edición, archivo sin borrado, no asignación de archivadas y nombre único (6 requirements: 4 Must, 2 Should).

### Modified Capabilities
- Ninguna (las reglas que este change exige a otros contextos —INV-026 en Transactions/Ledger, asiento `OPENING`— se especifican en sus propios changes; ver design.md §Dependencias).

## Impact

**Specs impactadas:** crea `accounts/account-management` y `accounts/institutions`.

**Componentes/contextos impactados:** nuevo paquete `@pf/accounts` (domain, application, infrastructure, interface, contracts); `apps/api` (orquestación `OpenAccountWithOpeningBalance` en una unidad de trabajo); `@pf/transactions` (consume `AccountsQueryPort` para validar estado/moneda — INV-026; expone `RecordOpeningBalance`); `@pf/ledger` (get-or-create del ledger account de la cuenta al primer posting); `@pf/audit` (`AuditPort`); `@pf/fx` (lectura de tasas para el equivalente en moneda base); `@pf/classification` (validación de tagIds); `apps/web` (pantallas Cuentas e Instituciones); `seeds/minimal` y `seeds/demo`.

**APIs impactadas:** `listAccounts`, `createAccount`, `getAccount`, `updateAccount`, `archiveAccount` cambian; `unarchiveAccount` se reemplaza por `reactivateAccount`; nueva `closeAccount`; `listInstitutions`, `createInstitution`, `getInstitution`, `updateInstitution`, `archiveInstitution` cambian; enums `AccountType` e `InstitutionKind` reemplazados; nuevos schemas y 4 códigos de error. Detalle exacto en design.md §Contratos.

**Tablas impactadas:** `accounts.institution`, `accounts.account`, `accounts.account_tag` (nuevas); lectura de `ledger.*` vía queries públicas de Ledger; `audit.audit_log` y `platform.outbox_event`/`platform.idempotency_key` (escritura vía puertos).

**Eventos impactados:** `accounts.AccountOpened.v1` (schema modificado antes de su primera publicación: enum de `type` y campo `liquidity`), `accounts.AccountArchived.v1` (sin cambios), nuevos `accounts.AccountReactivated.v1`, `accounts.AccountClosed.v1`, `accounts.AccountUpdated.v1`.

**Migraciones requeridas:** expand-only: crear schema `accounts` y sus tablas con RLS WS, índices únicos parciales y checks. No destructiva.

**Test cases:** AÑADIDOS — TC-ACCOUNTS-TYPES-001, TC-ACCOUNTS-TYPES-002, TC-ACCOUNTS-CURRENCY-002, TC-ACCOUNTS-OPENING-001, TC-ACCOUNTS-OPENING-002, TC-ACCOUNTS-OPENING-003, TC-ACCOUNTS-BALANCE-001, TC-ACCOUNTS-NAME-001, TC-ACCOUNTS-MASK-001, TC-ACCOUNTS-INSTLINK-001, TC-ACCOUNTS-LIQUIDITY-001, TC-ACCOUNTS-NETWORTH-001, TC-ACCOUNTS-ARCHIVE-001, TC-ACCOUNTS-ARCHIVE-002, TC-ACCOUNTS-ARCHIVE-003, TC-ACCOUNTS-CLOSE-001, TC-ACCOUNTS-NODELETE-001, TC-ACCOUNTS-METADATA-001, TC-ACCOUNTS-LIST-001, TC-ACCOUNTS-LIST-002, TC-ACCOUNTS-CRYPTO-001, TC-ACCOUNTS-INSTITUTION-001, TC-ACCOUNTS-INSTITUTION-002, TC-ACCOUNTS-INSTITUTION-003, TC-ACCOUNTS-INSTITUTION-004. MODIFICADOS — TC-ACCOUNTS-CREDITCARD-001 (requirement confirmado), TC-ACCOUNTS-CURRENCY-001 (requirement renombrado a "Una sola moneda por cuenta" confirmado; `error_code` `ACCOUNT_CURRENCY_MISMATCH` → `CURRENCY_MISMATCH` del catálogo docs/10 §9.1), TC-ACCOUNTS-LEDGERLINK-001 (tipos de docs/01; vínculo get-or-create al primer movimiento; la inmutabilidad de moneda pasa a TC-ACCOUNTS-CURRENCY-002). DEPRECADOS — ninguno.

**Impacto de regresión:** ninguno sobre comportamiento implementado. Los TC críticos (CREDITCARD-001, CURRENCY-001, OPENING-001/002/003, ARCHIVE-002, CLOSE-001) entran a la Financial Regression Suite.

**Riesgos introducidos:** divergencia de enums de tipo de cuenta entre docs (docs/01 vs docs/04/08/OpenAPI/evento) — resuelta aquí a favor de docs/01 y pendiente de consolidar en contratos/docs; acoplamiento de orden de aplicación con `add-ledger-core` y `add-transaction-recording` para el saldo inicial. Invariantes afectadas: **INV-026** (cuentas archivadas/cerradas), **INV-006** (moneda de cuenta = moneda de su ledger account), **INV-004** (asiento de apertura balanceado por moneda), **INV-003** (escala del saldo inicial), **INV-009** y **INV-030** (tarjeta como pasivo, pago como transferencia), **INV-022** (saldo = Σ postings), **INV-027** (apertura idempotente), **INV-029** (auditoría atómica), **INV-025** (aislamiento de workspace).
