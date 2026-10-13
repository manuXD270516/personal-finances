# Propuesta: add-crypto-rate-providers

## Why

El criterio de salida de Phase 5 (docs/24 §5.5) pide "tasas diarias de todos los pares del owner (incl. cripto) sin intervención manual por 30 días". Hoy los pares automáticos están fijos (USD/BOB y USDT/BOB de paralelo.bo y bo.dolarapi.com, ADR-0025) y el owner tiene cripto distinta de USDT (D221) que solo puede valorar con tasas manuales. US-181 (Must) pide tasas diarias automáticas de los pares configurados. El owner decidió los pares configurables por workspace (D220), la fuente de precios cripto (exchange público como principal y respaldo independiente, tras verificar términos; D225) y el tipo de tasa `MARKET` (D226); el resto se toma de las decisiones por omisión D227–D230 y D250 (revertibles).

## What Changes

- **Pares configurables por workspace** (D220, D230, D250): lista de pares automáticos por workspace, por defecto derivada de las monedas habilitadas (fiat y estables frente a la moneda base; cripto volátil frente a USDT, D227); OWNER y EDITOR la cambian con auditoría y sin máquina de estados; quitar un par deja de registrarlo y conserva su histórico. El proceso de providers registra en cada workspace solo los pares configurados.
- **Providers de precios cripto** (D225, D226, D227): adapter principal sobre la API pública de datos de mercado de un exchange (sin clave) y adapter de respaldo independiente (otro exchange o un agregador), que registran tasas `MARKET` de cada criptomoneda frente a USDT. **Ningún adapter se implementa antes de verificar y registrar sus términos de uso y licencia en un ADR** (NFR-COMP-007, RISK-023); la configuración rechaza providers sin verificación registrada.
- **Tipo de tasa `MARKET`** (D226): valor aditivo de `rateType` (`x-extensible-enum`) en la API y en `fx.RateRecorded.v1`; también se admite en tasas manuales. `PARALLEL` conserva su significado.
- **Polling, obsolescencia y anomalías** (D228): polling 15 min y obsolescencia 60 min para `MARKET` (principal y respaldo); umbral de anomalía por clase de activo, configurable: 5 % para fiat y estables, 10 % para cripto volátil.
- **Histórico** (D229): backfill de cierres diarios desde la primera fecha con saldo del workspace en esa criptomoneda, idempotente y completado a diario; las solicitudes al provider no dependen de los datos del workspace (FR-FX-015).
- **Valoración en BOB**: tasa cruzada por la moneda pivote del par configurado (USDT para BTC/USDT; D227), con atribución de cada componente; sin preferencia, los pares cripto usan `MARKET`.
- **Portabilidad**: la lista de pares entra al export e import del workspace.
- **Fuera de alcance:** casas de cambio y bancos (change 41, en espera de P14, D232); commodities e inversiones (changes 42 y 43, diferidos por D221); alertas de obsolescencia y de anomalía por NOTIFY (change 39); costo de conversiones (change 40); custodia o wallets on-chain (docs/25 W-12); historial de trades de exchanges (Phase 6); descomposición del cambio de patrimonio (Phase 7, D242). Sin consumidores de eventos nuevos.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `fx/market-rate-providers`: pares configurados por workspace, registro solo de los pares configurados, precios cripto de exchange, histórico cripto desde la primera fecha con saldo y providers habilitados solo con términos verificados (5 requirements ADDED, Must); selección con `MARKET`, anomalías por clase de activo, atribución de providers cripto y de tasas cruzadas, privacidad de las solicitudes cripto y estado por par configurado (5 requirements MODIFIED).
- `fx/market-rates`: tipo `MARKET` en el registro manual, pivote del par configurado en las tasas cruzadas y `MARKET` como tipo por defecto de los pares cripto (3 requirements MODIFIED).
- `identity/workspace-portability`: pares configurados y tasas `MARKET` en el export (1 requirement ADDED, Must).

