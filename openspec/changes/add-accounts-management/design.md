# Diseño

## Contexto

Bounded context **ACCOUNTS** (`accounts`, paquete `@pf/accounts`, Core, Phase 1 — ARCHITECTURE §3). Fuentes: ARCHITECTURE §4.1 (cuenta ↔ un `LedgerAccount` ASSET/LIABILITY, atributo `liquidity`), §4.3 (tarjeta = LIABILITY, pago = transferencia), §7 (apertura con saldo inicial = orquestación en `apps/api`; ledger accounts get-or-create al postear; auditoría síncrona), §8 (API), §9 (UUIDv7, RLS, `version`, soft-archive); docs/01 §4 (FR-ACCOUNTS-001..016); docs/04 §3.2; docs/06 §3.1; docs/08 §5.2; docs/09 §6.7–6.8, INV-003/004/006/022/026/030; docs/10 §9.1, §13–14; docs/11 §3.2; docs/12 §13; docs/29 (Minimal Seed). ADRs: ADR-0002/0003, ADR-0004 (ledger), ADR-0006 (money), ADR-0007 (Kysely + dbmate), ADR-0008 (outbox), ADR-0022 (API), ADR-0023 (RLS).

**Resolución de inconsistencias entre documentos** (ver Preguntas abiertas): los tipos de cuenta y de institución siguen **docs/01** (FR-ACCOUNTS-001/012, fuente de requisitos) y la liquidez sigue **ARCHITECTURE §4.1** (enum de 3 valores; el flag `includeInLiquidity` de FR-ACCOUNTS-011 se modela como `liquidity = LIQUID`).

## Objetivos / No objetivos

**Objetivos:**
- Agregados `Account` e `Institution` con sus invariantes, comandos, queries, eventos y API.
- Orquestación atómica e idempotente de apertura con saldo inicial.
- `AccountsQueryPort` público para que Transactions aplique INV-026 y la regla de moneda.
- Seeds Minimal/Demo con las cuentas de docs/29 y un catálogo inicial opcional de instituciones ficticias.

**No objetivos:**
- Calcular saldos (lo hace Ledger: `GetBalances`), registrar transacciones (Transactions), pricing de tasas (FX), perfil de tarjeta (Debt, Phase 4).

## Decisiones

1. **Capas y piezas.**
   - *domain*: AR `Account` (`id, workspaceId, name, type, nature (derivada), currency, institutionId?, liquidity, includeInNetWorth, includeInBudget, status (ACTIVE|CLOSED|ARCHIVED derivado de closedOn/archivedAt), openedOn, closedOn?, archivedAt?, displayOrder, accountNumberLast4?, icon?, color?, notes?, tagIds[], cryptoNetwork?, version`); VO `AccountType` (11 valores docs/01), `AccountNature`, `Liquidity` con `defaultFor(type)`, `MaskedAccountNumber` (exactamente 4 caracteres `[A-Za-z0-9]`). AR `Institution` (`id, workspaceId, name, kind, countryCode?, icon?, color?, website?, notes?, archivedAt?, version`). Reglas de dominio: tipo inmutable; moneda modificable solo si `hasPostings == false` (dato provisto por la aplicación); cerrar exige `balance.isZero()`; no se cierra/archiva/reactiva dos veces (`INVALID_STATUS_TRANSITION`).
   - *application*: comandos `OpenAccount`, `UpdateAccount`, `ChangeAccountCurrency` (vía `updateAccount`), `ArchiveAccount`, `CloseAccount`, `ReactivateAccount`, `ReorderAccounts`, `CreateInstitution`, `UpdateInstitution`, `ArchiveInstitution`; queries `GetAccount`, `ListAccounts(filters, groupBy)`, `GetAccountsByIds`, `ListInstitutions`. Puertos: `AccountRepository`, `InstitutionRepository`, `CurrencyCatalog` (FX contracts: `kind`, `scale`, habilitada), `LedgerBalancesPort` (Ledger contracts: `GetBalances(accountIds, asOf)`, `HasPostings(accountId)`), `FxRateQueryPort` (FX contracts: última tasa ≤ hoy a moneda base con fecha y fuente), `TagCatalogPort` (Classification contracts), `AuditPort`, `OutboxPort`, `Clock`, `IdGenerator`.
   - *contracts* (API pública): `AccountsQueryPort.getPostingEligibility(accountIds) → {accountId, currency, nature, status}` usado por Transactions/Ledger antes de postear (INV-026, INV-006); `AccountOpened` etc. como tipos de evento.
   - *infrastructure*: repositorios Kysely, mapeo de errores únicos PG → `ACCOUNT_NAME_TAKEN` / `NAME_TAKEN`.
   - *interface*: controllers `accounts`, `institutions` con `x-required-role` (VIEWER lee, EDITOR escribe — docs/10 §14), `If-Match`/ETag por `version`.
