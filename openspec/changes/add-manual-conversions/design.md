# Diseño

## Contexto

Las conversiones son el caso de uso diario del owner (USDT↔BOB↔USD) y ARCHITECTURE §13 las adelanta a Phase 1. El diseño de base ya existe: ARCHITECTURE §4.2 (una entry con patas por moneda vía `EQUITY:FX_TRADING:<CCY>`), docs/09 §6.12–§6.15 (ejemplos numéricos por dirección), §7 (`ConversionDetail`, matemática de tasas y validaciones), §15.3 (secuencia), docs/04 §3.4 y §3.10, docs/05 (FX supporting, Transactions core), docs/08 §5.4 y §5.10, docs/10 §17 (ejemplo HTTP), docs/11 §3.2 (`transactions.ConversionRecorded.v1`) y ADR-0004/0006/0008/0023. Motivación: ver proposal.md — Why.

Bounded contexts y capas afectadas:

| Contexto | Agregados / servicios | Capa | Cambio |
|---|---|---|---|
| FX (`@pf/fx`) | AR `CurrencyDefinition`, AR `ExchangeRate`, AR `RatePreference` (nuevo, por workspace y par), DS `RateResolver`, DS `ConversionPricingService` | domain, application, infrastructure, interface | Nuevo módulo en modo manual |
| Transactions (`@pf/transactions`) | AR `Transaction` (kind `CONVERSION`), VO `ConversionDetail`, VO `Fee`, VO `Rate`, DS `ConversionCalculator`, DS `TransactionPostingTranslator` | domain, application, infrastructure, interface | Nuevo comando `RecordConversion`, `AmendConversion`, query `PreviewConversion` |
| Ledger (`@pf/ledger`) | `LedgerPostingPort`, `LedgerAccountResolver` (get-or-create `EQUITY:FX_TRADING:<CCY>`, `EXPENSE:<CCY>`) | — | Sin cambios de comportamiento; se consume |
| Classification | categoría de sistema *Fees* (`systemCode = FEES`) | — | Se consume vía `ClassificationValidator` |
| Audit | `AuditPort` | — | Se consume (misma transacción, INV-029) |

Puertos: Transactions usa `ReferenceRateProvider` (implementado por el adapter que llama a `@pf/fx/contracts` → `GetReferenceRate`), `AccountDirectory`, `ClassificationValidator`, `LedgerPostingPort`, `AuditPort`, `Clock`, `IdGenerator`. FX usa `ExchangeRateRepository` (append-only), `CurrencyRepository`, `RatePreferenceRepository`, `AuditPort`, `Clock`.

## Objetivos / No objetivos

**Objetivos:**
- Catálogo de monedas global con tipo y escala; datos de referencia BOB 2, USD 2, EUR 2, USDT 6, USDC 6, TRX 6, BTC 8, ETH 18.
- Tasas manuales inmutables con *supersede* auditado, resolución *as-of* (directa → inversa → cruzada solo para valoración) y preferencia de tipo por par.
- `RecordConversion` en las cuatro direcciones con fees en cualquier moneda, `ConversionDetail` inmutable versionado por revisión y pricing determinista.
- Vista previa sin efectos con los mismos cálculos (Should).

**No objetivos:**
- `MarketRateProvider`, jobs de fetch, staleness/anomalías: Phase 1, pero en el change `add-market-rate-providers` (docs/31 D29, ADR-0025), que amplía `fx.exchange_rate`, `RateResolver` y los contratos de este change de forma aditiva.
- Observación `USER_CONVERSION` como tasa de valoración (el consumidor FX de `ConversionRecorded` queda para Phase 5; en Phase 1 FX no consume el evento).
- Reporte FX/Crypto y análisis de costo agregado (Phase 5/7).

## Decisiones

