# Diseño

## Contexto

El contexto LEDGER (`ledger`, `@pf/ledger`, docs/05 §2.3) es el núcleo financiero: registra hechos económicos como `JournalEntry` con `Posting[]`, nunca clasifica (las categorías viven en `TransactionSplit`) y nunca valora (Reporting). Fuentes canónicas: `docs/ARCHITECTURE.md` §4.1, §4.6, §4.7, §9; `docs/09-ledger-design.md` (§2–§5, §8, §10, §12, §13, catálogo INV); `docs/08-data-model.md` §1.4, §5.3, §6, §8–§11; `docs/04-domain-model.md` §3.3; ADR-0004, ADR-0006, ADR-0007, ADR-0008, ADR-0023. Evidencia: SPIKE-03 (`Money` con decimal.js, cuantización racional exacta, hallazgos H1–H8) y SPIKE-02 (Kysely + dbmate sobre PostgreSQL 18, trigger diferido que falla en `COMMIT` con `PF001`, RLS fail-closed, `UPDATE/DELETE` → `42501`). Motivación: ver proposal.md — Por qué.

Capas afectadas:

| Capa | Cambio |
|---|---|
| shared-kernel (domain) | `Money`, `MoneyDecimal` (clon decimal.js, precisión 40, HALF_EVEN), `Currency` (código + escala), `Rate`, `rounding` (cuantización racional exacta con `bigint`), `allocate` (mayor residuo). Errores: `MONEY_INVALID_AMOUNT`, `AMOUNT_SCALE_EXCEEDED`, `AMOUNT_OUT_OF_RANGE`, `CURRENCY_MISMATCH`, `INVALID_ALLOCATION`. |
| ledger/domain | AR `JournalEntry` (E `Posting`), AR `LedgerAccount`; VO `EntryType`, `SourceRef`, `LedgerAccountCode`, `SignedAmount`, `PeriodLock`; DS `EntryValidator`, `ReversalFactory`, `BalanceCalculator`, `LedgerAccountResolver`. |
| ledger/application | Casos de uso `PostJournalEntry`, `ReverseJournalEntry`, `LockPeriod`, `UnlockPeriod`, `GetBalance`, `GetBalances`, `GetTrialBalance`, `GetEntriesBySource`, `RebuildBalanceSnapshots`, `VerifyLedgerIntegrity`. Puertos de salida: `JournalEntryRepository` (append-only: `append`, `findById`, `findActiveBySource`), `LedgerAccountRepository`, `BalanceSnapshotRepository`, `PeriodLockRepository`, `OutboxPort`, `Clock`, `IdGenerator`, `MetricsPort`. |
| ledger/contracts (API pública) | `LedgerPostingPort` (sync, misma transacción BD del llamador), `LedgerPeriodLockPort` (sync), `BalanceQuery`. Ningún otro contexto importa internals del ledger (ADR-0003). |
| ledger/infrastructure | Repositorios Kysely sobre `Transaction<DB>` de la Unit of Work (ADR-0007), migraciones dbmate, job del worker para snapshots y verificación. |
| interface | Solo el endpoint técnico Could `GET …/ledger/trial-balance`. El resto del ledger se expone indirectamente vía Accounts/Transactions. |

## Objetivos / No objetivos

**Objetivos:**
- Ledger de doble entrada multi-moneda con las invariantes INV-001..008, INV-015, INV-020, INV-022, INV-025 y la identidad INV-031 verificables por tests (unit, PBT, integración con PostgreSQL real).
- Doble barrera (dominio + base de datos) para balance por moneda, mínimo de postings, montos no cero, moneda de cuenta, inmutabilidad, reversa única y periodo bloqueado.
- Contratos estables (`LedgerPostingPort`, `LedgerPeriodLockPort`, `BalanceQuery`) para que Transactions, Accounts, Reporting y (Phase 2) Planning se integren sin conocer el modelo interno.
- Promover el prototipo de SPIKE-03 a `packages/shared-kernel` con sus 39 tests y la regla de lint `pf/no-number-money`.

