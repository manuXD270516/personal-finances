# Propuesta: add-manual-conversions

## Why

El caso de uso diario del owner es convertir entre BOB, USD y USDT (P2P, casas de cambio, bancos) y, ocasionalmente, entre criptoactivos. ARCHITECTURE §13 adelanta las **conversiones manuales a Phase 1** porque el modelo de postings por moneda no se puede retro-adaptar barato y porque sin conversiones los saldos en USDT/USD quedan desconectados de los de BOB. Este change convierte en comportamiento verificable lo diseñado en ARCHITECTURE §4.2, docs/09 §6.12–§6.15 y §7, y el contexto FX en modo manual. Los providers automáticos de tasa paralela (paralelo.bo, bo.dolarapi.com) se adelantaron también a Phase 1 por decisión del owner (docs/31 D29, ADR-0025), pero viven en el change separado `add-market-rate-providers`, que se aplica después de este.

## What Changes

- **Catálogo de monedas** (FX) con tipo `FIAT`/`CRYPTO` y escala: BOB 2, USD 2, USDT 6, BTC 8, ETH 18 (más TRX 6, USDC 6 y EUR 2 como datos de referencia), con la escala inmutable una vez usada.
- **Tasas de referencia manuales** históricas e inmutables (INV-011): registro por par, instante, tipo (`OFFICIAL`, `PARALLEL`, `P2P`, `BANK`, `CUSTOM`) y fuente; corrección solo por *supersede* auditado con motivo; consulta *as-of* con ventana de 7 días y `FX_RATE_NOT_FOUND` explícito; inversa calculada desde la tasa original; tasa cruzada vía pivote solo para valoración (Should); tipo de tasa preferido por par para valorar saldos.
- **Conversiones** como **una sola transacción** `CONVERSION` con **un asiento** cuyas patas cuadran por moneda vía `EQUITY:FX_TRADING:<CCY>` (INV-004, INV-010), en las cuatro direcciones (fiat→fiat, fiat→cripto, cripto→fiat, cripto→cripto).
- **Fees por tipo** (`PROVIDER`, `NETWORK`, `BANK`, `TAX`, `OTHER`) como gasto con categoría de sistema *Fees* en la moneda en que se pagaron, incluida una tercera moneda pagada desde otra cuenta.
- **Pricing**: tasa cotizada (informativa) vs tasa efectiva (derivada de los montos reales) vs tasa de referencia (FX, versión exacta registrada); spread cuando es determinable con la fórmula de docs/09 §7.1 (×100); costo total en moneda de reporte; advertencia de discrepancia cotizada vs montos.
- **`ConversionDetail` inmutable**; nunca se recalcula una conversión histórica con tasas nuevas (INV-012); editar = reversa + nuevo asiento + nuevo detalle (el anterior se conserva).
- **Evento** `transactions.ConversionRecorded.v1` (ya catalogado; ampliación aditiva) y nuevo `fx.RateRecorded.v1`.
- **Vista previa** del cálculo (dos de tres valores) antes de confirmar (Should).
- **Fuera de alcance:** proveedores automáticos de tasas, fallback y detección de anomalías (FR-FX-009/010: Phase 1 en el change `add-market-rate-providers`, docs/31 D29); análisis agregado de costo por proveedor (FR-FX-011, Phase 5) y reporte FX/Crypto (docs/14 #13); monedas `CUSTOM`/`COMMODITY` y precios de inversiones (FR-FX-012, Phase 5); habilitar/deshabilitar monedas por workspace (`PUT currencies/{code}/enabled`, P1.x); observación de tasa derivada de las conversiones del usuario (`USER_CONVERSION`) como referencia de valoración; conversiones embebidas en compras con tarjeta (docs/09, pregunta abierta 2); importación de conversiones desde exchanges (FR-IMPORTS-014, Phase 6); adjuntar comprobantes (Phase 6); guía de transferencia cross-currency en el formulario de transferencias (pertenece a `add-transfers`).

## Capabilities

### New Capabilities
- `transactions/conversions`: registro, edición e inmutabilidad de conversiones como transacción única balanceada por moneda, con fees y detalle de precio (11 requirements).
- `fx/conversion-pricing`: tasa efectiva, spread, costo total, discrepancia cotizada y registro de la referencia usada (6 requirements).
- `fx/market-rates`: catálogo de monedas y tasas de referencia manuales inmutables con resolución *as-of* (9 requirements; solo tasas manuales en Phase 1).

### Modified Capabilities
- Ninguna (no existen specs principales previas para estas rutas).

## Impact

**Specs impactadas:** crea `transactions/conversions`, `fx/conversion-pricing` y `fx/market-rates`. Depende de requirements de `ledger/journal-posting` (asiento balanceado, reversas), `transactions/transaction-recording` (revisiones, estados, idempotencia), `classification/categories` (categoría de sistema *Fees*), `accounts/account-management` (moneda de la cuenta) y `audit/audit-trail`.

**Componentes/contextos impactados:** FX (`@pf/fx`: domain `CurrencyDefinition`, `ExchangeRate`, `RateResolver`, `ConversionPricingService`; application `RecordManualRate`, `SupersedeRate`, `SetRatePreference`, queries `GetRate`, `GetReferenceRate`, `ListCurrencies`, `ConvertForValuation`); Transactions (`@pf/transactions`: `ConversionDetail`, `ConversionCalculator`, `TransactionPostingTranslator` para `CONVERSION`, comandos `RecordConversion`, `AmendConversion`, `PreviewConversion`); Ledger (solo como consumidor del puerto `LedgerPostingPort`, sin cambios de comportamiento); `apps/api` (controllers `fx-rates`, `fx-rate-preferences`, `currencies`, `conversions`); `apps/web` (pantallas `/fx` tasas y conversiones, formulario de conversión de docs/28 §4.3).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevos `GET/POST W/fx-rates`, `GET W/fx-rates/{fxRateId}`, `POST W/fx-rates/{fxRateId}/supersede`, `GET W/fx-rates/latest`, `GET/PUT W/fx-rate-preferences`, `POST W/conversions/preview`, `PUT W/conversions/{transactionId}`, `GET W/conversions/{transactionId}/revisions`; schemas nuevos y ampliados y código `FX_RATE_ALREADY_SUPERSEDED` (detalle exacto en design.md §Contratos).

**Tablas impactadas:** `fx.currency` (+ datos de referencia), `fx.workspace_currency`, `fx.exchange_rate`, `fx.rate_preference` (nueva), `txn.conversion_detail`, `txn.conversion_fee` (con `revision`), uso de `txn.transaction`, `txn.transaction_split`, `txn.transaction_journal_link`, `ledger.journal_entry`, `ledger.posting`, `ledger.ledger_account` (cuentas de sistema `EQUITY:FX_TRADING:<CCY>` y `EXPENSE:<CCY>` get-or-create), `platform.outbox`, `platform.idempotency_key`, `audit.audit_log`.

**Eventos impactados:** produce `transactions.ConversionRecorded.v1` (ampliación aditiva del schema existente), `transactions.TransactionCreated.v1` y `transactions.TransactionPosted.v1` (kind `CONVERSION`), `ledger.JournalEntryPosted.v1`, y el nuevo `fx.RateRecorded.v1` (`contracts/events/fx/RateRecorded.v1.schema.json`).

**Migraciones requeridas:** solo **expand**, no destructivas: creación de tablas `fx.*` y `txn.conversion_detail`/`txn.conversion_fee` (si `add-transaction-recording` no las creó), migración de datos de referencia del catálogo de monedas, grants append-only y políticas RLS. Sin contract.

**Test cases:** AÑADIDOS — TC-FX-CURRENCY-001, TC-FX-RATE-001, TC-FX-RATE-002, TC-FX-RATE-003, TC-FX-RATE-004, TC-FX-HISTORICAL-002, TC-FX-PRICING-002, TC-FX-PRICING-003, TC-FX-PRICING-004, TC-FX-PRICING-005, TC-FX-PRICING-006, TC-TRANSACTIONS-CONVERSION-003, TC-TRANSACTIONS-CONVERSION-004, TC-TRANSACTIONS-CONVERSION-005, TC-TRANSACTIONS-CONVERSION-006, TC-TRANSACTIONS-CONVERSION-007, TC-TRANSACTIONS-CONVERSION-008, TC-TRANSACTIONS-CONVERSION-009, TC-TRANSACTIONS-CONVERSION-010, TC-TRANSACTIONS-CONVERSION-011. MODIFICADOS (requirement firme, `ready`) — TC-FX-CONVERSION-001, TC-FX-HISTORICAL-001, TC-FX-PRICING-001 (referencia corregida a 6.95 y spread en %), TC-TRANSACTIONS-CONVERSION-001, TC-TRANSACTIONS-CONVERSION-002. DEPRECADOS — ninguno.

**Impacto de regresión:** se suman a la Financial Regression Suite el ejemplo canónico USDT→BOB, el cripto→cripto con fee en tercera moneda, la inmutabilidad de tasas y el no-recálculo (INV-004, INV-010, INV-011, INV-012). Afecta saldos de cuentas y totales de gasto (*Fees*) que leerá `add-basic-dashboard`.

**Riesgos introducidos:** RISK-001 (redondeo de tasas y montos; mitigado con precisión 40 y cuantización única), RISK-003 (corrupción del FX histórico; mitigado con append-only + supersede + grants), RISK-017 (complejidad multi-moneda), RISK-023 (fuentes de tasa P2P/paralela volátiles; en este change el usuario elige la fuente y el tipo; los providers automáticos y su mitigación están en `add-market-rate-providers`).

**Invariantes afectadas:** INV-001, INV-002, INV-003, INV-004, INV-005, INV-006, INV-007, INV-008, INV-010, INV-011, INV-012, INV-020, INV-023, INV-024, INV-026, INV-027, INV-028, INV-029, INV-032.