1. **Una transacción, un asiento, cuatro direcciones con el mismo traductor.** `TransactionPostingTranslator` genera para `CONVERSION`: `−source` (bruto) en la cuenta origen; `+convertedSource` en `FX_TRADING:<src>`; `−grossTarget` en `FX_TRADING:<tgt>`; `+target` (neto) en la cuenta destino; por cada fee, `+fee` en `EXPENSE:<fee.ccy>` con split categoría *Fees* y, si el fee se paga desde una tercera cuenta, `−fee` en esa cuenta. Fees descontados del origen/destino no generan pata extra (ya están en la diferencia bruto/convertido o bruto/neto). El ledger valida Σ por moneda = 0 (INV-004) y el dominio valida INV-010 antes. Alternativa — dos transacciones enlazadas (salida + entrada) — descartada: rompe INV-004 por moneda dentro de una unidad y duplica la clasificación (docs/09 §7).
2. **Cálculo de tasas (`ConversionCalculator`, puro, TDD).** decimal.js precisión 40, HALF_EVEN. `effective = target / source` en orientación source→target, normalizada a la orientación de display del par (default: cripto o moneda "más fuerte" como base: `USD/BOB`, `USDT/BOB`, `BTC/USDT`) y persistida con 18 decimales. `spreadPct` con la fórmula de docs/09 §7.1 (venta: `(m − q)/m × 100`; compra: `(q − m)/m × 100`), `spreadAmount = |q − m| × convertedBaseAmount` cuantizado a la escala de la quote. Tolerancia de discrepancia: `|grossTarget − convertedSource × quoted| ≤ 1 unidad mínima` de la moneda destino; si se excede, se persiste `quotedRateDeviation = {difference: Money}` y la respuesta incluye la advertencia; los montos mandan.
3. **Costo total** (`ConversionPricingService` en FX, invocado por Transactions vía contrato). `totalCost = Σ fees valorados + spreadAmount valorado`, cada componente convertido a la moneda de reporte con la referencia al `executedAt` (misma política que `GetReferenceRate`), sin redondeo intermedio y una sola cuantización HALF_EVEN del total. Componentes sin tasa se listan en `missingValuations` y `complete = false`. El costo total **no** se persiste en `ConversionDetail` (es derivado de referencia + fees; Reporting lo recalcula con la misma referencia registrada, no con tasas nuevas).
4. **Referencia registrada por versión exacta.** `referenceFxRateId` explícito o resuelto con `RateResolver.resolveForConversion(pair, executedAt)`: solo tasas directas o inversas (nunca cruzadas, INV-032 y docs/04 §3.10), del tipo preferido del par si existe, si no la más reciente de cualquier tipo, dentro de la ventana de 7 días. Se guardan `reference_exchange_rate_id`, valor, tipo y fuente. Si la tasa luego se reemplaza, la conversión conserva el id original.
5. **`ExchangeRate` append-only con *supersede* de un solo nivel por versión.** `SupersedeRate(rateId, value, reason)` inserta una fila nueva con `supersedes_id = rateId` y los mismos par/tipo/`as_of`; un índice único parcial sobre `supersedes_id` impide reemplazar dos veces la misma versión (`FX_RATE_ALREADY_SUPERSEDED`, 409). La resolución *as-of* excluye filas reemplazadas (`NOT EXISTS` sobre `supersedes_id`). Auditoría en la misma transacción con `reason`.
6. **Preferencia de tipo por par** en tabla propia `fx.rate_preference` (workspace, base, quote, rate_type, version) en lugar de un JSON en `iam.workspace` para mantener la propiedad en FX. Sin preferencia: tasa más reciente de cualquier tipo, informando el tipo usado.
7. **Revisión del detalle.** `txn.conversion_detail` y `txn.conversion_fee` llevan `revision` (PK `(transaction_id, revision)`); `AmendConversion` = `ReverseJournalEntry` + nuevo `PostJournalEntry` + nuevo detalle con `revision + 1` en la misma transacción BD (FR-TRANSACTIONS-024, FR-TRANSACTIONS-008). El detalle vigente es el de la revisión activa. Esto **corrige** la nota de docs/08 §5.4 ("editar = void + nueva"), ver Preguntas abiertas.
8. **Eventos.** En la misma transacción que el asiento: outbox `transactions.TransactionCreated.v1`, `transactions.TransactionPosted.v1`, `transactions.ConversionRecorded.v1` (uno por revisión posteada; idempotencia natural `(transactionId, journalEntryId)`), y Ledger emite `ledger.JournalEntryPosted.v1`. FX emite `fx.RateRecorded.v1` al registrar o reemplazar una tasa (idempotencia natural `rateId`; consumidor REPORTING para invalidar la caché del dashboard por `dataVersion`). Consumidores usan `platform.inbox (consumer, event_id)` (INV-028).
9. **Idempotencia y concurrencia.** `POST /conversions`, `POST /fx-rates` y `POST /fx-rates/{id}/supersede` exigen `Idempotency-Key` (INV-027, `platform.idempotency_key`); `PUT /conversions/{id}` y `PUT /fx-rate-preferences` exigen `If-Match` (optimistic locking).
10. **Fees en tercera moneda** requieren `paidFromAccountId` cuya moneda sea la del fee; validado contra `AccountDirectory` (cuenta activa, INV-026).

