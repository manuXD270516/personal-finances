# ADR-0029: Fuentes de precios cripto — Binance como principal y Bybit como respaldo, con Bitget sin habilitar

- Estado: Propuesto (2026-10-13; lo acepta el owner, ver [docs/42](../42-phase-5-owner-answers-and-decisions.md) preguntas 1–3)
- Fecha: 2026-10-13
- Decisores: Owner (Product/Tech Lead)
- Relacionado: Extiende [ADR-0025](0025-fuentes-de-tipo-de-cambio-bolivia.md); docs/41-phase-5-consolidation-decisions.md (D225–D229); docs/42-phase-5-owner-answers-and-decisions.md (D251); docs/26-risk-register.md (RISK-023); [ADR-0027](0027-destino-de-despliegue-inicial-vps-compose.md) (VPS N1 en `sa-east-1`); OpenSpec change `add-crypto-rate-providers` (capabilities `fx/market-rate-providers`, `fx/market-rates`), tareas 1.1, 1.2 y 1.5

## Contexto y problema

El change `add-crypto-rate-providers` registra precios spot de cada criptomoneda del catálogo frente a USDT como tasas `MARKET` (D226, D227), con un provider principal y un respaldo de otro operador (D225), y cierres diarios para el histórico (D229). D225 exige que cada fuente pase antes del adapter una verificación de términos de uso y licencia registrada en un ADR (NFR-COMP-007, RISK-023). El owner indicó el 2026-10-13 que sus exchanges son **Binance, Bitget y Bybit** (D251); se verifican esos tres.

Hay que decidir, por exchange: si su API pública de datos de mercado sirve sin clave para precio spot e histórico diario, qué dicen sus términos sobre uso automatizado, almacenamiento, redistribución y atribución, qué límites publica, si hay restricciones geográficas relevantes (Bolivia, el VPS de ADR-0027 y los runners de CI) y cuál queda como principal y cuál como respaldo.

## Drivers de decisión

- Términos que permitan el uso automatizado personal, verificables y registrados (NFR-COMP-007).
- Precio spot e histórico diario sin clave ni cuenta, con lectura exacta (INV-001, ADR-0006).
- Respaldo de **otro operador** (fallas no correlacionadas, D225).
- Privacidad: solicitudes idénticas para cualquier workspace (FR-FX-015, NFR-COMP-001).
- Límites publicados respetables con holgura por un único proceso (FR-FX-017).
- Accesibilidad desde donde corre el worker (VPS N1 en São Paulo) y desde Bolivia.
- **No declarar apta una fuente sin evidencia.**

## Método y alcance de la verificación (2026-10-13)

- **Fuente primaria leída completa:** documentación oficial de las APIs publicada por los propios exchanges en GitHub (repositorios `binance/binance-spot-api-docs` y `bybit-exchange/docs`).
- **Extractos de páginas oficiales:** los dominios `binance.com`, `bybit.com`, `bybitglobal.com`, `bitget.com` y `developers.binance.com` **no resolvieron** desde el entorno de diseño (ni por navegador ni por HTTP). De sus términos solo se obtuvieron extractos indexados por un buscador. Se citan como tales.
- **Fuentes secundarias:** guías y foros de terceros; se usan solo como indicio y se marcan.
- No se hizo ninguna solicitud en vivo a las APIs: las respuestas de ejemplo provienen de la documentación oficial. La lectura del texto vigente de los términos, la grabación de fixtures y la prueba de alcance desde el VPS quedan para la tarea 1.5 del change (condición C2).

## Opciones consideradas

1. **Principal Binance + respaldo Bybit** (recomendada).
2. **Principal Bybit + respaldo Binance.**
3. **Principal Binance + respaldo Bitget.**
4. **Un agregador (p. ej. CoinGecko) como respaldo.** Lo preveía la pregunta 1 del design, pero D251 fija los exchanges del owner. No se evaluó en esta verificación.
5. **Solo tasas `MARKET` manuales.** Es el estado actual y queda como fallback permanente.

## Resultado por exchange