## Impact

**Specs impactadas:** `fx/market-rate-providers`, `fx/market-rates`, `identity/workspace-portability`. Leídas sin cambios: `reporting/net-worth` y `reporting/dashboard` (valoran con el selector de FX; sus TC de regresión cubren cripto), `ledger/balances` (primera fecha con saldo por moneda), `audit/audit-trail`, `security/access-control`. No toca `debt/loans` ni `debt/amortization` (D219).

**Componentes/contextos impactados:** FX (`@pf/fx`): AR `RatePairList` (sin estados), DS `DefaultRatePairs`, `AnomalyThresholdPolicy` (por clase), `StalenessPolicy` (umbral `MARKET`), `RateResolver` (pivote del par configurado, default `MARKET`), adapters cripto (ACL) principal y de respaldo, ingesta filtrada por pares, backfill cripto con caché de instalación, `GetProviderStatus` con pares; LEDGER: consulta pública de la primera fecha con saldo por moneda (aditiva); IDENTITY: secciones de portabilidad; `apps/api` (pares y estado), `apps/web` (configuración de pares, estado, atribución), `apps/worker` (colas cripto).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `GET`/`PUT W/fx-rate-pairs` (nuevas); `FxRateType` y `FxRateTypeInput` con `MARKET`; `FxRateProvider` pasa a `x-extensible-enum` en respuestas (como `FxRateType`) con los ids de los providers cripto verificados; `FxProviderStatus` con `pairs[]`. Sin códigos de error nuevos (`CURRENCY_NOT_ENABLED`, `VALIDATION_FAILED`, `INSUFFICIENT_ROLE`, `FX_PROVIDER_CONFIG_INVALID` existen). `pnpm contract:breaking` limpio.

**Tablas impactadas:** `fx.rate_pair_list` y `fx.rate_pair` (nuevas, con `workspace_id`, RLS forzada, `platform.workspace_scoped_table`, portabilidad); `fx.provider_history_point` (nueva, de instalación, sin `workspace_id`, como `fx.provider_run`); `fx.exchange_rate` (CHECK de `rate_type` y de `provider` ampliados); `fx.rate_preference` (CHECK de `rate_type` ampliado).

**Eventos impactados:** `fx.RateRecorded.v1` aditivo: `rateType` admite `MARKET` y `provider` admite los ids de los providers cripto. Sin eventos nuevos ni consumidores nuevos.

**Migraciones requeridas:** expand-only (tablas nuevas, CHECKs ampliados, índices); no destructivas.

**Test cases:** AÑADIDOS — TC-FX-PROVIDER-020..037 (18), TC-FX-RATE-006..008 (3), TC-REPORTING-NETWORTH-013..014 (2), TC-IDENTITY-EXPORT-013 (1); total 24. MODIFICADOS — ninguno. DEPRECADOS — ninguno. Regresión obligatoria: TC-FX-HISTORICAL-001/002 (inmutabilidad), TC-FX-PROVIDER-001..019.

**Impacto de regresión:** la ingesta deja de registrar pares no configurados (con la lista por defecto, USD/BOB y USDT/BOB siguen registrándose como hoy si USD y USDT están habilitadas); valoración del Home y del patrimonio con cripto; export e import.

**Riesgos introducidos:** RISK-023 (términos, disponibilidad y formato de las fuentes cripto), RISK-003 (inmutabilidad del histórico), volatilidad que dispara anomalías (umbral por clase), límites de uso del exchange, RISK-017 (consolidación multi-moneda con tasa cruzada aproximada).

**Invariantes afectadas:** INV-011 (tasas históricas inmutables), INV-001/002 (valores Decimal exactos, nunca `number`), INV-012 (flujos y puntos históricos con la tasa de su fecha), INV-025 (aislamiento por workspace), INV-028 (sin consumidores nuevos). Sin asientos: los precios no generan entries.