Modelo de datos (schema.tabla, expand-only):

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `fx.currency` | Crear (si no existe) + migración de datos de referencia (BOB, USD, EUR, USDT, USDC, TRX, BTC, ETH). `scale` inmutable una vez usada (trigger que impide UPDATE de `scale` si hay referencias). | **G** global de solo lectura para `pf_app`; sin CUSTOM en Phase 1 |
| `fx.workspace_currency` | Crear; poblada al crear el workspace con BOB, USD, USDT | WS |
| `fx.exchange_rate` | Crear con `rate_type IN ('OFFICIAL','PARALLEL','P2P','BANK','CUSTOM')`, `source IN ('MANUAL','PROVIDER','USER_CONVERSION')`, `source_label text`, `supersede_reason text`, `supersedes_id`; `CHECK rate > 0`, `CHECK base_currency <> quote_currency`; `UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL` | **WS+G**, append-only: `GRANT SELECT, INSERT` a `pf_app`/`pf_worker`, sin UPDATE/DELETE (INV-011); policies de docs/08 §10.3 |
| `fx.rate_preference` | Crear (`workspace_id`, `base_currency`, `quote_currency`, `rate_type`, `version`; PK `(workspace_id, base_currency, quote_currency)`) | WS |
| `txn.conversion_detail` | Crear con PK `(transaction_id, revision)` y columnas de docs/08 §5.4 + `quoted_rate_deviation money NULL`, `reference_rate_type text NULL` | **WS-RO** (SELECT, INSERT) |
| `txn.conversion_fee` | Crear con `revision`, `UNIQUE (transaction_id, revision, fee_no)`, `split_id` | **WS-RO** |

## Contratos

Cambios **exactos** requeridos (los aplica el proceso de consolidación; este change no edita `contracts/`).

**`contracts/openapi/finance-api.v1.yaml`**

Operaciones nuevas:

| Método y path | operationId | Rol | Request | Respuestas |
|---|---|---|---|---|
| `GET /workspaces/{workspaceId}/fx-rates` | `listFxRates` | VIEWER | query: `base`, `quote` (`CurrencyCode`), `rateType` (`FxRateType`), `asOfFrom`, `asOfTo` (`Instant`), `includeSuperseded` (bool, default false), `Limit`, `Cursor` | 200 `FxRatePage`; 400, 401, 403 |
| `POST /workspaces/{workspaceId}/fx-rates` | `createFxRate` | EDITOR | header `IdempotencyKey`; body `FxRateCreate` | 201 `FxRate` (+`Location`, `ETag`, `Idempotent-Replayed`); 400, 401, 403, 409, 422 (`VALIDATION_FAILED`, `CURRENCY_NOT_ENABLED`), 428 |
| `GET /workspaces/{workspaceId}/fx-rates/{fxRateId}` | `getFxRate` | VIEWER | path `FxRateId` (nuevo parámetro) | 200 `FxRate`; 401, 403, 404 |
| `POST /workspaces/{workspaceId}/fx-rates/{fxRateId}/supersede` | `supersedeFxRate` | EDITOR | header `IdempotencyKey`; body `FxRateSupersede` | 201 `FxRate` (la nueva versión); 401, 403, 404, 409 (`FX_RATE_ALREADY_SUPERSEDED`), 422, 428 |
| `GET /workspaces/{workspaceId}/fx-rates/latest` | `getLatestFxRate` | VIEWER | query requeridos `base`, `quote`; opcionales `asOf` (`Instant`, default ahora), `rateType`, `allowCross` (bool, default false) | 200 `ResolvedRate`; 400, 401, 403, 422 (`FX_RATE_NOT_FOUND`) |
| `GET /workspaces/{workspaceId}/fx-rate-preferences` | `listFxRatePreferences` | VIEWER | — | 200 `FxRatePreferenceList` (+`ETag`) |
| `PUT /workspaces/{workspaceId}/fx-rate-preferences` | `replaceFxRatePreferences` | EDITOR | header `IfMatch`; body `FxRatePreferenceList` | 200 `FxRatePreferenceList`; 400, 401, 403, 412, 422, 428 |
| `POST /workspaces/{workspaceId}/conversions/preview` | `previewConversion` | VIEWER | body `ConversionPreviewRequest` (sin `Idempotency-Key`, sin efectos) | 200 `ConversionPreview`; 400, 401, 403, 422 (`CONVERSION_AMOUNTS_INCONSISTENT`, `AMOUNT_SCALE_EXCEEDED`, `CONVERSION_SAME_CURRENCY`) |
| `PUT /workspaces/{workspaceId}/conversions/{transactionId}` | `amendConversion` | EDITOR | header `IfMatch`; body `ConversionAmend` | 200 `Transaction`; 401, 403, 404, 409 (`TRANSACTION_RECONCILED`, `INVALID_STATUS_TRANSITION`, `ACCOUNT_ARCHIVED`), 412, 422, 428 |
| `GET /workspaces/{workspaceId}/conversions/{transactionId}/revisions` | `listConversionRevisions` | VIEWER | — | 200 `ConversionRevisionList`; 401, 403, 404 |

Operaciones existentes modificadas:
- `createConversion`: documentar en 422 los códigos `CONVERSION_SAME_CURRENCY`, `CONVERSION_AMOUNTS_INCONSISTENT`, `AMOUNT_SCALE_EXCEEDED`, `AMOUNT_NOT_POSITIVE`, `CURRENCY_MISMATCH`, `REFERENCE_NOT_FOUND`; en 409 `ACCOUNT_ARCHIVED`; agregar ejemplo `usdtToBtcWithTrxNetworkFee` (docs/09 §6.15).
- `listCurrencies`: sin cambios de forma; ejemplo con BOB/USD/USDT/BTC/ETH y sus escalas.