2. **Apertura con saldo inicial (ARCHITECTURE §7, docs/06 §3.1).** `apps/api` define `OpenAccountWithOpeningBalance`: abre la `UnitOfWork` (transacción PG + `SET LOCAL app.workspace_id`), registra la clave de idempotencia (`platform.idempotency_key`, INV-027), ejecuta `Accounts.OpenAccount` y, si `openingBalance.amount ≠ 0`, `Transactions.RecordOpeningBalance(accountId, amount, date)`; este último crea la transacción `OPENING_BALANCE` y postea vía `LedgerPostingPort` un asiento `entryType = OPENING` contra `EQUITY:OPENING_BALANCE:<CCY>`, haciendo get-or-create del ledger account de la cuenta y del de sistema. Para pasivos, el monto presentado positivo (adeudado) se traduce a posting negativo en la cuenta (docs/09 §6.7). Cualquier fallo (escala, moneda, periodo) hace rollback de cuenta + transacción + asiento + auditoría + outbox. Accounts no depende de Transactions (sin ciclo).
3. **Vínculo con el ledger.** Un único ledger account por cuenta lo garantiza Ledger con `UNIQUE (workspace_id, owner_account_id)` en `ledger.ledger_account` (add-ledger-core) y get-or-create en la misma transacción del primer posting. Este change **no** crea la columna `accounts.account.ledger_account_id` propuesta en docs/08 §5.2: duplicaría la fuente de verdad y no puede poblarse en la creación con el modelo get-or-create. FR-ACCOUNTS-003 ("en la misma transacción de BD" que la creación) se satisface en su intención —1:1, atómico, misma moneda/naturaleza— pero el ledger account nace con el primer posting (ver Preguntas abiertas).
4. **INV-026 y moneda.** Transactions consulta `AccountsQueryPort.getPostingEligibility` dentro de la misma transacción antes de crear/editar/anular; `ARCHIVED` ⇒ `ACCOUNT_ARCHIVED`, `CLOSED` ⇒ `ACCOUNT_CLOSED`, moneda distinta ⇒ `CURRENCY_MISMATCH`. Las reversas/anulaciones también pasan por la verificación. Archivar/cerrar toma `SELECT … FOR UPDATE` de la fila de la cuenta, y la verificación de elegibilidad usa `FOR SHARE`, evitando la carrera "archivar mientras se postea".
5. **Saldos y equivalente en moneda base.** `ListAccounts` obtiene saldos en lote de `LedgerBalancesPort` (NFR-PERF-005: ≤ 150 ms para todas las cuentas) y la tasa más reciente ≤ fecha actual de `FxRateQueryPort`; el equivalente se calcula con `Money.convert` a precisión 40 y redondeo HALF_EVEN a la escala de la moneda base (INV-020), devolviendo `rateDate`, `rateSource` y `fxRateId`. Sin tasa ⇒ `baseCurrencyBalance = null` + `baseCurrencyBalanceUnavailable = true`. Saldo de pasivos presentado como positivo adeudado (−Σ postings). "Dinero disponible" y patrimonio neto los calcula Reporting (add-basic-dashboard) con `liquidity` e `includeInNetWorth`; este change los expone y los TC de liquidez/patrimonio se ejecutan contra la query de resumen.
6. **Defaults de liquidez** (FR-ACCOUNTS-011 + ARCHITECTURE §4.1): `LIQUID` = bank, cash, digital_wallet, crypto_wallet, savings; `SEMI_LIQUID` = investment; `ILLIQUID` = virtual, manual_asset, credit_card, loan, manual_liability.
7. **Enmascarado.** El API solo acepta `accountNumberLast4` (4 caracteres alfanuméricos); la UI recorta el identificador ingresado antes de enviarlo, de modo que el valor completo nunca llega al backend, a logs, a auditoría ni a eventos. Valores de más de 4 caracteres ⇒ `VALIDATION_FAILED`.
8. **Instituciones.** Sin datos en migraciones; el catálogo inicial opcional es un seed por workspace (`seeds/*/institutions.json`, nombres ficticios — docs/29) cargado por el comando `seed` o al crear el workspace si el owner lo pide; cada fila es una institución normal del workspace (nunca filas globales `workspace_id NULL`). Archivada ⇒ no asignable (`INSTITUTION_ARCHIVED`); las cuentas existentes conservan su `institution_id`.
9. **Etiquetas de cuenta.** Tabla de enlace `accounts.account_tag` con `tag_id` lógico (ref `classification.tag`), validado vía `TagCatalogPort`; tags archivados no asignables (`TAG_ARCHIVED`).
10. **Datos.**
    - `accounts.institution`: columnas de docs/08 §5.2 + `icon text`, `color text`; `kind CHECK IN ('BANK','FINTECH','EXCHANGE','BROKER','WALLET_PROVIDER','OTHER')`; `UNIQUE (workspace_id, id)`; único parcial `(workspace_id, lower(name)) WHERE archived_at IS NULL`; `country_code ~ '^[A-Z]{2}$'`. RLS **WS**.
    - `accounts.account`: columnas de docs/08 §5.2 con estos ajustes: `type CHECK IN ('BANK','CASH','DIGITAL_WALLET','CREDIT_CARD','LOAN','CRYPTO_WALLET','INVESTMENT','SAVINGS','VIRTUAL','MANUAL_ASSET','MANUAL_LIABILITY')`; `classification` coherente con `type`; **nuevas** `liquidity text CHECK IN ('LIQUID','SEMI_LIQUID','ILLIQUID')`, `icon text`, `crypto_network text`; `account_number_last4 ~ '^[A-Za-z0-9]{4}$'`; **sin** `ledger_account_id` (decisión 3); FK compuesta `(workspace_id, institution_id) → accounts.institution(workspace_id, id)`; `currency → fx.currency(code)`; único parcial de nombre entre no archivadas; `closed_on >= opened_on`. RLS **WS**.
    - `accounts.account_tag (workspace_id, account_id, tag_id)`: PK `(workspace_id, account_id, tag_id)`, FK compuesta a `account`; DELETE concedido (tabla de enlace). RLS **WS**.
    - Grants `pf_app`/`pf_worker`: `SELECT, INSERT, UPDATE` en `institution` y `account` (sin DELETE, NFR-DATA-012); `SELECT, INSERT, DELETE` en `account_tag`. Optimistic locking por `version`.
