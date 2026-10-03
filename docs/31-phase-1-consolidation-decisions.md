# 31 — Decisiones de consolidación de specs Phase 1

> **Estado:** Aceptado por el lead · **Fecha:** 2026-10-02 · **Relacionado:** [03-openspec-strategy.md](03-openspec-strategy.md), changes Phase 1 en `openspec/changes/`

Al redactar los 10 changes de Phase 1 aparecieron contradicciones entre documentos. Estas decisiones las resuelven; los documentos y contratos afectados se alinearon en el mismo commit.

Prioridad de fuentes ante contradicción: ARCHITECTURE.md > ADRs aceptados > specs de los changes Phase 1 (ya validados) > docs 00–30.

| ID | Tema | Decisión canónica |
|---|---|---|
| D1 | Idempotency-Key reutilizada con payload distinto | **422** `IDEMPOTENCY_KEY_REUSED` (docs/10, contrato, borrador IETF). Falta de la cabecera en POST financiero: **428** `IDEMPOTENCY_KEY_REQUIRED`. Corregir INV-027 en docs/09 (decía 409). |
| D2 | Errores de autorización | Rol insuficiente: 403 `INSUFFICIENT_ROLE`. No miembro: 403 `WORKSPACE_ACCESS_DENIED`. Eliminar `FORBIDDEN_ROLE`/`FORBIDDEN` (backlog). |
| D3 | Tipos de cuenta / tipos de institución | Lista canónica = la de docs/01 tal como la adoptó `openspec/changes/add-accounts-management/specs/accounts/*`. Alinear docs/04, docs/08, OpenAPI `AccountType`/`InstitutionKind`, evento `AccountOpened`. |
| D4 | Estados de cuenta | `ACTIVE`, `CLOSED`, `ARCHIVED` (docs/01 + spec de accounts). |
| D5 | Liquidez | Enum `liquidity: LIQUID | SEMI_LIQUID | ILLIQUID` (ARCHITECTURE §4). FR-ACCOUNTS-011 se reescribe con el enum; se elimina `includeInLiquidity`. |
| D6 | LedgerAccount de una cuenta de usuario | get-or-create al primer posting (ARCHITECTURE §7). FR-ACCOUNTS-003 se reescribe. |
| D7 | Borrado de categorías | Nunca hard delete; solo archivar (INV-019). FR-CLASSIFICATION-002 se reescribe; DELETE → 405. |
| D8 | Jerarquía de categorías | Tres niveles: grupo → categoría → subcategoría (spec de classification). Alinear docs/04, FR-CLASSIFICATION-001 y unicidad de nombre por padre en docs/08. |
| D9 | Categorías de sistema | Lista de 11 códigos del design de `add-classification` (§7) es canónica: alinear enum `systemCode` en docs/08, OpenAPI y FR-CLASSIFICATION-003. |
| D10 | Bloqueo de periodo | Mensual (docs/09); docs/08 `ledger.period_lock` por (workspace, year_month). |
| D11 | Editar una conversión | Reversa + nuevo asiento + nueva revisión de `ConversionDetail` (FR-TRANSACTIONS-024, spec de conversions). Alinear docs/08. |
| D12 | Tipos de fee de conversión | Los cinco del contrato/docs/09 (incluye `TAX`). FR-TRANSACTIONS-022 se alinea. |
| D13 | Tipos de tasa | Los de FR-FX-002 (spec `fx/market-rates`). Alinear docs/04 y docs/08. |
| D14 | Preguntas del Home | docs/00 §6 es canónico; docs/14 §9.1 se alinea. |
| D15 | `/reports/summary` en Phase 1 | Se calcula leyendo el ledger directamente (sin read models). El consolidado en BOB siempre está presente con `complete: boolean` y la lista `unconverted[]` de saldos sin tasa (spec `reporting/dashboard`). Alinear OpenAPI y docs/14. |
| D16 | Anular una transacción `reconciled` | Requiere des-reconciliar antes (docs/04, spec de transactions). FR-TRANSACTIONS-006 se alinea. |
| D17 | Ajuste de monto cero | No permitido (INV-005). FR-TRANSACTIONS-005 se alinea. |
| D18 | Enums en eventos vs OpenAPI | El OpenAPI manda: singular `GOAL`; el pago de tarjeta es una transferencia (kind `TRANSFER`), no un kind propio, salvo que la spec de transfers diga otra cosa (revisarla). |
| D19 | SQLSTATE de la BD | PF001 asiento desbalanceado, **PF002 contexto de workspace ausente (RLS)**, PF003 mutación prohibida, PF004 periodo cerrado, **PF005 menos de 2 postings**. Sin contexto la consulta FALLA (ya aplicado en docs/08, docs/12 y en la spec/TC de identity). |
| D20 | FR-LEDGER-014/015 | Pasan a **Must** en Phase 1 (NFR-DATA-008/009 son Must). |
| D21 | FR-LEDGER-013 (saldo proyectado) | Pertenece a reporting (`reporting/cash-flow-calendar`, Phase 7), no al ledger. |
| D22 | Audit | `/audit-log` es Phase 1 (tag del OpenAPI deja de decir Phase 2); docs/08 `audit.audit_log` agrega `origin` y `actor_process`. |
| D23 | Identity en docs/08/docs/12 | Agregar `iam.bff_session`, `iam.user.time_zone` (columna; el campo de API es `timezone`), `iam.workspace.fiscal_month_start_day` y `minimum_liquidity_reserve`; rol de BD `pf_bff` en docs/12. |
| D24 | Orden de implementación (docs/03 §7) | 1 `add-api-conventions` · 2 `add-workspace-identity` (incluye como primer grupo de tareas la migración del catálogo `fx.currency` + seed, porque `iam.workspace.base_currency` lo referencia; el comportamiento del catálogo sigue especificado en `fx/market-rates`) · 3 `add-audit-trail` · 4 `add-ledger-core` · 5 `add-classification` · 6 `add-accounts-management` · 7 `add-transaction-recording` · 8 `add-transfers` · 9 `add-manual-conversions` · 10 `add-basic-dashboard`. |
| D25 | Catálogo de invariantes en tests/cases/README | Rango INV-001..034. |
| D26 | Valoración USDT↔BOB en el dashboard | Phase 1: última tasa manual a la fecha (explícita y auditable). El promedio de conversiones propias queda como pregunta abierta para el owner (Phase 5). |