Schemas nuevos:
- `FxRateType`: enum `[OFFICIAL, PARALLEL, P2P, BANK, CUSTOM]`.
- `FxRateSource`: enum `[MANUAL, PROVIDER, USER_CONVERSION]`.
- `FxRate`: required `[id, base, quote, value, rateType, source, asOf, effectiveDate, createdAt]`; props `id` (Uuid), `base`, `quote` (CurrencyCode), `value` (PositiveDecimalString), `rateType`, `source`, `sourceLabel` (string ≤ 200), `asOf` (Instant), `effectiveDate` (LocalDate, TZ del workspace), `supersedesRateId` (Uuid|null), `supersededByRateId` (Uuid|null), `supersedeReason` (string|null), `createdAt` (Instant), `createdBy` (Uuid).
- `FxRateCreate` (additionalProperties false): required `[base, quote, value, rateType, asOf]`; `sourceLabel` opcional.
- `FxRateSupersede` (additionalProperties false): required `[value, reason]`; `reason` string 3–500; `sourceLabel` opcional.
- `FxRatePage`: `{data: FxRate[], page: PageInfo}`.
- `ResolvedRate`: required `[rate, derivation, rateType, source, asOf, ageDays, approx]`; `rate` (Rate), `fxRateId` (Uuid|null; null si `CROSS`), `derivation` enum `[DIRECT, INVERSE, CROSS]`, `components` (`FxRate[]`, para `INVERSE`/`CROSS`), `rateType`, `source`, `asOf`, `ageDays` (integer ≥ 0), `approx` (bool).
- `FxRatePreference`: `{base, quote, rateType}`; `FxRatePreferenceList`: `{data: FxRatePreference[]}`.
- `ConversionPreviewRequest` (additionalProperties false): required `[sourceCurrency, targetCurrency]` y exactamente dos de `sourceAmount` (PositiveMoney), `targetAmount` (PositiveMoney), `quotedRate` (Rate); opcionales `fees` (`ConversionFeeInput[]`, ≤ 10), `executedAt`, `referenceFxRateId`.
- `ConversionPreview`: required `[sourceAmount, convertedSourceAmount, grossTargetAmount, targetAmount, effectiveRate, totalCost]`; además `quotedRate` (Rate|null), `referenceRate` (ReferenceRate|null), `spread` (Spread|null), `quotedRateDeviation` (Money|null), `totalCost` (`ConversionCost`).
- `ConversionCost`: required `[amount, complete]`; `amount` (Money en moneda de reporte), `complete` (bool), `missingValuations` (Money[]).
- `ConversionAmend`: mismo cuerpo que `ConversionCreate` sin `id` ni `status`, más `reason` (string ≤ 500).
- `ConversionRevision`: `{revision: integer, journalEntryId: Uuid, active: boolean, createdAt: Instant, detail: ConversionDetail}`; `ConversionRevisionList`: `{data: ConversionRevision[]}`.
- Parámetro `FxRateId` (path, uuid).

Schemas existentes modificados (aditivo):
- `ConversionDetail`: agregar `revision` (integer ≥ 1), `quotedRateDeviation` (Money|null; diferencia bruto destino vs convertido×cotizada cuando supera una unidad mínima), `totalCost` (`ConversionCost`, derivado, solo en respuestas).
- `ReferenceRate`: `source` pasa de `string` libre a `FxRateSource`; agregar `rateType` (`FxRateType`) y `asOf` (Instant). Cambio de tipo de `source`: el contrato aún es borrador sin consumidores → se admite sin nueva versión de API.
- `ErrorCode`: agregar `FX_RATE_ALREADY_SUPERSEDED` (409).

**`contracts/events/`**
- `transactions/ConversionRecorded.v1.schema.json` (aditivo, misma versión, campos opcionales): en `Payload` agregar `revision` (integer ≥ 1), `convertedSource` (Money), `grossTarget` (Money), `quotedRateDeviation` (Money|null); en `$defs/ReferenceRate` agregar `rateType` (enum `OFFICIAL|PARALLEL|P2P|BANK|CUSTOM`) opcional.
- **Nuevo** `fx/RateRecorded.v1.schema.json`: `eventType = "fx.RateRecorded"`, `eventVersion = 1`, `aggregateType = "ExchangeRate"`; payload (additionalProperties false) required `[rateId, base, quote, value, rateType, source, asOf, effectiveDate, supersedesRateId]`: `rateId` (Uuid), `base`/`quote` (CurrencyCode), `value` (Decimal positivo), `rateType` (enum anterior), `source` (`MANUAL|PROVIDER|USER_CONVERSION`), `sourceLabel` (string|null), `asOf` (Instant), `effectiveDate` (LocalDate), `supersedesRateId` (Uuid|null). Productor FX; consumidor REPORTING; idempotencia natural `rateId`; PII N. Ejemplo con USDT/BOB 6.95 `P2P`.
- `README.md` de contracts/events: agregar la fila de `fx.RateRecorded.v1`.