**No objetivos:**
- Mapear tipos de transacción a postings (docs/09 §6 lo implementa `TransactionPostingTranslator` en `add-transaction-recording`).
- Ciclo de vida de `FinancialPeriod`, cierre y reapertura (Planning, Phase 2).
- Saldo cleared/conciliado (Transactions), saldo proyectado y patrimonio en moneda de reporte (Accounts/Reporting).
- Particionado de `ledger.posting` (no necesario por volumen en Phase 1, docs/08 §8).

## Decisiones

1. **Plan de cuentas y resolución idempotente.** `LedgerAccountResolver.getOrCreateForUserAccount(accountId, nature, currency)` y `getOrCreateSystem(systemKind, currency)` usan `INSERT … ON CONFLICT DO NOTHING` + `SELECT` sobre los índices únicos `(workspace_id, source_account_id) WHERE source_account_id IS NOT NULL` y `(workspace_id, system_kind, currency) WHERE system_kind IS NOT NULL` (docs/08 §9). El mismo método sirve a los dos momentos de creación: al crear la cuenta del usuario (FR-ACCOUNTS-003, orquestado por `add-accounts-management` en la misma Unit of Work) y como red de seguridad en el primer posting (docs/09 §2.2). `currency` y `type` no tienen grant de UPDATE (solo `archived_at`).
2. **Validación en dominio (`EntryValidator`)**, en este orden y con el primer error como resultado (`Result<T, DomainError>`): workspace único (INV-025) → ≥ 2 postings (`LEDGER_ENTRY_TOO_FEW_POSTINGS`) → ningún monto cero (`LEDGER_ZERO_AMOUNT_POSTING`) → escala por moneda (`AMOUNT_SCALE_EXCEEDED`, INV-003) → moneda del posting = moneda de la cuenta (`CURRENCY_MISMATCH`, INV-006) → split en postings nominales (`LEDGER_SPLIT_REQUIRED`) → Σ por moneda = 0 (`LEDGER_UNBALANCED_ENTRY` con el residuo de cada moneda, INV-004) → periodo abierto (`PERIOD_CLOSED`, INV-015). Alternativa — acumular todos los errores — descartada: estos errores indican bugs del traductor, no entrada de usuario; basta el primero con detalle.
3. **Refuerzo en base de datos** (docs/08 §5.3 y §10.2, validado en SPIKE-02):
   - Constraint trigger `DEFERRABLE INITIALLY DEFERRED` `posting_balanced_trg` → `SQLSTATE PF001` (`LEDGER_UNBALANCED_ENTRY`).
   - Constraint trigger diferido `journal_entry_postings_trg` (≥ 2 postings) → **`PF005`** (`LEDGER_ENTRY_TOO_FEW_POSTINGS`). docs/08 usa `PF002` para este trigger y también para el fail-closed de `platform.current_workspace_id()`; se reserva `PF002` para RLS (ya en el bootstrap) y se asigna `PF005` aquí (ver Preguntas abiertas).
   - `CHECK (amount <> 0)`; `CHECK account_type NOT IN ('INCOME','EXPENSE') OR split_id IS NOT NULL`.
   - FK compuesta `(ledger_account_id, currency, account_type) → ledger_account(id, currency, type)` (INV-006) y FKs `(journal_entry_id, entry_date)` / `(workspace_id, journal_entry_id)` (INV-025).
   - `platform.forbid_mutation()` `BEFORE UPDATE OR DELETE` (fila) y `BEFORE TRUNCATE` (sentencia) → `PF003`, además de no otorgar `UPDATE/DELETE/TRUNCATE` a `pf_app`/`pf_worker` (la vía normal falla antes con `42501`).
   - `BEFORE INSERT` en `journal_entry` que consulta `period_lock` → `PF004` (`PERIOD_CLOSED`), cerrando la carrera cierre ↔ posteo.
   - La infraestructura mapea `PF001/PF004/PF005` a los `DomainError` equivalentes; `PF003`, `42501` y `PF002` son siempre bugs → `INTERNAL_ERROR` + log de error + métrica.
