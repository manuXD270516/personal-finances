# ADR-0025: Fuentes de tipo de cambio para Bolivia — paralelo.bo como principal y bo.dolarapi.com como respaldo, adelantadas a Phase 1

- Estado: Aceptado (2026-10-02, decisión del owner)
- Fecha: 2026-10-02
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/31-phase-1-consolidation-decisions.md (D29); docs/ARCHITECTURE.md §3, §13, §14; docs/14-reporting.md §5; docs/24-roadmap.md; docs/26-risk-register.md (RISK-023, RISK-003, RISK-010); ADR-0006, ADR-0008, ADR-0023; OpenSpec change `add-market-rate-providers` (capability `fx/market-rate-providers`), `add-manual-conversions` (`fx/market-rates`), `add-basic-dashboard` (`reporting/dashboard`, `reporting/net-worth`)

## Contexto y problema

En Bolivia el valor de mercado del dólar y del USDT es la tasa **paralela** ("dólar blue"), formada principalmente en el mercado P2P de USDT/BOB, que difiere de la tasa **oficial** del BCB y se mueve a diario. El owner valora sus saldos en USD y USDT en BOB a diario. El plan original (ARCHITECTURE §13, docs/24 A2) dejaba los providers automáticos en Phase 5 y la valoración de Phase 1 con la última tasa **manual** (docs/31 D26). En la práctica, cargar la tasa a mano cada día es fricción diaria (RISK-025) y deja el dashboard valorado con tasas viejas sin que el usuario lo note.

Hay que decidir **de dónde** se obtiene la tasa paralela (y la oficial), **con qué garantías** (licencia, términos de uso, límites, privacidad, precisión) y **qué pasa cuando la fuente falla**, sin romper la regla de que el core funciona sin integraciones.

## Drivers de decisión

- Exactitud y procedencia explicable de la tasa usada para valorar (FR-FX-006, docs/14 §5).
- Licencia y términos que permitan el uso automatizado y lo hagan verificable (NFR-COMP-007, NFR-COMP-003).
- Disponibilidad de **histórico** para valorar flujos de meses pasados a la tasa de su fecha.
- Robustez: respaldo independiente, degradación a tasas manuales (el core funciona sin providers).
- Privacidad: ninguna solicitud debe enviar datos del usuario (NFR-COMP-001).
- Integridad: tasas históricas inmutables (INV-011) y dinero sin punto flotante (INV-001, ADR-0006).
- Costo y operación para un solo usuario (sin cuentas, claves ni pagos con terceros).

## Opciones consideradas

1. **paralelo.bo** como principal + **bo.dolarapi.com** como respaldo y fuente oficial (elegida).
2. **bo.dolarapi.com** sola (paralela vía casa `binance` + oficial).
3. **dolarbluebolivia.click**.
4. **Binance P2P directo** (endpoint de anuncios P2P de Binance) con mediana calculada por PFOS.
5. **Solo tasas manuales** (mantener D26 y providers en Phase 5).

## Decisión

Opción 1, adelantada a **Phase 1** (docs/31 D29):