11. **Eventos (outbox, misma transacción).**
    - `accounts.AccountOpened.v1` — al abrir; idempotencia natural `accountId`.
    - `accounts.AccountArchived.v1` — al archivar; natural `(accountId, aggregateVersion)`.
    - `accounts.AccountClosed.v1` — al cerrar; natural `(accountId, aggregateVersion)`; consumidores REPORTING, COMMITMENTS (Phase 3).
    - `accounts.AccountReactivated.v1` — al reactivar; natural `(accountId, aggregateVersion)`.
    - `accounts.AccountUpdated.v1` — cambios de metadatos/liquidez/patrimonio/moneda sin movimientos; natural `(accountId, aggregateVersion)`; payload con `changedFields` y valores nuevos no sensibles.
    - Consumidores deduplican con `platform.inbox (consumer, event_id)` (INV-028); orden por agregado `Account`. Instituciones no emiten eventos en Phase 1 (sin consumidores).
12. **Auditoría:** cada comando llama `AuditPort.append` con acciones `accounts.account.{opened,updated,archived,closed,reactivated,reordered}` y `accounts.institution.{created,updated,archived}`; el saldo inicial se audita en la apertura (y la transacción `OPENING_BALANCE` lo audita Transactions con la misma correlación).

## Contratos

Cambios **exactos** requeridos (no se editan aquí; los consolida el proceso de contratos):