| Exchange | Resultado | Evidencia técnica | Evidencia de términos |
|---|---|---|---|
| Binance (`CRYPTO_BINANCE`) | **Apta con condiciones** (C1–C4) | Primaria, leída: endpoints públicos (`security type NONE`), host de solo datos de mercado sin clave, pesos, límites y formato de klines. | Indirecta: extractos de términos de entidades de Binance que prohíben, sin consentimiento escrito, los servicios de *data feed* o *streaming* y los servicios comerciales construidos sobre sus datos. No se leyó el texto vigente de `binance.com/en/terms`. |
| Bybit (`CRYPTO_BYBIT`) | **Apta con condiciones** (C1–C4) | Primaria, leída: tickers spot, kline diario, URLs de mainnet y límite por IP. Que los endpoints de mercado no exigen clave consta en fuentes secundarias, no en la página leída. | Extracto de la página oficial *API Terms*: licencia limitada, no exclusiva y revocable; prohíbe reempaquetar o revender la API o los *Service Data*. La lista oficial de países excluidos no incluye a Bolivia. |
| Bitget (`CRYPTO_BITGET`, reservado) | **No verificada: no se habilita** | Extractos: `GET /api/v2/spot/market/candles` con límite de 20 solicitudes/s por IP. El endpoint de tickers v2 y su formato solo constan en fuentes secundarias. | Extracto de *API Key Terms*: prohíbe reempaquetar o revender los servicios o los datos de la API. La lista de países prohibidos de sus términos no se pudo leer; no hay evidencia sobre Bolivia. |

**Condiciones de Binance y Bybit:**

- **C1. Uso personal sin redistribución:** PFOS muestra el precio solo a los miembros de la instancia del owner, con atribución, y no lo publica, revende ni ofrece como feed. Antes de ofrecer PFOS a terceros se pide consentimiento escrito a cada exchange (como con paralelo.bo, ADR-0025).
- **C2. Lectura directa antes de habilitar:** desde una red con acceso, se lee el texto vigente de los términos generales y de API, se graban los fixtures de contrato y se registra el resultado con fecha en las Notas (tarea 1.5). Solo entonces el descriptor pasa a `VERIFIED`. Si el texto vigente prohíbe el uso automatizado personal, la fuente pasa a `REJECTED` y se evalúa la siguiente (Bitget).
- **C3. Alcance geográfico:** se comprueba desde el VPS N1 (`sa-east-1`, São Paulo) que ambos hosts responden; un 451 o 403 de origen geográfico se trata como falla del provider, nunca se elude con proxies ni VPN.
- **C4. Solo datos públicos:** sin claves, cuentas ni endpoints privados; sin P2P.

## Decisión (propuesta)

- **Principal — Binance (`CRYPTO_BINANCE`)** sobre el host de solo datos de mercado `https://data-api.binance.vision`.
- **Respaldo — Bybit (`CRYPTO_BYBIT`)** sobre `https://api.bybit.com`. Es otro operador.
- **Bitget (`CRYPTO_BITGET`)**: id reservado como candidata siguiente, sin adapter ni descriptor `VERIFIED`.
- **USDT/BOB y P2P:** no se integra ningún endpoint P2P (no es API pública estable; ADR-0025 opción 4). USDT/BOB sigue con paralelo.bo, que ya es la mediana P2P de Binance, Bybit y Bitget. Ningún exchange publica precio spot de cripto en BOB.
- Símbolos: cada código `CRYPTO` no estable del catálogo global con sufijo `USDT` (`BTCUSDT`, `ETHUSDT`). Un símbolo que el exchange no lista no se publica, y el par queda cubierto por el respaldo o `MANUAL_ONLY`.

### Endpoints y mapeos

| Provider | Uso | Solicitud | Mapeo |
|---|---|---|---|
| `CRYPTO_BINANCE` | Último precio (`fetchLatest`) | `GET https://data-api.binance.vision/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT"]&type=MINI` (JSON del arreglo con codificación URL; una solicitud por ciclo; peso 2 con 1–20 símbolos) | Por elemento: `symbol` → par `<BASE>/USDT`; `lastPrice` (texto) → `value` exacto; `closeTime` (ms UTC) → `asOf`. `/api/v3/ticker/price` no publica instante y no se usa. |
| `CRYPTO_BINANCE` | Histórico diario | `GET https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=<ms>&endTime=<ms>&limit=1000` (sin `timeZone` ⇒ UTC; peso 2; páginas por mes calendario UTC) | Cada vela es un arreglo: `[4]` cierre (texto) → `close`; `[6]` hora de cierre (`D T23:59:59.999Z`) → `asOf` truncado al segundo (`D T23:59:59Z`); `[0]` apertura → `day`. Se descartan las velas con hora de cierre ≥ ahora (día en curso). |
| `CRYPTO_BYBIT` | Último precio | `GET https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT` (una por símbolo) | Exige `retCode = 0`; `result.list[0].lastPrice` (texto) → `value`; `time` de primer nivel (ms) → `asOf`. Es el instante de la respuesta, porque el ticker spot no publica la hora del último trade. |
| `CRYPTO_BYBIT` | Histórico diario | `GET https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=D&start=<ms>&end=<ms>&limit=1000` | `result.list` viene en orden descendente por inicio: `[0]` inicio → `day`, `[4]` cierre → `close`, `asOf` = inicio + 1 día − 1 s. Que la vela `D` empiece a las 00:00 UTC se confirma con el fixture (tarea 1.5). |