4. **Inmutabilidad y reversa.** `reversed_by` se modela como `ledger.entry_reversal(original_entry_id PK, reversal_entry_id UNIQUE)`: la PK garantiza reversa única incluso bajo concurrencia (la segunda inserción viola la PK → `LEDGER_ENTRY_ALREADY_REVERSED`). `ReversalFactory` copia cuentas, `split_id` y `line_no`, niega montos con `Money.negate()` (exacto) y rechaza revertir un `REVERSAL` (`LEDGER_ENTRY_NOT_REVERSIBLE`). La fecha de la reversa la decide el llamador (`ReverseJournalEntry(entryId, reverseDate, reason)`); por defecto Transactions usa la fecha del original (docs/09 §5) y el ledger solo valida que esté en periodo abierto.
5. **Idempotencia por origen.** Índice único `(workspace_id, source_type, source_id, source_revision, entry_type)` en `journal_entry`. `PostJournalEntry` con un `sourceRef` ya registrado devuelve el `journalEntryId` existente sin escribir postings ni eventos (comparación de contenido opcional: si los postings difieren se registra un error de integridad, no se sobrescribe). Esta es la idempotencia interna del ledger; la de API (`Idempotency-Key`, INV-027) la provee `platform/api-conventions`.
6. **Periodos bloqueados.** `ledger.period_lock(workspace_id, period_start, period_end, period_id, locked_at, locked_by)` con exclusión gist de rangos solapados (docs/08). `LedgerPeriodLockPort.lockPeriod(start, end, periodId)` / `unlockPeriod(periodId)` son idempotentes y los usará Planning (Phase 2) en la misma transacción que el cierre; en Phase 1 no hay llamadores productivos y los tests usan el puerto directamente. El chequeo de dominio usa `PeriodLockRepository.isLocked(entryDate)` dentro de la misma transacción.
7. **Dinero (shared-kernel, ADR-0006 + SPIKE-03).** `Money` inmutable con `MoneyDecimal` (clon de decimal.js, precisión 40, `ROUND_HALF_EVEN`); entrada solo como string decimal canónico (regex `^-?\d{1,20}(\.\d{1,18})?$`); validación de escala por valor (acepta ceros finales de `NUMERIC`), rango |x| < 10²⁰ (`AMOUNT_OUT_OF_RANGE`) y normalización de `-0`. `multiply/divide/percentage/convert` calculan el racional exacto con `bigint` y cuantizan una sola vez HALF_EVEN (hallazgo H3). `allocate` trunca hacia cero y reparte el residuo por mayor resto con desempate por menor índice (hallazgo H5). Serialización API/eventos: `toJSON()` → `{"amount":"685.00","currency":"BOB"}` a la escala de la moneda. Persistencia `NUMERIC(38,18)` con type parser de `pg` que devuelve string (nunca `number`). Lint `pf/no-number-money` + `no-restricted-imports` del `Decimal` global (H7).
8. **Saldos.** `balance(account, asOf) = Σ posting.amount WHERE entry_date ≤ asOf` usando el índice `(workspace_id, ledger_account_id, entry_date, id) INCLUDE (amount)`; con snapshot: `snapshot(as_of_date ≤ asOf) + Σ postings posteriores`. Saldo presentado = `nature ∈ {ASSET, EXPENSE} ? balance : −balance` (`BalanceCalculator`). `GetBalances` agrupa por moneda en SQL (`SUM` sobre `NUMERIC`), nunca suma monedas distintas. El ledger no conoce estados de transacción: el saldo proyectado lo arma Accounts con `pendingAmount` de Transactions.
9. **Snapshots** (`ledger.balance_snapshot`, política **DRV**): escritos solo por el worker (`pf_worker`), lectura `pf_app`. Un asiento con `entry_date` anterior a snapshots existentes de sus cuentas los invalida (DELETE de caché permitido al worker) mediante un job encolado desde el consumidor de `ledger.JournalEntryPosted` interno; mientras tanto la lectura cae al cálculo completo si el snapshot más reciente tiene `as_of_date ≥ entry_date` mínimo pendiente. `RebuildBalanceSnapshots(ledgerAccountId?)` recalcula desde cero. `last_sequence` es un checkpoint conservador (no orden de commit; docs/08 §5.3 punto 7).
10. **Verificador de invariantes** (`VerifyLedgerIntegrity`, job diario en el worker y tras `restore:local`): consultas SQL que detectan asientos con Σ ≠ 0 por moneda, asientos con < 2 postings, postings en cero, snapshots ≠ Σ postings, reversas que no niegan exactamente su original. Cada violación → log `error` estructurado con `workspaceId`, métrica `ledger_invariant_violations_total{invariant}` y alerta crítica (NFR-OBS-005; en local vía log/notify).
11. **Evento.** `PostJournalEntry` y `ReverseJournalEntry` escriben `ledger.JournalEntryPosted.v1` en `platform.outbox` en la misma transacción (ADR-0008). Idempotencia del consumidor: `eventId` + `journalEntryId` como clave natural en `platform.inbox`; Reporting ordena proyecciones por `sequence`. No se consumen eventos de otros contextos.
12. **RLS y grants** (ADR-0023, docs/08 §1.4 y §6): todas las tablas `ledger.*` con `ENABLE` + `FORCE ROW LEVEL SECURITY` y política `workspace_id = platform.current_workspace_id()` (fail-closed `PF002`). `journal_entry`, `posting`, `entry_reversal` = **WS-RO** (`SELECT, INSERT`); `ledger_account` = WS (`SELECT, INSERT`, `UPDATE(archived_at)`); `period_lock` = WS (`SELECT, INSERT, DELETE` para `pf_app`); `balance_snapshot` = **DRV**. Un posting contra una cuenta contable de otro workspace no es visible bajo RLS → el repositorio la resuelve como inexistente (`REFERENCE_NOT_FOUND`).
13. **Endpoint técnico (Could).** `GET /api/v1/workspaces/{workspaceId}/ledger/trial-balance?asOf=` con rol mínimo `VIEWER` (docs/31 D44, owner 2026-10-05: el contrato con `x-required-role: VIEWER` es el correcto; antes decía solo `OWNER`; no miembro ⇒ `WORKSPACE_ACCESS_DENIED`), sin `Idempotency-Key` (lectura). Se implementa al final y puede posponerse sin afectar a otros changes.