- **Principal — paralelo.bo**: `GET https://paralelo.bo/api/v1/rate` (mediana P2P USDT/BOB de Binance, Bybit y Bitget) registrada como tasa `PARALLEL` USD/BOB y USDT/BOB; `GET https://paralelo.bo/api/v1/historical.json` para el histórico diario (desde 2024-08-06). Se usa la **mediana** (`median`); `buy`, `sell`, `spreadPct` y `sourceCount` se conservan en la respuesta cruda.
- **Respaldo y oficial — bo.dolarapi.com**: `GET https://bo.dolarapi.com/v1/dolares`; casa `binance` → `PARALLEL` (punto medio compra/venta) cuando el principal falla o está obsoleto; casa `oficial` → `OFFICIAL` USD/BOB.
- **dolarbluebolivia.click no se usa** como fuente automática; a lo sumo como contraste manual del owner.
- Integración por puerto `MarketRateProvider` con un adapter por fuente como *anti-corruption layer*, polling con pg-boss cada 15 min (configurable, mínimo 60 s; ADR-0008), parseo **lossless** de los números JSON, registro como tasas históricas inmutables con `source = PROVIDER`, provider, vigencia, instante de obtención y respuesta cruda.
- Valoración de USD/USDT en BOB: tasa `PARALLEL` del principal → respaldo → la más reciente entre la última de provider (marcada obsoleta con su antigüedad) y la última manual → monto sin convertir con advertencia. Las tasas manuales siguen disponibles y son la referencia de una operación concreta cuando el usuario las indica.
- Atribución visible "Fuente: paralelo.bo" (https://paralelo.bo, CC BY 4.0) y "Fuente: bo.dolarapi.com" donde se muestre la tasa.
- Configuración por entorno: `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL` (detalle en el design de `add-market-rate-providers`).

## Análisis de opciones

### 1. paralelo.bo + bo.dolarapi.com (elegida)
- **Pros:** paralelo.bo publica la mediana de **tres** exchanges P2P (más robusta que una sola plataforma), metodología documentada (`methodologyVersion`, `methodologyUrl`), **histórico diario** con licencia explícita **CC BY 4.0**, `openapi.json` publicado, cabeceras claras (`Cache-Control: public, max-age=60`, `Ratelimit-Limit: 60`/min, CORS `*`); sin registro ni claves. bo.dolarapi.com es open source (MIT), da la oficial y una paralela independiente como respaldo. Dos operadores distintos ⇒ fallas no correlacionadas.
- **Contras:** dos dependencias externas sin SLA; las metodologías difieren (mediana 12.02 vs punto medio 12.055 el 2026-10-02) ⇒ saltos al conmutar; bo.dolarapi.com no tiene histórico; la mediana es de USDT/BOB y se usa también como USD/BOB (convención del mercado, que el propio histórico de paralelo.bo declara como `currencyPair: "USD/BOB"`).
- **Costo:** nulo. **Complejidad operativa:** baja-media (job, estado, anomalías).

### 2. Solo bo.dolarapi.com
- **Pros:** una sola integración; oficial y paralela en una llamada; MIT.
- **Contras:** sin histórico (no permite valorar flujos pasados ni backfill); la paralela es una sola plataforma (Binance) con punto medio compra/venta; sin respaldo independiente; la licencia MIT cubre el código, no explicita términos de uso de los datos.
- **Costo:** nulo. **Complejidad:** baja. **Riesgo:** punto único de falla.

### 3. dolarbluebolivia.click
- **Pros:** endpoints públicos con la tasa blue.
- **Contras:** **sin licencia explícita** de uso de datos; el histórico completo requiere **registro** (cuenta y credenciales con un tercero, contrario a la simplicidad y a NFR-COMP-007); términos no verificables.
- **Decisión:** descartada como fuente automática; solo contraste manual.

### 4. Binance P2P directo
- **Pros:** dato primario (anuncios reales), máxima frescura.
- **Contras:** el endpoint de búsqueda de anuncios P2P no es una API pública documentada para este uso y sus términos no contemplan scraping/uso automatizado ⇒ riesgo de ToS (NFR-COMP-007) y de bloqueo; PFOS tendría que definir y mantener la metodología (filtros de monto, comerciantes, outliers); una sola plataforma; sin histórico.
- **Costo:** nulo en dinero, alto en mantenimiento. **Complejidad:** media-alta.

### 5. Solo tasas manuales
- **Pros:** cero dependencias, control total, ya especificado (`fx/market-rates`).
- **Contras:** fricción diaria (RISK-025); valoraciones con tasas viejas sin aviso salvo la ventana de 7 días; sin histórico para meses anteriores al uso del producto.
- **Decisión:** se mantiene como **fallback permanente**, no como única fuente.

## Consecuencias

**Positivas**
- El dashboard (Q1) y el patrimonio neto reflejan el valor de mercado sin intervención diaria; flujos pasados valorados con el histórico diario.
- Procedencia completa (provider, vigencia, respuesta cruda) y atribución conforme a la licencia.
- El core sigue funcionando sin providers; las tasas manuales conservan su papel en operaciones concretas.
- Se cierra la pregunta abierta de D26 / docs/14 (pregunta 9): la valoración USD/USDT↔BOB usa la tasa paralela del provider.

**Negativas**
- Nueva dependencia externa en Phase 1 (antes Phase 5) y más alcance para el único desarrollador (RISK-004): job, estado, anomalías, contract tests.
- Tasas duplicadas por workspace (una solicitud, N copias) para mantener RLS y decisiones de anomalía por workspace.

**Riesgos** (RISK-023 actualizado en docs/26)
- Caída o lentitud del provider → respaldo, última conocida marcada obsoleta, manual; ninguna request de usuario llama al provider.
- Cambio de API/formato → validación contra JSON Schema por adapter (`PROVIDER_SCHEMA_CHANGED`), contract tests con fixtures grabados, smoke en vivo nightly no bloqueante con hash de `openapi.json`.
- Cambio de términos/licencia o exigencia de acuerdo para uso comercial → revisión en cada release del adapter; PFOS es de uso personal; antes de ofrecerlo a terceros, contactar a paralelo.bo (lo piden para uso comercial o límites mayores).
- Valores erróneos o manipulados (mercado P2P delgado) → mediana de tres plataformas + detección de anomalías (variación > 5 % retenida hasta confirmación).
- Pérdida de precisión al parsear JSON → parser lossless obligatorio y test con 18 decimales (INV-001).
- Fuga de datos → solicitudes anónimas idénticas para cualquier workspace, verificadas por test (NFR-COMP-001).

## Licencia y atribución

- **paralelo.bo**: datos bajo **CC BY 4.0** (`license: "CC-BY-4.0"` en `historical.json`). Atribución requerida: "paralelo.bo (https://paralelo.bo)". PFOS muestra "Fuente: paralelo.bo" enlazado a https://paralelo.bo con la licencia CC BY 4.0 enlazada a https://creativecommons.org/licenses/by/4.0/ junto a cada tasa de esa fuente y en el pie del Home; las respuestas de la API incluyen `attribution`. No se modifica el dato (se usa la mediana tal cual; el punto medio y las inversas se calculan sobre otros datos o se indican como derivadas). Uso comercial o límites mayores: vía contacto con el proyecto.
- **bo.dolarapi.com**: código open source **MIT**; los datos no declaran licencia propia ⇒ se cita "Fuente: bo.dolarapi.com" por cortesía y trazabilidad, con uso moderado (≤ 30 solicitudes/min, caché).
- **dolarbluebolivia.click**: sin licencia explícita ⇒ no se integra.

## Validación

- Contract tests de ambos adapters contra respuestas grabadas el 2026-10-02 (sin red en CI): TC-FX-PROVIDER-001..004.
- Selección/fallback/obsolescencia/anomalías con TDD y PBT: TC-FX-PROVIDER-007, -008, -010; privacidad TC-FX-PROVIDER-013; degradación TC-FX-PROVIDER-014; límites TC-FX-PROVIDER-011; atribución TC-FX-PROVIDER-012.
- Smoke en vivo nightly no bloqueante (`pnpm fx:smoke-live`).
- Criterio operativo (30 días tras activar): ≥ 99 % de ciclos con tasa `PARALLEL` no obsoleta (principal o respaldo); 0 tasas históricas modificadas; umbrales de obsolescencia (60 min) y anomalía (5 %) recalibrados con los datos de `fx.provider_run`.
- Revisión de términos de uso por adapter registrada en estas Notas en cada cambio de adapter (NFR-COMP-007).

## Notas

- Verificado en vivo 2026-10-02 (lead): `GET https://paralelo.bo/api/v1/rate` → `{"timestamp":"2026-10-02T08:53:07.532Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}`; cabeceras `Cache-Control: public, max-age=60`, `Ratelimit-Limit: 60`, CORS `*`. `GET /api/v1/historical.json` → `currencyPair: "USD/BOB"`, `market: "parallel"`, `resolution: "daily"`, `license: "CC-BY-4.0"`, 788 puntos desde 2024-08-06. También publica `/api/v1/rate.txt` y el spec OpenAPI. **URL canónica del spec (owner, 2026-10-05, [docs/31 D46](../31-phase-1-consolidation-decisions.md)): `https://paralelo.bo/api/v1/openapi.json`** (`/openapi.json` responde 404 desde el 2026-10-04); es la que hashea el smoke en vivo.
- Verificado 2026-10-02: `GET https://bo.dolarapi.com/v1/dolares` → casa `oficial` compra 12 / venta 12 (`fechaActualizacion` 2026-10-01T00:00:00.000Z) y casa `binance` compra 12.04 / venta 12.07; existen `/v1/dolares/oficial` y `/v1/dolares/binance`; **no** existe `/v1/dolares/blue`; sin histórico. Código MIT.
- Verificado 2026-10-02: dolarbluebolivia.click expone endpoints públicos sin licencia explícita; el histórico completo requiere registro.
- Todas las fuentes devuelven montos como números JSON ⇒ el adapter parsea sin pasar por `number` (INV-001, ADR-0006).
- **Revisión de términos por adapter (NFR-COMP-007), 2026-10-03 — implementación de `add-market-rate-providers`:**
  - `ParaleloBoProvider` (`GET /api/v1/rate`, `GET /api/v1/historical.json`): cabeceras verificadas en vivo — `X-Data-License: CC-BY-4.0`, `X-Data-Source: https://paralelo.bo`, `Cache-Control: public, max-age=60` (rate) y `max-age=300` (histórico), `Ratelimit-Limit: 60`. El histórico incluye además `illustrative: false` y `generatedAt`; cada punto diario tiene `t` a las 12:00:00.000Z y el último punto es el del día en curso (instante vivo), que el adapter descarta. Uso: ≤ 60 solicitudes en cualquier ventana de 60 s, caché por `max-age`, `Retry-After` respetado y persistido, atribución "Fuente: paralelo.bo" + CC BY 4.0 en `FxRate`/`ResolvedRate`/estado. Sin cambio de términos respecto del 2026-10-02.
  - `DolarApiBoProvider` (`GET /v1/dolares`): sin licencia de datos ni límite publicados (código MIT); `Cache-Control: public, max-age=0, must-revalidate` (sin caché útil); respuesta multilínea. Uso: ≤ 30 solicitudes/min, atribución de cortesía "Fuente: bo.dolarapi.com". Observado en vivo: la `fechaActualizacion` de la casa `binance` puede ir ~2 h por detrás (12:01Z leída a las 13:54Z), así que con `FX_STALE_AFTER_PARALLEL=60m` el respaldo a menudo quedaba obsoleto; resuelto por el owner el 2026-10-03 con un umbral propio del respaldo, `FX_STALE_AFTER_FALLBACK=180m` (design del change, decisión 30). Desde la misma fecha compra/venta se registran como `PARALLEL_BUY`/`PARALLEL_SELL` (decisión 29).
  - Ambas solicitudes son `GET` anónimas sin query string, sin cookies ni credenciales, con `Accept: application/json` y `User-Agent: PFOS-fx/<versión> (+https://github.com/manuXD270516/personal-finances)` (verificado por test con servidor local).
  - Hosts permitidos: el cliente HTTP (`ProviderHttpClient`, `node:https`) solo consulta la **allowlist** `paralelo.bo` y `bo.dolarapi.com`; no sigue redirecciones (un 3xx ⇒ `PROVIDER_UNAVAILABLE`), no acepta URL con credenciales ni query y limita el cuerpo a 2 MiB. En el stack en contenedores el egress HTTPS (TCP 443) del worker debe permitir exactamente esos dos hosts (docs/31 D33; [19-local-development.md](../19-local-development.md) §6.1).
  - Uso comercial: CC BY 4.0 permite el uso comercial con atribución, pero paralelo.bo pide **contacto previo** para uso comercial o límites mayores. Mientras PFOS sea de uso personal no aplica; **antes de ofrecerlo a terceros** se contacta al proyecto y se registra aquí el resultado. bo.dolarapi.com: la licencia MIT cubre el código, no los datos; se mantiene el uso moderado y la atribución de cortesía.
  - Compra/venta (2026-10-04, docs/31 D39): `PARALLEL_BUY` = `buy` de paralelo.bo / `venta` de la casa `binance` (BOB que se pagan por 1 USD) y `PARALLEL_SELL` = `sell` / `compra`, registradas junto con la mediana con la misma vigencia y crudo. No altera los términos de uso: son campos de las mismas respuestas.
  - Próxima revisión: en cada cambio de un adapter o de su fixture de contrato, o si el smoke en vivo detecta un cambio de `https://paralelo.bo/api/v1/openapi.json` o de las cabeceras `X-Data-License`/`Ratelimit-Limit`.
- Esta decisión adelanta parte de Phase 5 (docs/24); Phase 5 conserva más providers, precios cripto/commodities y análisis de costo por provider.
