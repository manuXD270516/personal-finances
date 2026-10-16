# Diseño: add-crypto-rate-providers

## Contexto

Phase 1 dejó el puerto `MarketRateProvider`, el scheduler, el fallback, la obsolescencia, las anomalías retenidas, la atribución, el estado de providers y dos adapters (paralelo.bo y bo.dolarapi.com) con una lista **fija** de pares (USD/BOB, USDT/BOB) para todos los workspaces (ADR-0025, design de `add-market-rate-providers`). Este change generaliza esa lista a pares configurables por workspace y enchufa providers de precios cripto sobre el mismo puerto (docs/39 §B.2 "generalizar antes de multiplicar").

Decisiones que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D220 | Owner | Pares configurables por workspace; default = monedas habilitadas frente a la moneda base; el criterio de 30 días se mide sobre esa lista. |
| D221 | Owner | El owner tiene cripto distinta de USDT; qué criptomonedas usa se configura en la app (nunca en el repositorio). |
| D225 | Owner | Exchange público sin clave como principal (cierres diarios para el histórico) y agregador u otro exchange como respaldo independiente; verificación de términos registrada en un ADR antes de cada adapter; si una fuente no califica, la siguiente candidata. |
| D226 | Owner | Tipo nuevo `MARKET`, aditivo en `rateType` y en `fx.RateRecorded.v1`. |
| D251 | Owner | Los exchanges del owner son Binance, Bitget y Bybit; se verifican primero (pregunta 1 → opción (b)). Resultado en ADR-0029, aceptado por el owner el 2026-10-16 con las condiciones C1–C4 (docs/43, D256–D260). |
| D227 | Por omisión | Pares cripto contra USDT; valoración en BOB por tasa cruzada con pivote USDT (USDT/BOB paralela). |
| D228 | Por omisión | Polling 15 min, obsolescencia 60 min, anomalía 5 % fiat y estables / 10 % cripto volátil, configurables. |
| D229 | Por omisión | Backfill de cierres diarios desde la primera fecha con saldo, idempotente y completado a diario. |
| D230 | Por omisión | OWNER y EDITOR configuran, con auditoría; quitar un par conserva su histórico. |
| D250 | Por omisión | Sin máquina de estados para los pares; solo auditoría. |
| D249 | Por omisión | Sin consumidores nuevos en este change (reutiliza las colas de providers). |
| D219 | Owner | No se toca `debt/loans` ni `debt/amortization`. |

**Reconciliación D220 + D227.** D220 dice "monedas habilitadas frente a la moneda base" y D227 "pares cripto contra USDT". La lista por defecto los combina: fiat y estables habilitadas frente a la moneda base (USD/BOB, USDT/BOB); cripto volátil habilitada frente a USDT (BTC/USDT); y USDT frente a la moneda base siempre que haya un par contra USDT (pivote necesario para valorar en BOB). Es una lectura conjunta de ambas decisiones, no una decisión nueva.

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| FX | AR `RatePairList` (workspace, `mode: DEFAULT|CUSTOM`, pares, versión) | domain | Nuevo (TDD) |
| FX | DS `DefaultRatePairs(enabledCurrencies, baseCurrency, catalog)` | domain | Nuevo (TDD, PBT) |
| FX | `AssetClassPolicy` (fiat / estable / cripto volátil) y `AnomalyDetector` con umbral por clase | domain | Ampliado |
| FX | `StalenessPolicy` con `MARKET` (principal y respaldo) | domain | Ampliado |
| FX | `RateResolver`: pivote = quote del par configurado; default `MARKET` en pares cripto | application | Ampliado |
| FX | `ConfigureRatePairs`, `GetRatePairs`; ingesta filtrada por la lista de cada workspace; `BackfillCryptoHistory`, `FillCryptoGaps` | application | Nuevo / ampliado |
| FX | Adapters `<ExchangePrimary>Provider` y `<CryptoFallback>Provider` (ACL, JSON Schema propio, lectura lossless), registro de verificaciones `PROVIDER_TERMS` | infrastructure / domain | Nuevo (tras la verificación) |
| Ledger | `FirstBalanceDateQuery.byCurrency({workspaceId})` | application (contracts) | Nuevo, aditivo |
| Identity | Secciones de portabilidad `fx-rate-pairs` | infrastructure | Aditivo |
| apps/api | Controller `fx-rate-pairs`; estado de providers con `pairs[]` | interface | Nuevo / ampliado |
| apps/web | Configuración → Tasas automáticas (pares, cobertura, atribución) | interface | Nuevo |

