# Propuesta: add-conversion-cost-analysis

## Why

docs/24 §5.5 pone como objetivo de Phase 5 "analizar el costo real de convertir". Cada conversión ya guarda su tasa efectiva, su referencia, su spread y sus fees (`fx/conversion-pricing`, Phase 1), pero nada responde "¿cuánto me cuesta convertir por cada canal?": el owner no puede comparar Binance P2P con una casa de cambio ni ver cómo cambia su costo de un mes a otro. FR-FX-011 (Should) y US-183 piden el spread y los fees promedio por provider o canal, por par y por periodo. Además, el origen de tasa `USER_CONVERSION` está reservado sin uso desde Phase 1 (D26). Las reglas vienen de decisiones por omisión del owner (D231, D244–D247, D249; revertibles).

## What Changes

- **Análisis de costo de conversiones** (D244–D247): spread y fees por periodo financiero (o mes calendario), canal (contraparte de la conversión más su par de cuentas; "Sin canal" si no hay contraparte) y par, con promedio ponderado por el monto convertido valorado en la moneda de reporte con la tasa de referencia registrada; las conversiones sin referencia se excluyen y se cuentan aparte. Vista en la UI y exportación CSV. Could: spread alternativo contra la compra o venta paralela del día.
- **Observaciones `USER_CONVERSION`** (D231, cierra D26): cada conversión posteada se registra como observación inmutable de su par (tasa efectiva), visible en el historial y **nunca** usada para valorar ni como referencia; las revisiones la reemplazan y las anulaciones la marcan. Carga inicial de las conversiones existentes.
- **Consumidor nuevo `fx.user-conversion-observations`** (D249): el único consumidor de eventos nuevo de Phase 5, para `transactions.ConversionRecorded.v1`, `transactions.ConversionRevised.v1` y `transactions.TransactionVoided.v1`. **Antes** de agregarlo, el change sube `max_connections` de Postgres y el pool del worker en la plantilla del host y valida el test de arranque del worker, en el mismo change.
- **Quién calcula** (D245): REPORTING compone el análisis sobre una consulta pública de TRANSACTIONS sobre `ConversionDetail` (contraparte, cuentas, fees, referencia); el design reevalúa apoyarse en las observaciones y lo descarta (no tienen contraparte, cuentas ni fees).
- **Fuera de alcance:** campo `channel` en la conversión (D244 lo descarta); casas de cambio como providers (change 41, en espera); trades importados de exchanges (Phase 6); reportes de costo avanzados y descomposición del patrimonio (Phase 7, D242); usar las observaciones para valorar (D231, D29).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `fx/conversion-pricing`: análisis de costo por canal, par y periodo, "Sin canal", exclusión de conversiones sin referencia, periodo financiero o mes calendario, CSV, solo lectura y aislamiento (6 requirements ADDED, Should) y spread contra la paralela del día (1 requirement ADDED, Could).
- `fx/market-rates`: observación por conversión propia (Should), nunca usada para valorar (Must) y su reemplazo o anulación (Should) (3 requirements ADDED).

## Impact

**Specs impactadas:** `fx/conversion-pricing`, `fx/market-rates`. Leídas sin cambios: `transactions/conversions`, `planning/financial-periods`, `fx/market-rate-providers` (`PARALLEL_BUY`/`PARALLEL_SELL` para el Could), `platform/event-delivery` (presupuesto de conexiones), `security/access-control`. No toca `debt/loans` ni `debt/amortization` (D219).

**Componentes/contextos impactados:** TRANSACTIONS: consulta pública `ConversionDetailQuery.listForCostAnalysis` (aditiva). REPORTING: DS puro `ConversionCostAggregator`, query `GetConversionCostAnalysis`, exportación CSV. FX: consumidor `fx.user-conversion-observations`, `RecordUserConversionObservation`, carga inicial, exclusión de `USER_CONVERSION` en `RateResolver`. PLATFORM/deploy: `max_connections` y `DATABASE_POOL_MAX` del worker en `deploy/compose/compose.prod.yaml` y `deploy/host/etc-pfos/pfos.env.example`. `apps/api`, `apps/web` (vista "Costo de conversiones"), `apps/worker` (consumidor).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `GET W/reports/conversion-costs` y `GET W/reports/conversion-costs/export` (CSV); `FxRate` con `conversionRef {transactionId, revision}` y `withdrawn` opcionales. Sin códigos de error nuevos. `pnpm contract:breaking` limpio.

**Tablas impactadas:** `fx.exchange_rate` (columnas nullables `conversion_transaction_id`, `conversion_revision`; índice único parcial por conversión y revisión); `fx.rate_withdrawal` (nueva, append-only, `workspace_id`, RLS forzada, `platform.workspace_scoped_table`, portabilidad).

**Eventos impactados:** consume `transactions.ConversionRecorded.v1`, `transactions.ConversionRevised.v1` y `transactions.TransactionVoided.v1` (ya declaran a FX como consumidor previsto o se actualiza su descripción); produce `fx.RateRecorded.v1` con `source = USER_CONVERSION` (ya admitido por el schema). Sin eventos nuevos.

**Migraciones requeridas:** expand-only (columnas nullables, índice, tabla nueva); no destructivas. Cambio de configuración de despliegue (`max_connections`, pool del worker).

**Test cases:** AÑADIDOS — TC-FX-COST-001..010 (10), TC-FX-USERCONV-001..004 (4), TC-PLATFORM-EVENTS-019 (1); total 15. MODIFICADOS — ninguno. DEPRECADOS — ninguno. Regresión: TC-FX-HISTORICAL-001/002, TC-FX-PRICING-\*, TC-PLATFORM-EVENTS-018.

**Impacto de regresión:** el historial de tasas muestra observaciones nuevas (filtro por origen); la valoración no cambia (TC de regresión del Home y del patrimonio); el worker arranca con un consumidor más y un pool mayor.

**Riesgos introducidos:** presupuesto de conexiones (el único consumidor nuevo de la fase, D249); RISK-003 (las observaciones son tasas inmutables; revisiones por reemplazo); conversiones antiguas sin referencia (se cuentan aparte); RISK-017 (valoración en moneda de reporte sin 1:1).

**Invariantes afectadas:** INV-011 (observaciones inmutables), INV-012 (montos valorados con la tasa del instante de la conversión), INV-001/002 (Decimal con moneda, HALF_EVEN solo al presentar), INV-025 (aislamiento), INV-028 (consumidor idempotente con inbox).