Todas las solicitudes son `GET` anónimas, sin cookies ni credenciales, con el `User-Agent` del producto (ADR-0025). Los símbolos y rangos se derivan solo del catálogo global y de `FX_CRYPTO_HISTORY_FROM`, nunca de un workspace. Los precios llegan como **texto JSON** en ambos exchanges, y el adapter los valida con el mismo lector exacto (máximo 18 decimales, mayor que cero). Allowlist de hosts del cliente HTTP: se agregan `data-api.binance.vision` y `api.bybit.com`. Hoy el cliente rechaza toda URL con query; los adapters cripto requieren una query **fija construida por el adapter** (ver design, decisión 5).

### Límites publicados y uso de PFOS

| Provider | Límite publicado | Respuesta al exceso | Uso de PFOS |
|---|---|---|---|
| Binance | Por IP y por peso; los valores vigentes están en `rateLimits` de `/api/v3/exchangeInfo`. El ejemplo de la documentación muestra `REQUEST_WEIGHT` 6000 por minuto, pero no es una garantía. Cabecera `X-MBX-USED-WEIGHT-(intervalo)`. | 429 con `Retry-After`; si se insiste, 418 (ban de IP de 2 minutos a 3 días) con `Retry-After`. | ≤ 10 solicitudes/min (peso ≤ 20/min): 1 de último precio cada 15 min y páginas de histórico espaciadas ≥ 6 s. `Retry-After` persistido (429 y 418). |
| Bybit | 600 solicitudes en cualquier ventana de 5 s por IP, compartidas por todo el tráfico a `api.bybit.com`. | 403 "Access Denied": ban temporal de unos 30 min; si se repite, permanente. No documenta `Retry-After`. | ≤ 10 solicitudes/min. Un 403 se registra como `PROVIDER_UNAVAILABLE` con espera persistida de 30 min antes del siguiente intento. |
| Bitget | 20 solicitudes/s por IP (página de candles). | No verificado. | No se usa. |

### Atribución

Ninguno de los documentos leídos exige un texto de atribución ni declara una licencia de los datos. PFOS muestra una atribución de cortesía y trazabilidad, con uso nominativo del nombre y sin logotipos:

- `CRYPTO_BINANCE`: "Fuente: Binance", enlazado a https://www.binance.com, sin licencia.
- `CRYPTO_BYBIT`: "Fuente: Bybit", enlazado a https://www.bybit.com, sin licencia.

Si la lectura directa de C2 encuentra un texto exigido, se reemplaza aquí y en el descriptor antes de habilitar.

## Análisis de opciones

### 1. Binance principal + Bybit respaldo (recomendada)
- **Pros:** Binance tiene el mercado spot más líquido entre los tres y la documentación oficial más completa y verificable. Su host `data-api.binance.vision` es exclusivo para datos públicos y documenta que no requiere clave. Un solo ticker cubre todos los símbolos del catálogo con instante publicado, y los klines dan hasta 1000 velas por solicitud con UTC por defecto. Bybit es otro operador, documenta un límite por IP claro y sus klines tienen hasta 1000 velas. Los tres son exchanges que el owner usa.
- **Contras:** los términos se verificaron solo de forma indirecta (C2). Hay bloqueos geográficos conocidos fuera de Bolivia (EE. UU.), que afectan a CI. Bybit no publica el instante del último trade en el ticker spot.
- **Costo:** nulo. **Complejidad operativa:** media (dos adapters, histórico paginado).