## Objetivos / No objetivos

**Objetivos:**
- Cada par que el owner valora tiene tasa automática diaria sin intervención (criterio de salida, medido sobre la lista configurada).
- Precios cripto con procedencia, atribución y lectura exacta; histórico suficiente para la serie de patrimonio y los snapshots.
- Ninguna fuente sin términos verificados; ninguna solicitud con datos del usuario.

**No objetivos:**
- Alertas por NOTIFY (change 39). Casas de cambio (41). Commodities e inversiones (42, 43).
- Configuración de providers por workspace (sigue siendo de la instalación).
- Cotización directa en BOB de cripto (no existe en fuentes públicas habituales, docs/40 P9).

## Decisiones

1. **Verificación de términos primero (tarea 1.1) y ADR-0029.** Antes de escribir un adapter se revisan, para cada candidata, los términos de uso de la API pública de datos de mercado, la licencia de los datos, los requisitos de atribución, los límites publicados, si exige clave y si permite uso automatizado no comercial. El resultado se registra en **[ADR-0029](../../../docs/adr/0029-fuentes-de-precios-cripto.md) "Fuentes de precios cripto"**, que extiende ADR-0025. Verificación documental del 2026-10-13 sobre los exchanges del owner (D251):
   - **Principal: Binance, `CRYPTO_BINANCE`.** Apta con condiciones.
   - **Respaldo: Bybit, `CRYPTO_BYBIT`.** Apta con condiciones. Es otro operador.
   - **Bitget, `CRYPTO_BITGET`.** No verificada: no se habilita. Queda reservada como candidata siguiente si una de las otras dos resulta `REJECTED`.

   Condiciones C1–C4 de ADR-0029: uso personal sin redistribución; lectura directa del texto vigente de los términos y fixtures grabados antes de habilitar (tarea 1.5); alcance desde el VPS N1 sin eludir bloqueos geográficos; solo datos públicos, sin claves ni P2P. Mientras no se cumplan C2 y C3, los descriptores no son `VERIFIED` y `FX_PROVIDER_CRYPTO_*` sigue en `none`. ADR-0029 está **Aceptado** desde el 2026-10-16 (docs/43, D256–D260), con C1–C4 vigentes: la aceptación no habilita ninguna fuente; los descriptores pasan a `VERIFIED` solo tras la tarea 1.5.