**`contracts/openapi/finance-api.v1.yaml`:**
- `AccountType`: enum → `[BANK, CASH, DIGITAL_WALLET, CREDIT_CARD, LOAN, CRYPTO_WALLET, INVESTMENT, SAVINGS, VIRTUAL, MANUAL_ASSET, MANUAL_LIABILITY]`.
- Nuevo `AccountLiquidity`: enum `[LIQUID, SEMI_LIQUID, ILLIQUID]`.
- Nuevo `AccountStatus`: enum `[ACTIVE, CLOSED, ARCHIVED]`.
- Nuevo `BaseCurrencyBalance`: `{amount: Money, rateDate: LocalDate, rateSource: string, fxRateId: Uuid}` (todos required).
- `Account`: agregar `status: AccountStatus` (required), `liquidity: AccountLiquidity` (required), `baseCurrencyBalance: BaseCurrencyBalance|null`, `icon: string|null`, `tagIds: Uuid[]`, `cryptoNetwork: string|null` (maxLength 20); `accountNumberLast4.pattern` → `^[A-Za-z0-9]{4}$`; ampliar descripción de `balance` (pasivo positivo = adeudado).
- `AccountCreate`: agregar `liquidity` (opcional, default por tipo documentado), `icon` (maxLength 40), `tagIds` (Uuid[]), `cryptoNetwork`; `accountNumberLast4.pattern` → `^[A-Za-z0-9]{4}$`; `openingBalance.amount` descripción: escala de la moneda, cero ⇒ sin asiento.
- `AccountUpdate`: agregar `currency` (permitido solo sin movimientos ⇒ `409 ACCOUNT_CURRENCY_IMMUTABLE`), `liquidity`, `icon`, `tagIds`, `cryptoNetwork`; **quitar** `closedOn` (pasa a `closeAccount`); `accountNumberLast4.pattern` → `^[A-Za-z0-9]{4}$`. `type` sigue ausente (`additionalProperties: false` ⇒ `VALIDATION_FAILED`).
- `listAccounts`: agregar parámetros `status` (array de `AccountStatus`, explode), `tagId` (Uuid), `liquidity` (array de `AccountLiquidity`); `sort` enum agregar `type`, `institution`; nuevo `groupBy` (enum `[type, institution]`) que devuelve `AccountPage.groups` (`[{key: string|null, label: string|null, accountIds: Uuid[]}]`, nuevo campo opcional en `AccountPage`).
- `createAccount`: respuestas adicionales documentadas con códigos `CURRENCY_NOT_ENABLED`, `ACCOUNT_CURRENCY_KIND_MISMATCH`, `AMOUNT_SCALE_EXCEEDED`, `REFERENCE_NOT_FOUND`, `INSTITUTION_ARCHIVED` (422/409), `ACCOUNT_NAME_TAKEN` (409), `IDEMPOTENCY_KEY_REUSED` (422).
- Reemplazar `/workspaces/{workspaceId}/accounts/{accountId}/unarchive` (`unarchiveAccount`) por `/workspaces/{workspaceId}/accounts/{accountId}/reactivate` (`reactivateAccount`, `x-required-role: EDITOR`, `IfMatch`, 200 `Account`, 401/403/404/409 (`ACCOUNT_NAME_TAKEN`, `INVALID_STATUS_TRANSITION`)/412/428).
- Nuevo `/workspaces/{workspaceId}/accounts/{accountId}/close` (`closeAccount`, `x-required-role: EDITOR`, `IfMatch`, body `AccountClose {closedOn: LocalDate (required), reason?: string ≤ 500}`, 200 `Account`, 409 `ACCOUNT_BALANCE_NOT_ZERO`/`INVALID_STATUS_TRANSITION`, 401/403/404/412/428).
- Nuevo `/workspaces/{workspaceId}/accounts/order` (`reorderAccounts`, `PUT`, `x-required-role: EDITOR`, body `{accountIds: Uuid[]}`, 204; 422 `REFERENCE_NOT_FOUND`).
- `archiveAccount`: 409 documenta `INVALID_STATUS_TRANSITION`.
- `InstitutionKind`: enum → `[BANK, FINTECH, EXCHANGE, BROKER, WALLET_PROVIDER, OTHER]`.
- `Institution`, `InstitutionCreate`, `InstitutionUpdate`: agregar `icon` (string ≤ 40, nullable en lectura/update) y `color` (string ≤ 20, nullable en lectura/update).
- `listInstitutions`: agregar parámetro `kind` (array de `InstitutionKind`).
- `createInstitution`/`updateInstitution`: 409 documenta `NAME_TAKEN`.
- `ErrorCode` (y docs/10 §9.1): agregar `ACCOUNT_CLOSED` (409), `ACCOUNT_BALANCE_NOT_ZERO` (409), `ACCOUNT_CURRENCY_KIND_MISMATCH` (422), `INSTITUTION_ARCHIVED` (409).