## Contratos

Cambios EXACTOS requeridos (este change no edita los archivos; los consolida otro proceso):

**`contracts/openapi/finance-api.v1.yaml`**

1. `components.schemas.ErrorCode` — agregar al `enum`:
   - `LEDGER_ENTRY_TOO_FEW_POSTINGS` (422)
   - `LEDGER_ZERO_AMOUNT_POSTING` (422)
   - `LEDGER_SPLIT_REQUIRED` (422)
   - `LEDGER_ENTRY_ALREADY_REVERSED` (409)
   - `LEDGER_ENTRY_NOT_REVERSIBLE` (409)
   - `MONEY_INVALID_AMOUNT` (422)
   - `AMOUNT_OUT_OF_RANGE` (422)
   (`LEDGER_UNBALANCED_ENTRY`, `PERIOD_CLOSED`, `CURRENCY_MISMATCH`, `AMOUNT_SCALE_EXCEEDED`, `REFERENCE_NOT_FOUND`, `INSUFFICIENT_ROLE` ya existen.)
2. `components.responses` de 409/422 — añadir `LEDGER_ENTRY_ALREADY_REVERSED` a la descripción de ejemplos del 409 y `LEDGER_UNBALANCED_ENTRY` al 422 (solo documentación).
3. Nueva operación (Could, FR-LEDGER-016):
   - Path `/workspaces/{workspaceId}/ledger/trial-balance`, `get`, `operationId: getLedgerTrialBalance`, `tags: [ledger]`, `x-openspec-capability: [ledger/balances]`, seguridad estándar; parámetros `workspaceId` (path) y `asOf` (query, `LocalDate`, opcional; default hoy en la zona del workspace).
   - `200` → `TrialBalance`; `401`, `403` (`WORKSPACE_ACCESS_DENIED`, `INSUFFICIENT_ROLE`), `404`, `400` (`VALIDATION_FAILED`).
   - Schemas nuevos:
     - `TrialBalance`: `{ asOf: LocalDate, currencies: TrialBalanceCurrency[] }` (required ambos).
     - `TrialBalanceCurrency`: `{ currency: CurrencyCode, lines: TrialBalanceLine[], total: Money }` (`total.amount` siempre `"0"` a la escala de la moneda).
     - `TrialBalanceLine`: `{ ledgerAccountId: Uuid, code: string (p. ej. "EXPENSE:BOB" o "ASSET:<accountId>"), nature: LedgerAccountNature, accountId: Uuid|null, balance: Money }`.
     - `LedgerAccountNature`: `enum [ASSET, LIABILITY, EQUITY, INCOME, EXPENSE]`.