### 2. Bybit principal + Binance respaldo
- **Pros:** las mismas fuentes; el límite de Bybit es más fácil de razonar.
- **Contras:** el `asOf` de Bybit es el instante de la respuesta, no el del precio, y requiere una solicitud por símbolo. Su documentación de autenticación de los endpoints de mercado es menos explícita.
- **Costo:** nulo. **Complejidad:** igual.

### 3. Binance principal + Bitget respaldo
- **Pros:** Bitget publica un límite generoso por IP.
- **Contras:** ni su documentación de API ni sus términos se pudieron leer: no hay evidencia suficiente para declararlo apto.
- **Decisión:** candidata siguiente si Binance o Bybit resultan `REJECTED` en C2.

### 4. Agregador como respaldo
- **Pros:** varias plataformas en una cifra.
- **Contras:** fuera de lo indicado por el owner (D251). Los agregadores suelen exigir clave o atribución con plan, y no se evaluó.
- **Decisión:** no se evalúa ahora.

### 5. Solo manual
- Se mantiene como fallback permanente (`MANUAL_ONLY`), no como única fuente: no cumpliría el criterio de 30 días de Phase 5 para los pares cripto.

## Consecuencias

**Positivas**
- Los pares cripto del owner pueden tener tasa `MARKET` automática e histórico diario sin claves ni cuentas.
- Fuentes coherentes con las que el owner opera y con las que alimentan la mediana P2P de paralelo.bo.

**Negativas**
- Dos dependencias externas más, sin SLA, con términos que pueden cambiar unilateralmente.
- Hasta cumplir C2, los providers quedan en `none`: los pares cripto siguen `MANUAL_ONLY`.
- El smoke en vivo desde GitHub Actions probablemente no sea concluyente para Binance y Bybit (bloqueo geográfico de EE. UU.; ver docs/42 pregunta 4).

**Riesgos** (RISK-023)
- Cambio de términos o exigencia de acuerdo → revisión en cada cambio de adapter; un `REJECTED` deshabilita la fuente sin detener el resto (TC-FX-PROVIDER-036).
- Bloqueo geográfico o de rangos de nube → falla del provider, respaldo de otro operador y C3. Prohibido eludirlo.
- Ban por exceso → presupuesto ≤ 10 solicitudes/min por exchange y `Retry-After` o espera persistidos.
- Cambio de formato → JSON Schema propio por adapter (`PROVIDER_SCHEMA_CHANGED`) y fixtures grabados.

## Licencia y atribución

- **Binance:** sin licencia de datos publicada para la API REST. Según extractos de términos de entidades de Binance, los *data feeds* y los servicios comerciales sobre sus datos requieren consentimiento escrito. Los términos de *Binance Vision* (CC BY-NC-SA 4.0 según una fuente secundaria) cubren los datasets descargables de `data.binance.vision`, que PFOS **no usa**. Atribución de cortesía: "Fuente: Binance".
- **Bybit:** la página *API Terms* define una licencia limitada y revocable y prohíbe revender los *Service Data*. No exige un texto de atribución en lo leído. Atribución de cortesía: "Fuente: Bybit".
- **Bitget:** *API Key Terms* prohíbe reempaquetar o revender los datos de la API. No se integra.

## Validación

- Tarea 1.5 del change (C2 y C3): lectura directa de los términos vigentes, fixtures grabados desde el VPS N1 o la máquina del owner y registro en estas Notas. Solo después, descriptores `VERIFIED`.
- Contract tests sin red con los fixtures: TC-FX-PROVIDER-026 (principal), -027 (respaldo), -028 (payloads inválidos), -029 (límites y `Retry-After`) y -034 (solicitudes idénticas).
- Criterio operativo de 30 días (D248): ≥ 99 % de ciclos con tasa `MARKET` no obsoleta por par cripto configurado.
- Este ADR pasa a `Aceptado` cuando el owner responda las preguntas 1–3 de docs/42.

## Notas