2. **Registro de verificaciones en el dominio.** `PROVIDER_DESCRIPTORS` (Phase 1) gana `terms: {status: VERIFIED|REJECTED, verifiedOn, adr}`; `parseFxProviderSettings` rechaza un provider sin `VERIFIED` (`FX_PROVIDER_CONFIG_INVALID`, providers cripto deshabilitados, el resto sigue). Test de arquitectura: todo adapter registrado tiene descriptor `VERIFIED` (TC-FX-PROVIDER-036).
3. **Lista de pares (`RatePairList`).** Tablas `fx.rate_pair_list` (`workspace_id` PK, `mode`, `version`, `updated_by`, `updated_at`) y `fx.rate_pair` (`workspace_id`, `base_currency`, `quote_currency`, PK compuesta). Sin fila en `fx.rate_pair_list` ⇒ `mode = DEFAULT` y la lista se deriva en cada lectura con `DefaultRatePairs` (así habilitar una moneda la agrega sola); `PUT` con `mode: CUSTOM` guarda la lista explícita; `PUT` con `mode: DEFAULT` borra la lista explícita (soft: se conserva en la auditoría). Validaciones: base habilitada (`CURRENCY_NOT_ENABLED`), quote ∈ {moneda base, USDT} y base ≠ quote (`VALIDATION_FAILED`), sin repetidos. `If-Match` sobre `version`; auditoría `fx.rate_pairs.replaced` con listas anterior y nueva (allow-list `plain`), misma UoW. Sin máquina de estados ni recorrido (D250, como D178). Clase de activo: `FIAT` del catálogo ⇒ fiat; `CRYPTO` con código en `FX_STABLECOIN_CODES` (default `USDT`) ⇒ estable; resto ⇒ cripto volátil.
4. **Ingesta por pares configurados.** La solicitud al provider sigue siendo **una por ciclo** y sin datos del workspace; el bucle por workspace (decisión 3 de Phase 1) inserta solo las muestras cuyo par está en la lista del workspace. Con la lista por defecto y USD/USDT habilitadas, el comportamiento actual no cambia. Un par sin provider que lo publique se informa `coverage: MANUAL_ONLY`.
5. **Provider cripto (`fetchLatest` e histórico), ADR-0029.** El conjunto de símbolos consultados es **fijo por instalación**: todas las monedas `CRYPTO` no estables del catálogo global (hoy BTC y ETH) frente a USDT, con símbolo `<CODE>USDT`, independientemente de los pares configurados (FR-FX-015: los pares configurados son dato del workspace). Un símbolo que el exchange no lista no produce muestra. Muestra: `MARKET`, `value` = último precio publicado (texto JSON, lectura exacta, máximo 18 decimales y mayor que cero), `asOf` = instante publicado. Endpoints y mapeos:
   - **`CRYPTO_BINANCE`, último precio:** `GET https://data-api.binance.vision/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT"]&type=MINI` (arreglo JSON con codificación URL). Una solicitud por ciclo con peso 2 (1–20 símbolos). Mapeo: `symbol` → par, `lastPrice` → `value`, `closeTime` (ms) → `asOf`. `/api/v3/ticker/price` no publica instante y no se usa.
   - **`CRYPTO_BINANCE`, histórico:** `GET https://data-api.binance.vision/api/v3/klines?symbol=<S>&interval=1d&startTime=<ms>&endTime=<ms>&limit=1000`, sin `timeZone` (UTC) y con peso 2. Cada vela es un arreglo: `[0]` apertura → `day`; `[4]` → `close`; `[6]` hora de cierre (`D T23:59:59.999Z`) → `close_at`, truncada al segundo (`D T23:59:59Z`). Se descartan las velas cuya hora de cierre no pasó.
   - **`CRYPTO_BYBIT`, último precio:** `GET https://api.bybit.com/v5/market/tickers?category=spot&symbol=<S>`, una solicitud por símbolo. Exige `retCode = 0`. Mapeo: `result.list[0].lastPrice` → `value`; `time` de primer nivel (ms) → `asOf`. Es el instante de la respuesta: el ticker spot no publica la hora del último trade.
   - **`CRYPTO_BYBIT`, histórico:** `GET https://api.bybit.com/v5/market/kline?category=spot&symbol=<S>&interval=D&start=<ms>&end=<ms>&limit=1000`. La lista viene en orden descendente: `[0]` inicio → `day`; `[4]` → `close`; `close_at` = inicio + 1 día − 1 s. El inicio UTC de la vela `D` se confirma con el fixture (tarea 1.5).
   - **Cliente HTTP:** la allowlist de `ProviderHttpClient` agrega `data-api.binance.vision` y `api.bybit.com`. Hoy el cliente rechaza toda query; se admite **solo** una query fija construida por el adapter a partir de constantes de la instalación (símbolos del catálogo y límites de mes de `FX_CRYPTO_HISTORY_FROM`), nunca con datos de un workspace (TC-FX-PROVIDER-034). Se mantienen las mismas reglas: sin redirecciones, sin credenciales y con cuerpo ≤ 2 MiB.
   - **Límites (ADR-0029):** presupuesto propio ≤ 10 solicitudes/min por exchange, con páginas de histórico espaciadas ≥ 6 s. Binance limita por peso e IP (valores vigentes en `rateLimits` de `exchangeInfo`) y responde 429 o 418 con `Retry-After`, que se persiste. Bybit permite 600 solicitudes por 5 s y por IP; un 403 es un ban de unos 30 min sin `Retry-After`, así que se registra `PROVIDER_UNAVAILABLE` y se persiste una espera de 30 min.
   - **Atribución (ADR-0029):** ningún exchange publica un texto exigido ni una licencia de los datos. Se usa atribución de cortesía: `CRYPTO_BINANCE` → "Fuente: Binance" (https://www.binance.com), `CRYPTO_BYBIT` → "Fuente: Bybit" (https://www.bybit.com), ambas sin licencia. Si la tarea 1.5 encuentra un texto exigido, se reemplaza antes de habilitar.
   - El respaldo es de otro operador (fallas no correlacionadas). Un 451 o 403 por origen geográfico es una falla más del provider: nunca se elude.
6. **Histórico cripto con caché de instalación.** `fx.provider_history_point` (sin `workspace_id`; `provider`, `base`, `quote`, `day`, `close` texto exacto, `close_at`, `fetched_at`, `raw_payload`) guarda los cierres diarios del catálogo pedidos con rangos fijos de la instalación (`FX_CRYPTO_HISTORY_FROM`, default a fijar con la profundidad que ofrezca la fuente; páginas por mes calendario UTC). `BackfillCryptoHistory(workspace)` copia a `fx.exchange_rate` del workspace los cierres de cada par configurado desde `FirstBalanceDateQuery` (LEDGER, nueva, aditiva; primera fecha de posting activo por moneda) hasta ayer, solo días completos, con `asOf` = cierre publicado del día (p. ej. `D T23:59:59Z` para velas diarias UTC), sin detección de anomalías (como Phase 1). `FillCryptoGaps` corre a diario (cron de `fx.fill-rate-gaps`): actualiza la caché y completa días faltantes, incluidos los anteriores si la primera fecha con saldo retrocede. Idempotencia: índice único de Phase 1 `(workspace_id, provider, base, quote, rate_type, as_of)`.
7. **Selección y anomalías.** `StalenessPolicy`: `FX_STALE_AFTER_MARKET` (60m) y `FX_STALE_AFTER_MARKET_FALLBACK` (60m). `AnomalyDetector` usa `FX_ANOMALY_THRESHOLD_PCT` (5, fiat y estables) y `FX_ANOMALY_THRESHOLD_VOLATILE_PCT` (10, cripto volátil) según la clase de la base del par. Línea base por provider, como en Phase 1.
8. **Valoración cruzada.** `RateResolver` busca directa, inversa y, si no hay, cruzada con pivote = quote del par configurado de la moneda (USDT para BTC/USDT; USD si no hay par configurado). Cada componente con el tipo preferido de su par (BTC/USDT `MARKET` por defecto; USDT/BOB `PARALLEL`). `ResolvedRate` informa componentes, `approximate = true`, `stale` si alguna componente lo está, y las atribuciones de ambas. Ya especificado "solo para valoración" (D227); la referencia de una conversión nunca es cruzada.
9. **Configuración (contrato único, ADR-0012).** Nuevas variables: `FX_PROVIDER_CRYPTO_PRIMARY` y `FX_PROVIDER_CRYPTO_FALLBACK` (ids verificados o `none`; default `none` hasta que exista un provider verificado). Los valores previstos por ADR-0029 son `CRYPTO_BINANCE` (principal) y `CRYPTO_BYBIT` (respaldo); `CRYPTO_BITGET` es un id reservado sin adapter. Solo se aceptan cuando su descriptor es `VERIFIED`, tras la tarea 1.5. Las demás variables son `FX_STALE_AFTER_MARKET`, `FX_STALE_AFTER_MARKET_FALLBACK`, `FX_ANOMALY_THRESHOLD_VOLATILE_PCT`, `FX_STABLECOIN_CODES`, `FX_CRYPTO_HISTORY_FROM`. `docs/config-reference.md` se regenera (`pnpm config:docs`). Tests y CI con `none` (sin red).
10. **Sin consumidores nuevos (D249).** Todo corre en las colas existentes `fx.poll-market-rates`, `fx.backfill-historical-rates` y `fx.fill-rate-gaps` (con trabajos cripto en las mismas colas o colas de jobs nuevas con concurrencia 1; los jobs periódicos ya están en las conexiones reservadas del worker). Presupuesto 55/60 sin cambios; se valida con el test de arranque del worker (TC-PLATFORM-EVENTS-018).
11. **Portabilidad y RLS.** `fx.rate_pair_list` y `fx.rate_pair` con RLS forzada, registradas en `platform.workspace_scoped_table` y en las secciones de portabilidad de FX (después de monedas habilitadas); `fx.provider_history_point` es de instalación (excepción documentada en docs/08 §1, como `fx.provider_run`).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (aditivo; `pnpm contract:breaking`, Spectral y Redocly sin errores):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `getFxRatePairs` | `GET W/fx-rate-pairs` | VIEWER | 200 `FxRatePairList`; `ETag` |
| `replaceFxRatePairs` | `PUT W/fx-rate-pairs` | EDITOR | `If-Match`; body `FxRatePairListInput`; 200 `FxRatePairList`; 412, 422 (`VALIDATION_FAILED`, `CURRENCY_NOT_ENABLED`), 428 |

Schemas nuevos: `FxRatePairListInput` (`additionalProperties: false`; `mode` enum `[DEFAULT, CUSTOM]`; `pairs[{base, quote}]` requerido si `CUSTOM`, máx. 50); `FxRatePairList` (`mode`, `version`, `pairs[{base, quote, assetClass: FIAT|STABLE|VOLATILE_CRYPTO, defaultRateType, coverage: AUTOMATIC|MANUAL_ONLY, providers: FxRateProvider[]}]`); `FxRatePairStatus` (`base`, `quote`, `coverage`, `providers[]`, `lastAutomaticRateAt`, `ageSeconds`, `stale`).

Schemas modificados: `FxRateType` (`x-extensible-enum` + `MARKET`), `FxRateTypeInput` y `FxRatePreferenceListInput` (`MARKET`); `FxRateProvider` pasa de `enum` a `x-extensible-enum` en respuestas, con los ids de ADR-0029 (`CRYPTO_BINANCE`, `CRYPTO_BYBIT`) cuando sus descriptores sean `VERIFIED` (la forma `CRYPTO_<NOMBRE>` ya está en el contrato), y el parámetro `provider` de `listFxRates` usa `FxRateProviderInput` (conjunto cerrado), igual que se hizo con `FxRateType` (decisión 29 de `add-market-rate-providers`); `FxProviderStatusList` gana `pairs: FxRatePairStatus[]` (del workspace). Tag `FX`: `x-openspec-capability: fx/market-rate-providers` en las operaciones nuevas.

**`contracts/events/fx/RateRecorded.v1.schema.json`** (aditivo, misma versión): `rateType` agrega `MARKET`; `provider` agrega los ids de los providers cripto (`CRYPTO_BINANCE`, `CRYPTO_BYBIT`; patrón `CRYPTO_<NOMBRE>`); ejemplo con BTC/USDT `MARKET`. Atribución en `FxRate`, `ResolvedRate` y estado: `{text: "Fuente: Binance", url: "https://www.binance.com", license: null}` y `{text: "Fuente: Bybit", url: "https://www.bybit.com", license: null}`. README de eventos sin cambios de consumidores.

**Contratos entre módulos:** `@pf/ledger/contracts` `FirstBalanceDateQuery` (nuevo); `@pf/fx/contracts` `RatePairsQuery` (lectura, para el change 39).

## Riesgos / Trade-offs

- [Ninguna candidata califica por términos] → se informa al owner; los pares cripto quedan `MANUAL_ONLY` y el criterio de 30 días no se cumple para ellos hasta tener fuente. Con ADR-0029, Binance y Bybit son aptos con condiciones, y Bitget es la siguiente candidata si la tarea 1.5 rechaza a alguno.
- [Bloqueo geográfico] → Binance (451) y Bybit (403) bloquean IPs de EE. UU. y algunos rangos de nube (fuentes secundarias). El worker corre en `sa-east-1` (ADR-0027) y su alcance se comprueba en la tarea 1.5. El smoke nightly desde GitHub (EE. UU.) puede no ser concluyente: por D259 (2026-10-16) un 451 o 403 de origen geográfico se clasifica como "no concluyente" y no abre el aviso de revisión del adapter; la salud real se vigila con el estado de providers del VPS N1.
- [Volatilidad cripto dispara anomalías que bloquean la valoración] → umbral 10 % por clase (D228); la alerta del change 39 reduce la espera (D234, D236).
- [Tasa cruzada siempre aproximada] → se marca y se muestran componentes y atribuciones.
- [Caché de histórico de instalación sin `workspace_id`] → no contiene datos de usuario (precios públicos); excepción documentada; las tasas del workspace siguen siendo copias inmutables por workspace (decisión 3 de Phase 1).
- [Límites del exchange (por peso o por IP)] → `ProviderHttpClient` con ventana deslizante y `Retry-After` persistido (Phase 1); backfill paginado y espaciado.
- [Cambio de formato de la API] → JSON Schema propio del adapter, `PROVIDER_SCHEMA_CHANGED`, smoke en vivo nightly no bloqueante.

## Plan de migración

Expand-only: `CREATE TABLE fx.rate_pair_list`, `fx.rate_pair` (RLS forzada, grants `pf_app` SELECT/INSERT/UPDATE/DELETE sobre la lista explícita; `pf_worker` SELECT), `fx.provider_history_point` (`pf_worker` INSERT/SELECT, `pf_app` sin acceso); `ALTER TABLE … DROP CONSTRAINT/ADD CONSTRAINT` de los CHECK de `rate_type` (`MARKET`) en `fx.exchange_rate`, `fx.rate_preference` y `txn.conversion_detail` y de `provider` en `fx.exchange_rate` (ampliación de valores, sin reescritura). Timestamps posteriores a la última migración de `main`. Despliegue: migraciones → worker con `FX_PROVIDER_CRYPTO_*=none` → activar providers cripto verificados. Rollback: `none` (las tasas registradas quedan, son históricas válidas).

## Preguntas abiertas

1. **Candidatas a verificar para precios cripto** (bloquea solo los adapters, grupo 4; no bloquea la spec ni los pares configurables). D225 fija el tipo de fuente pero no cuál. Opciones: (a) **evaluar en este orden y quedarse con la primera apta: principal = API pública de datos de mercado spot de Binance, luego Kraken, luego Coinbase Exchange; respaldo = un agregador (CoinGecko), luego el siguiente exchange apto de otro operador**; (b) el owner nombra el exchange que usa y se verifica primero; (c) solo agregador. **Recomendación: (b) si el owner usa un exchange concreto; si no, (a).** Ninguna de estas fuentes está verificada todavía. **Resuelta (2026-10-13, D251):** el owner usa Binance, Bitget y Bybit; se verificaron primero (opción (b)). Resultado en ADR-0029 (Propuesto): principal `CRYPTO_BINANCE` y respaldo `CRYPTO_BYBIT`, aptos con condiciones; Bitget no verificada. Las preguntas que quedaban (aceptar ADR-0029, uso personal, lectura directa y smoke desde CI, [docs/42](../../../docs/42-phase-5-owner-answers-and-decisions.md)) se resolvieron el 2026-10-16 con la recomendación de cada una ([docs/43](../../../docs/43-phase-5-owner-answers-2026-10-16.md), D256–D259): ADR-0029 aceptado con C1–C4.
2. **`FX_CRYPTO_HISTORY_FROM`.** La caché de histórico se pide con un rango fijo de la instalación (no con la fecha del workspace, por FR-FX-015). Opciones: (a) **desde 2020-01-01** (cubre el uso realista del owner con poco volumen); (b) desde el inicio que ofrezca la fuente; (c) configurable sin default. **Recomendación: (a)**, ampliable por configuración; no bloquea.
3. **Monedas estables además de USDT.** `FX_STABLECOIN_CODES` = `USDT` por defecto. Si el owner usa USDC u otra, ¿se registra frente a la moneda base (como USDT) o frente a USDT? **Recomendación:** frente a la moneda base con umbral 5 %, solo cuando la habilite; hoy no hay otra estable en el catálogo. No bloquea.

> **Notas de la implementación (2026-10-13):** al implementar, la pregunta 1 seguía abierta y bloqueaba los adapters reales (grupo 4); no se escribió ningún adapter. Más tarde, el mismo día, quedó resuelta por D251 y ADR-0029 (ver arriba); los adapters siguen pendientes de implementación y de la tarea 1.5. Se implementó todo lo demás con un doble en memoria (`FakeCryptoProvider`) tras el puerto `CryptoRateProvider`; los ids de provider cripto siguen el patrón `CRYPTO_<NOMBRE>` y la BD solo exige esa forma (la aplicación decide qué ids se habilitan con la verificación registrada). Pregunta 2 → (a): `FX_CRYPTO_HISTORY_FROM` = `2020-01-01`, configurable. Pregunta 3 → recomendación: `FX_STABLECOIN_CODES` = `USDT`. El pivote de una moneda sin acceso a la moneda base del workspace (el worker de PLANNING) deriva solo los pares cripto contra USDT; los pares fiat usan siempre el pivote USD por defecto. Revertibles por el owner (D220, D225–D230).

> **Nota (2026-10-16):** el owner aceptó ADR-0029 (docs/43, D256–D260): principal `CRYPTO_BINANCE`, respaldo `CRYPTO_BYBIT`, uso personal sin redistribución (C1), lectura directa por la sesión de implementación desde una red con acceso (C2, tarea 1.5) y smoke desde CI "no concluyente" ante 451/403 geográficos (tarea 7.2). El 2026-10-15 aprobó el acceso a los términos (D260), pero la red del entorno de las sesiones en la nube, que solo el owner puede cambiar, sigue sin permitir los dominios de los exchanges: la tarea 1.5 sigue abierta y `FX_PROVIDER_CRYPTO_*` sigue en `none`. Nada más del diseño cambia.