> Consolidado en contracts/ el 2026-10-02. `add-market-rate-providers` amplía después, de forma aditiva, `FxRate`, `ResolvedRate`, `listFxRates` y `fx.RateRecorded.v1` (ver su design.md §Contratos).

## Riesgos / Trade-offs

- [Redondeo de tasas efectivas no terminantes (700.00/99.900000)] → precisión 40, persistencia a 18 decimales HALF_EVEN, PBT con fast-check sobre los cuatro tipos de dirección (RISK-001).
- [Orientación de display ambigua para pares nuevos] → regla determinista (cripto/moneda fuerte como base) documentada; configurable por workspace más adelante.
- [Tasa de referencia elegida "incorrecta" (oficial vs paralela vs P2P) en el contexto boliviano] → el tipo preferido es explícito por par y la referencia queda registrada por versión; nunca se recalcula (RISK-003, RISK-023).
- [Tabla nueva `fx.rate_preference` no prevista en docs/08] → pequeña, propiedad de FX; se documenta en docs/08 en la tarea final.
- [Costo total no persistido] → se recalcula siempre desde la referencia registrada (no desde tasas nuevas), por lo que es estable; evita duplicar verdad.

## Plan de migración

Expand-only: `CREATE TABLE` de `fx.*` y `txn.conversion_detail`/`txn.conversion_fee` (o `ALTER TABLE … ADD COLUMN revision` si `add-transaction-recording` ya creó las tablas sin ella, con backfill `revision = 1` en tablas vacías), migración de datos de referencia del catálogo (idempotente, `ON CONFLICT DO NOTHING`), grants append-only y políticas RLS. No hay datos productivos previos. Rollback: revertir el despliegue; las tablas nuevas pueden quedar (no destructivo).

Dependencias con otros changes de Phase 1 (deben aplicarse antes): `add-workspace-identity` (workspace, roles, RLS), `add-audit-trail` (AuditPort), `add-accounts-management` (cuentas y moneda), `add-ledger-core` (`LedgerPostingPort`, cuentas de sistema por moneda, reversas), `add-classification` (categoría de sistema *Fees*), `add-transaction-recording` (agregado `Transaction`, estados, revisiones, idempotencia), `add-api-conventions` (problem+json, `Idempotency-Key`, `If-Match`). `add-transfers` remite aquí los movimientos cross-currency. `add-basic-dashboard` consume las tasas (`RateResolver`) y el evento `fx.RateRecorded.v1`.

## Preguntas abiertas

- **Tipos de tasa:** FR-FX-002 (`official, parallel, p2p, bank, custom`), docs/04 §2.4 (`MID|BUY|SELL|P2P|OFFICIAL`) y docs/08 §5.10 (`MID BUY SELL P2P_MEDIAN OFFICIAL`) difieren. Este change adopta FR-FX-002; docs/04 y docs/08 deben alinearse.
- **Edición de conversión:** docs/08 §5.4 dice "editar = void + nueva" para `conversion_detail`, mientras FR-TRANSACTIONS-024 exige reversa + nueva entry + nuevo detalle en la misma transacción. Se adopta FR-TRANSACTIONS-024 con `revision` en el PK.
- **Tipos de fee:** FR-TRANSACTIONS-022 enumera `provider, network, bank, other`; docs/09 §7, contrato y evento agregan `TAX`. Se adopta el conjunto de cinco.
- **Default sin preferencia de tipo** (más reciente de cualquier tipo) — confirmar con el owner. Para USD/BOB y USDT/BOB quedó resuelto (docs/31 D29): `add-market-rate-providers` siembra la preferencia `PARALLEL` al crear el workspace; el promedio de conversiones propias se descartó como default.
- **Ventana de vigencia** (7 días) configurable por workspace: ¿setting de FX o de Reporting? Se modela en FX (`RateResolver` policy).