- **Verificación documental, 2026-10-13** (consultadas ese día):
  - Binance, documentación oficial de la API spot: https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md. Endpoints base, `data-api.binance.vision` "for APIs that only send public market data", límites por IP ("The limits on the API are based on the IPs, not the API keys"), 429/418 con `Retry-After` y bans de 2 minutos a 3 días. Pesos: `ticker/price` 2/4; `ticker/24hr` 2 con 1–20 símbolos, 40 con 21–100 y 80 sin símbolos; `klines` 2 (límite 500 por defecto y 1000 como máximo, `timeZone` por defecto UTC; el arreglo trae el cierre en `[4]` y la hora de cierre en `[6]`). `ticker/price` solo trae `symbol` y `price`.
  - Binance, host de solo datos de mercado: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md. "These URLs do not require any authentication (i.e. The API key is not necessary) and serve only public market data". Lista `/api/v3/klines`, `/api/v3/ticker/24hr` y `/api/v3/ticker/price`, entre otros. No declara términos propios.
  - Binance, términos: https://www.binance.com/en/terms no resolvió. Extractos indexados de https://www.binance.com/us-to/terms y de los términos de Binance TH (https://www.binance.th/en/terms/terms/4aefcc734230446e99bb8f47cf04851c) prohíben, sin consentimiento escrito, los servicios de *data feeding* o *streaming* sobre datos de Binance y los servicios que cobran o lucran con ellos. Antecedente secundario de la misma cláusula: https://github.com/Superalgos/Superalgos/issues/1019. Dataset Vision: https://data.binance.vision/Binance_Vision-Terms_of_Use.pdf (no resolvió; solo extracto).
  - Binance, bloqueo geográfico (fuentes secundarias): HTTP 451 "Service unavailable from a restricted location" desde IPs de EE. UU. y de nubes (https://community.vercel.com/t/binance-api-calls-on-vercel/29895, https://www.linode.com/community/questions/23972/linode-and-binancecom, https://station.railway.com/questions/deployment-is-crashing-7b190d57). No se encontró evidencia sobre `data-api.binance.vision` ni sobre Brasil o Bolivia.
  - Bybit, documentación oficial v5: https://github.com/bybit-exchange/docs (`docs/v5/market/tickers.mdx`, `docs/v5/market/kline.mdx`, `docs/v5/rate-limit.mdx` y `docs/v5/guide.mdx`). `GET /v5/market/tickers` con `category=spot` y `lastPrice` en texto. `GET /v5/market/kline` con `interval` `D` y `limit` de 1 a 1000 (200 por defecto), en orden descendente por `startTime`. "No more than 600 requests are allowed in any 5-second window" por IP; un 403 es un ban de unos 30 min. Mainnet `api.bybit.com` y `api.bytick.com`. Las páginas leídas no dicen si los endpoints de mercado requieren clave. Que no la requieren consta en fuentes secundarias (p. ej. https://jentic.com/apis/bybit-exchange) y se confirma en C2.
  - Bybit, términos: extracto de https://www.bybitglobal.com/en/help-center/article/API-Terms (licencia limitada y revocable; prohíbe reempaquetar o revender la API o los *Service Data*). Países excluidos: extracto de https://www.bybit.com/en/help-center/article/Service-Restricted-Countries (EE. UU., China continental, Hong Kong, Singapur, Canadá, Corea del Norte, Cuba, Irán, Uzbekistán, Sudán, Siria, Sebastopol y regiones de Ucrania, entre otros); **Bolivia no figura**.
  - Bitget: extractos de https://www.bitget.com/api-doc/spot/market/Get-Candle-Data ("Frequency limit: 20 times/1s (IP)"), https://www.bitget.com/support/articles/12560603797947 (*API Key Terms*: prohíbe reempaquetar o revender) y https://www.bitget.com/support/articles/360014944032-terms-of-use (lista de países prohibidos no legible). Ninguna página resolvió de forma directa.
  - Bolivia: el BCB levantó en 2024 la prohibición de 2020 sobre criptoactivos (fuente periodística: https://eldeber.com.bo/economia/el-banco-central-de-bolivia-autoriza-el-uso-de-activos-virtuales-entre-ellos-las-criptomonedas_373274/). El owner opera en los tres exchanges desde Bolivia. No se encontró una lista oficial de Binance ni de Bitget que mencione a Bolivia.
- Pendiente de C2 (tarea 1.5): texto vigente de los términos de Binance y de Bybit, respuesta real de los cuatro endpoints, inicio UTC de la vela `D` de Bybit, cabecera `X-MBX-USED-WEIGHT-1m` y `rateLimits` vigente de Binance, y respuesta desde el VPS N1.