4. Sin cambios en `Money`/`DecimalString` (el patrón ya prohíbe números JSON y limita a 20 enteros + 18 decimales). Nota: el patrón admite `"-0"`; el servidor normaliza a `"0.00"` y nunca lo emite.

**`contracts/events/`**

- Sin cambios: `ledger/JournalEntryPosted.v1.schema.json` ya cubre `STANDARD|REVERSAL|OPENING`, `sequence`, `sourceRef`, `reversesEntryId`, postings con `Money` firmado, `accountId|systemAccountCode` y `splitId`. Se añade (en tests de contrato, no en el schema) la verificación de Σ por moneda = 0 y de escala canónica por moneda.

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere:** `bootstrap-platform-foundation` (bootstrap SQL, `platform.current_workspace_id()`, `platform.forbid_mutation()`, roles), `add-workspace-identity` (workspace, membresía y rol `OWNER` para el endpoint técnico), `add-api-conventions` (problem+json, mapeo de `DomainError`), outbox de plataforma (ADR-0008). Tabla de monedas con escala (`fx.currency`): si `add-manual-conversions` aún no la creó, este change agrega la migración de datos de referencia mínima (BOB, USD, USDT, BTC, JPY, ETH) y aquel la extiende.
- **Habilita:** `add-accounts-management` (cuenta contable por cuenta del usuario y asiento de apertura vía `LedgerPostingPort`), `add-transaction-recording` (traductor → `PostJournalEntry`/`ReverseJournalEntry`), `add-transfers`, `add-manual-conversions` (FX_TRADING por moneda), `add-basic-dashboard` (`BalanceQuery`), y en Phase 2 `planning/month-closing` (`LedgerPeriodLockPort`).
- **Audit:** las mutaciones de negocio (transacción, cuenta) escriben `AuditLog` en el contexto llamador (INV-029); el ledger no escribe audit propio salvo en `lockPeriod`/`unlockPeriod`, que Planning auditará en Phase 2.

## Riesgos / Trade-offs

- [Colisión de `SQLSTATE PF002` en docs/08] → `PF005` para el mínimo de postings; reportado al owner para corregir docs/08 §10.2.
- [Creación concurrente de cuentas de sistema o de usuario] → `ON CONFLICT DO NOTHING` + relectura; test de concurrencia (TC-LEDGER-CHART-002/003).
- [Trigger diferido por fila: costo por posting] → medido en SPIKE-02 (despreciable con 2–20 postings); seguir con `EXPLAIN ANALYZE` y medir overhead de RLS (< 10 %, ADR-0023). **Criterio (docs/31 D43, owner 2026-10-05):** el < 10 % se mide sobre la consulta real de saldos en lote de la aplicación; el agregado sintético de todo el workspace queda solo informativo; se mantiene el fail-closed `PF002` (nunca 0 filas sin contexto).
- [`sequence` no refleja el orden de commit] → snapshots con checkpoints conservadores, invalidación por fecha y reconstrucción completa como red; el verificador compara contra Σ postings.
- [Doble redondeo en multiplicaciones con precisión 40] → cuantización racional exacta con `bigint` (H3) y PBT de borde.
- [Uso accidental de `number`] → regla tipada `pf/no-number-money`, prohibición del `Decimal` global, architecture test sobre DTOs y Spectral (`type: number` prohibido en montos).
- [Trade-off: error único por asiento] → diagnósticos menos completos para el traductor a cambio de un validador simple y determinista.

## Plan de migración