**`contracts/events/`:**
- `accounts/AccountOpened.v1.schema.json` (aún no publicado; se corrige en v1): `payload.type` enum → los 11 valores de `AccountType`; agregar `liquidity` (enum `LIQUID|SEMI_LIQUID|ILLIQUID`, required).
- `accounts/AccountArchived.v1.schema.json`: sin cambios.
- Nuevo `accounts/AccountClosed.v1.schema.json`: payload `{accountId: Uuid, closedOn: LocalDate, reason: string|null}`; `aggregateType: "Account"`; idempotencia `(accountId, aggregateVersion)`; PII baja (`reason`).
- Nuevo `accounts/AccountReactivated.v1.schema.json`: payload `{accountId: Uuid, previousStatus: "ARCHIVED"|"CLOSED", reactivatedOn: LocalDate}`; idempotencia `(accountId, aggregateVersion)`; PII ninguna.
- Nuevo `accounts/AccountUpdated.v1.schema.json`: payload `{accountId: Uuid, changedFields: string[] (enum: name, institutionId, liquidity, includeInNetWorth, includeInBudget, displayOrder, color, icon, notes, tagIds, cryptoNetwork, currency, accountNumberLast4), name?: string, institutionId?: Uuid|null, liquidity?: AccountLiquidity, includeInNetWorth?: boolean, currency?: CurrencyCode}`; nunca `notes` ni identificadores; idempotencia `(accountId, aggregateVersion)`; PII baja (`name`).
- `contracts/events/README.md`: listar los tres eventos nuevos como Phase 1.

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere antes:** `bootstrap-platform-foundation`; `add-workspace-identity` (workspace, roles, RLS, moneda base); `add-api-conventions` (idempotencia, problem+json, ETag/If-Match, cursor); `add-audit-trail` (`AuditPort`).
- **Requiere para el saldo inicial y saldos:** `add-ledger-core` (`LedgerPostingPort`, get-or-create con `UNIQUE (workspace_id, owner_account_id)`, `GetBalances`, `HasPostings`, cuentas de sistema `EQUITY:OPENING_BALANCE:<CCY>`) y `add-transaction-recording` (kind `OPENING_BALANCE`, `RecordOpeningBalance`, verificación INV-026 vía `AccountsQueryPort`, transacción de ajuste). Plan: implementar los grupos 2–5 de tasks (CRUD sin saldo inicial) antes; el grupo 6 (apertura con saldo y saldos) tras esos dos changes.
- **Usa:** `add-manual-conversions` (catálogo `fx.currency` con `kind`/`scale` y tasas manuales para el equivalente en moneda base; mientras no exista, `baseCurrencyBalance = null`); `add-classification` (tags de cuenta); `add-transfers` (TC-ACCOUNTS-CREDITCARD-001 y cuentas virtuales); `add-basic-dashboard` (consume liquidez y patrimonio neto; TC-ACCOUNTS-LIQUIDITY-001 / NETWORTH-001).
- **Nota de orden:** docs/03 §7 ordena accounts (3) antes de ledger (4) y transacciones (6); el saldo inicial invierte esa dependencia. Se mantiene el orden de redacción, pero el archivo del change exige los tres aplicados.

## Riesgos / Trade-offs

- [Carrera entre archivar y postear] → bloqueo de fila (`FOR UPDATE`/`FOR SHARE`) en la misma transacción (decisión 4) + TC-ACCOUNTS-ARCHIVE-002.
- [Equivalente en moneda base con tasa vieja] → se muestran fecha y fuente; nunca se persiste el equivalente.
- [Eliminar `ledger_account_id` respecto de docs/08] → menos acoplamiento y una sola fuente de verdad; requiere actualizar docs/08 al archivar.
- [Enum de tipos distinto al de docs/04/08/eventos] → se corrige en contratos antes de la primera publicación; sin datos que migrar.
- [Archivar una cuenta con saldo ≠ 0 la oculta pero su saldo sigue existiendo] → se permite (FR-ACCOUNTS-007 solo exige saldo cero para cerrar); el dashboard decide si la incluye (pregunta abierta).

## Plan de migración

1. `accounts_0001_create_institution_account` (expand): `CREATE SCHEMA accounts`; tablas `institution`, `account`, `account_tag`; checks, índices únicos parciales, FKs compuestas, FK a `fx.currency` (requiere que exista `fx.currency`; si `add-manual-conversions` aún no se aplicó, la migración de bootstrap de `fx.currency` se adelanta a este change); RLS WS `ENABLE`+`FORCE`; grants.
2. Seeds Minimal/Demo actualizados con los tipos nuevos (docs/29 usa "checking" ⇒ `BANK`).
3. Sin datos productivos. Rollback: revertir la migración en entornos sin datos.

## Preguntas abiertas

- FR-ACCOUNTS-003 exige crear el `LedgerAccount` en la misma transacción que la cuenta; ARCHITECTURE §7, docs/06 y docs/11 definen get-or-create al postear. Este diseño sigue ARCHITECTURE (canónico); ¿se ajusta el texto de FR-ACCOUNTS-003?
- ¿Las cuentas archivadas con saldo ≠ 0 cuentan en el patrimonio neto del dashboard? Propuesta: sí, si `includeInNetWorth` (el saldo existe); la UI advierte al archivar con saldo.
- ¿Liquidez por defecto de los pasivos (`ILLIQUID`) es adecuada para *safe to spend*, o los pasivos deben quedar fuera del eje de liquidez? Revisar en el change de reporting.