## Decisiones del owner (2026-10-02)

| ID | Tema | Decisión |
|---|---|---|
| D27 | Pago de tarjeta y pagos QR | El pago de tarjeta de crédito es una **transferencia** ASSET→LIABILITY (no un tipo propio). Se agrega a toda transacción un **medio de pago** (`paymentMethod`: `CASH`, `QR`, `DEBIT_CARD`, `CREDIT_CARD`, `BANK_TRANSFER`, `DIGITAL_WALLET`, `OTHER`). Los pagos **QR** (QR Simple interoperable de la banca boliviana) se modelan con ese atributo: compra pagada con QR = gasto que debita la cuenta de origen del QR; cobro por QR = ingreso; QR entre cuentas propias o pago de tarjeta por QR = transferencia con `paymentMethod: QR`. El medio de pago no altera el ledger. |
| D28 | Historial visible para VIEWER | VIEWER puede ver el **historial de una transacción** que puede ver (quién, cuándo, qué cambió, versión) mediante una vista por transacción. El log de auditoría global (`/audit-log`) sigue restringido a EDITOR/OWNER. |
| D29 | Tipo de cambio paralelo (dólar blue) | Phase 1 incorpora **providers automáticos** (se adelanta desde Phase 5): principal **paralelo.bo** (mediana P2P USDT/BOB, CC-BY 4.0 con atribución visible, histórico diario desde 2024-08), respaldo **bo.dolarapi.com** (Binance P2P + oficial BCB, MIT). La tasa paralela se usa para valorar USD y USDT en BOB en el dashboard; la tasa manual sigue disponible y prevalece cuando el usuario la registra para una operación concreta. Detalle y riesgos en ADR-0025. |

## Decisiones de plataforma (2026-10-03)

| ID | Tema | Decisión |
|---|---|---|
| D30 | Outbox transaccional | **El outbox es un change de plataforma propio** (`add-event-outbox`, capability `platform/event-delivery`, orden 2b en docs/03 §7, antes de `add-audit-trail`). Ningún change de negocio crea `platform.outbox`/`inbox`/`dead_letter` ni el relay: todos los productores y consumidores de Phase 1 los reutilizan. Implementa ADR-0008 con su enmienda (pg-boss detrás de `JobQueue`, cola por consumidor con `key_strict_fifo` por `aggregateId`, encolado en la transacción del relay) y cierra la tarea 6.3 de `add-workspace-identity`. El worker se conecta con el rol `pf_worker` (`WORKER_DATABASE_URL`). |