Fase *expand* únicamente, en `db/migrations/ledger/` (orden global por timestamp, dbmate con `pf_migrator`):
1. `CREATE SCHEMA ledger`; tablas `ledger.ledger_account`, `ledger.journal_entry` (`sequence bigint GENERATED ALWAYS AS IDENTITY`), `ledger.posting` (`amount NUMERIC(38,18)`), `ledger.entry_reversal`, `ledger.period_lock` (requiere `btree_gist` del bootstrap), `ledger.balance_snapshot`, con índices y FKs compuestas de docs/08 §5.3.
2. Funciones y triggers: `ledger.assert_entry_balanced` (PF001), `ledger.assert_entry_has_postings` (PF005), `ledger.assert_period_open` (PF004), triggers de `platform.forbid_mutation` (PF003).
3. RLS `ENABLE` + `FORCE` y política `ws_isolation` en las 6 tablas; grants por rol según docs/08 §6; revocar `UPDATE/DELETE/TRUNCATE` en las tablas WS-RO.
4. Datos de referencia de monedas (si aplica, ver Dependencias).
Sin datos existentes: no hay backfill. Rollback en local = `down` de las migraciones (no destructivo de datos productivos porque no existen); en entornos con datos se hace *roll-forward*. Test de migraciones: aplicar todo sobre PG vacío (Testcontainers) y verificar RLS/grants/triggers.

## Preguntas abiertas

- ~~**Criterio de overhead de RLS** (tarea 5.5: el agregado sintético de todo el workspace mide 18–20 %)~~ — resuelta por el owner el 2026-10-05 (docs/31 D43): el objetivo < 10 % se mide sobre la consulta real de saldos en lote; el agregado sintético queda solo informativo; se mantiene el fail-closed `PF002`.
- ~~**Rol del balance de comprobación** (contrato `VIEWER` vs tarea 6.3 / TC `OWNER`)~~ — resuelta por el owner el 2026-10-05 (docs/31 D44): rol mínimo `VIEWER` (el contrato es correcto); spec, decisión 13 y TC-LEDGER-TRIAL-001 corregidos.
- **SQLSTATE del mínimo de postings:** se propone `PF005` porque docs/08 asigna `PF002` tanto a RLS fail-closed (§1.4) como al trigger de mínimo de postings (§10.2). Requiere corrección del owner en docs/08; no bloquea las specs.
- **Granularidad del bloqueo:** docs/09 §10 habla de `year_month`; docs/08 usa rangos `period_start/period_end`. Se adopta el rango (generaliza meses calendario); confirmar al redactar `planning/month-closing`.
- **Reversa en periodo cerrado con "corregir en el periodo actual"** (docs/09 Preguntas abiertas 3): la decide Transactions al elegir `reverseDate`; el ledger solo valida. No bloquea este change.
- **Prioridad de snapshots y verificador:** FR-LEDGER-014/015 son *Should* en docs/01, pero NFR-DATA-008/009 son *Must* en Phase 1; las specs usan *Must*. Confirmar con el owner.
- **Ubicación de `Currency`/escala:** el registro de monedas vive en FX (`fx.currency`); el ledger lo consume por FK de `currency`. Confirmar quién crea la migración de referencia si `add-manual-conversions` se aplica después.

## Registro de implementación (2026-10-03)

Implementación autónoma (owner ausente); decisiones y correcciones tomadas durante el apply, pendientes de revisión:

1. **Bloqueo de periodo MENSUAL** `(workspace_id, year_month)` (docs/31 D10, docs/08 §5.3 punto 6) en lugar de los rangos `period_start/period_end` de §Decisiones 6 y de "Preguntas abiertas": el VO `YearMonth` y `LedgerPeriodLockPort.lockPeriod({ workspaceId, yearMonth, periodId })` / `unlockPeriod({ workspaceId, yearMonth, reason })`. Los escenarios de la spec ("del 2026-08-01 al 2026-08-31") son exactamente un mes, por lo que no cambian.
2. **Migraciones en `apps/api/db/migrations/`** (layout plano real del repo) y no en `db/migrations/ledger/`: `20261003170000_ledger_core.sql`. No se agregó JPY a `fx.currency` (no lo usa ningún TC del ledger); queda para `add-manual-conversions`.
3. **Auditoría de cada mutación del ledger** (instrucción de la sesión + regla de arquitectura `*.service.ts` → `AuditPort`): `ledger.journal_entry.posted`, `ledger.journal_entry.reversed` (con `reason`), `ledger.period_lock.locked` / `unlocked`, en la misma unidad de trabajo que el asiento y el evento. Esto amplía lo dicho en §Dependencias ("el ledger no escribe audit propio salvo lock/unlock"); los contextos llamadores seguirán auditando su propia mutación de negocio.
4. **Unidad de trabajo del ledger** (`PgLedgerUnitOfWork`): reutiliza la transacción del llamador si existe (mismo commit) o abre una `PgUnitOfWork` con el workspace y el usuario del contexto de la petición; traduce SQLSTATE: `PF001/PF004/PF005` → `DomainError`, `PF002/PF003/42501` → `INTERNAL_ERROR` + log + métrica `ledger_db_barrier_violations_total` (causa original en `cause`).
5. **Reversas concurrentes:** la segunda reversa choca primero con el índice único de idempotencia `(workspace_id, source_type, source_id, source_revision, entry_type)` (ambas son `REVERSAL` del mismo origen) y no con la PK de `entry_reversal`; el repositorio mapea ese `23505` a `LEDGER_ENTRY_ALREADY_REVERSED` (y a `CONCURRENCY_CONFLICT` para dos `STANDARD` concurrentes del mismo origen). `entry_reversal` usa `ON CONFLICT DO NOTHING` como segunda barrera.
6. **`TC-LEDGER-IMMUTABILITY-001`** decía "se mapea a `LEDGER_IMMUTABLE`"; se corrigió a `INTERNAL_ERROR` + métrica según §Decisiones 3 y D19 (PF003 siempre es un bug). `LEDGER_IMMUTABLE` sigue en el enum de la API "if surfaced"; propongo retirarlo o documentar que nunca se emite.
7. **shared-kernel:** `Money` promovido desde SPIKE-03 sobre el `Money` existente sin romper usos (`parse`, `toFixed`, `toString` con código y `toJSON` intactos; `of` es alias). Errores como `DomainError`; `MONEY_SCALE_EXCEEDED` del spike unificado en `AMOUNT_SCALE_EXCEEDED`; `AMOUNT_OUT_OF_RANGE` ahora también en resultados de aritmética. Nuevos: `assertSameCurrency` (código y escala), `Rate`, `RoundingMode`, `Weight`. `conversion.ts` del spike NO se promovió (pertenece a `add-manual-conversions`).
8. **PBT:** 100 corridas por PR con semilla fija y 10 000 con `NIGHTLY=1` (verificado localmente) para TC-LEDGER-MONEY-002/004/006/007/008, BALANCE-003, REVERSAL-003 y VALUATION-001 (INV-001/002/004/008/020/021/022/031).
9. **Sin endpoint ni módulo Nest** en este change: `createLedgerRuntime` (interface) compone `LedgerPostingPort`, `LedgerPeriodLockPort` y `BalanceQuery` para el composition root; el endpoint Could (6.3) queda pendiente.

Correcciones de docs a reportar al owner (tarea 9.1; no se editaron docs/08/09): docs/09 §13 usa `'LEDGER_IMMUTABLE'` como mensaje de `forbid_mutation` (la función real emite `IMMUTABLE_RECORD`); "Preguntas abiertas" de este design sobre granularidad del bloqueo y PF002/PF005 ya están resueltas por D10/D19 y docs/08 vigente.

## Registro de implementación — hardening (2026-10-03)

Implementación autónoma (owner ausente) de las tareas 2.4, 4.4, 4.5, 5.5 (parcial) y 5.6; decisiones pendientes de revisión:

1. **Rol `pf_ledger_maintenance`** (migración `20261003190000_ledger_maintenance_role.sql`, expand): NOLOGIN, sin BYPASSRLS, asumible solo por `pf_worker` con `SET LOCAL ROLE` dentro de la transacción del job (mismo patrón que `pf_maintenance`). Lee `ledger_account`, `journal_entry`, `posting`, `entry_reversal` de todos los workspaces (políticas `USING (true)` solo para ese rol), lee/borra/inserta `balance_snapshot` y lee `fx.currency`. Alternativa descartada: dar a `pf_worker` lectura entre workspaces en general (ampliaría el alcance de todos los consumidores de eventos).
2. **Checkpoint exacto de snapshots:** `RebuildBalanceSnapshots` toma `pg_advisory_xact_lock` exclusivo por workspace y cada `PostJournalEntry`/reversa toma el mismo candado en modo compartido (`pg_advisory_xact_lock_shared`) al insertar el asiento. Así no hay asientos en vuelo durante la reconstrucción y `last_sequence` (= máximo `sequence` visible del workspace) es exacto: todo asiento posterior tiene `sequence` mayor. Costo: un candado compartido por asiento; los posteos esperan mientras se reconstruye ese workspace (milisegundos con el volumen de Phase 1).
3. **Invalidación sin job adicional:** la lectura descarta en la misma consulta un snapshot con algún asiento `sequence > last_sequence` y `entry_date ≤ as_of_date` en esa cuenta (usa `journal_entry_sequence_ix`), y cae al anterior o a Σ postings. Esto cumple "el saldo es correcto incluso antes de que termine el job" (TC-LEDGER-SNAPSHOT-001) sin el consumidor de `JournalEntryPosted` + DELETE de §Decisiones 9; la caché se renueva en el job diario. El verificador no cuenta estos snapshots invalidados como violación de INV-022 (no son corrupción).
4. **Política de snapshots:** una fila por cuenta con postings al **día anterior en UTC** (por defecto); la reconstrucción borra y recalcula todos los snapshots del alcance (workspace o cuenta). Reconstruir dos veces produce filas idénticas salvo `computed_at`.
5. **Saldo "actual":** sin `asOf`, `BalanceQuery` calcula al día de hoy en la zona horaria del workspace (`iam.workspace.time_zone` + `Clock`), cerrando el tercer punto de TC-LEDGER-BALANCES-002. El `FixedClock` de `pg-ledger.int.test.ts` se movió a 2026-12-31 porque sus asientos tienen fechas posteriores a la anterior (2026-03-15).
6. **Job diario** `ledger.daily-maintenance` (pg-boss cron; se habilita el timekeeper `schedule` solo en el rol `consumer`): primero `VerifyLedgerIntegrity`, después `RebuildBalanceSnapshots`. Configurable con `LEDGER_INTEGRITY_CRON` (default `0 4 * * *`, `off` lo desactiva) y `LEDGER_INTEGRITY_CRON_TZ` (default `UTC`) en el contrato de config (`docs/config-reference.md` regenerado). `JobQueue` gana `schedule`/`unschedule`; el envelope del cron se fija al programar (correlación propia de la programación).
7. **Enganche en `restore:local`:** el worker encola una ejecución al arrancar; `restore:local` ya reinicia finance-worker tras restaurar, así que la verificación corre sobre la base restaurada sin que el script dependa del código del ledger (solo informa en su log).
8. **Violaciones:** cada una → log `error` con `alert=ledger.invariant_violation`, `severity=critical`, `workspaceId`, invariante y diferencia a la escala de la moneda, + `ledger_invariant_violations_total{invariant}` (OpenTelemetry, `otelCounters` de `@pf/platform/otel`). Invariantes: INV-004 (Σ por moneda), estructura (≥ 2 postings), INV-005 (sin ceros), INV-022 (snapshot = Σ postings) e INV-008 (la reversa niega línea a línea su original).
9. **`pf/no-number-money` sintáctica** en `packages/eslint-config` (`@pf/eslint-config`): sin type-checking para no exigir typed linting en todo el monorepo; cubre `number` en nombres monetarios (también uniones), `parseFloat`/`Number`/`Number.parseFloat`/`+x` sobre montos (lo que TC-PLATFORM-ARCH-002 llamaba `pf/no-float-parse`), literales en `Money.of/parse` y `toFixed(n)`/`toNumber()`. Pierde los alias (`type Amount = number`), que siguen cubiertos por `Money` (no acepta `number`) y Spectral. `no-restricted-imports` de `decimal.js` en todo el repo salvo `packages/shared-kernel/src/money/**` (dueño de `MoneyDecimal`, donde ambas reglas se apagan: `Decimal#toFixed(dp)` es exacto). Dos usos en el fake de `policy.test.ts` de platform quedaron con `eslint-disable-next-line` justificado.
