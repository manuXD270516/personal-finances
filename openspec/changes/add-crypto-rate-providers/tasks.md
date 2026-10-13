# Tareas

> Depende de Phase 1 (FX, providers) y de Phase 2 (portabilidad). **La tarea 1.1 bloquea el grupo 4 (adapters cripto):** ningún adapter se escribe antes de que la verificación de términos esté registrada como apta (NFR-COMP-007, RISK-023, D225). Los grupos 2, 3, 5 y 6 (pares configurables, `MARKET`, pivote, umbrales) no dependen de ella. Sin consumidores nuevos (D249). No toca `debt/loans` ni `debt/amortization` (D219).

## 1. SPEC, TÉRMINOS y TEST CASES

- [ ] 1.1 **Verificar términos de uso y licencia** de las fuentes cripto candidatas (orden según la pregunta 1 de design.md): términos de la API pública de datos de mercado, licencia de los datos, atribución exigida, límites publicados, si exige clave y si permite uso automatizado; registrar el resultado (apta / no apta, fecha, URLs, atribución, límites) en un ADR nuevo **ADR-0029 "Fuentes de precios cripto"** que extiende ADR-0025. Si una candidata no califica, evaluar la siguiente. No se da por verificada ninguna fuente hasta completar esta tarea
- [ ] 1.2 Trasladar a design.md (§Decisiones 1, 5 y 9 y §Contratos) los ids de provider, endpoints, mapeos, límites y textos de atribución que fije ADR-0029
- [ ] 1.3 Revisar los deltas de `fx/market-rate-providers`, `fx/market-rates` e `identity/workspace-portability`; `openspec validate add-crypto-rate-providers --strict`
- [ ] 1.4 Revisar TC-FX-PROVIDER-020..037, TC-FX-RATE-006..008, TC-REPORTING-NETWORTH-013..014 y TC-IDENTITY-EXPORT-013 contra los scenarios (cifras a mano: 65000.00 × 12.02 = 781300.00; 0.01500000 × 781300.00 = 11719.50 BOB; 0.01500000 × 82000.00 × 10.20 = 12546.00 BOB; 217 días del 2026-03-10 al 2026-10-12); pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `DefaultRatePairs` y `AssetClassPolicy` test-first (TC-FX-PROVIDER-020, PBT con timeout explícito)
- [ ] 2.2 AR `RatePairList` (modos `DEFAULT`/`CUSTOM`, validaciones, versión; sin máquina de estados, D250) test-first (TC-FX-PROVIDER-021, TC-FX-PROVIDER-022)
- [ ] 2.3 `AnomalyDetector` con umbral por clase test-first (TC-FX-PROVIDER-032, PBT); `StalenessPolicy` con `MARKET` (TC-FX-PROVIDER-033)
- [ ] 2.4 `RateResolver`: pivote = quote del par configurado y default `MARKET` en pares cripto test-first (TC-FX-RATE-007, TC-FX-RATE-008); regresión de las cruzadas por USD
- [ ] 2.5 Descriptores de providers con estado de términos y validación de configuración (TC-FX-PROVIDER-036)

## 3. APPLICATION

- [ ] 3.1 `ConfigureRatePairs` / `GetRatePairs` con auditoría en la misma unidad de trabajo (TC-FX-PROVIDER-021)
- [ ] 3.2 Ingesta filtrada por la lista de cada workspace y cobertura `MANUAL_ONLY` (TC-FX-PROVIDER-024, TC-FX-PROVIDER-025)
- [ ] 3.3 `FirstBalanceDateQuery` en `@pf/ledger/contracts` (aditiva); `BackfillCryptoHistory` y `FillCryptoGaps` (TC-FX-PROVIDER-030, TC-FX-PROVIDER-031)
- [ ] 3.4 `GetProviderStatus` con `pairs[]` (TC-FX-PROVIDER-037)

## 4. INFRASTRUCTURE (requiere 1.1 y 1.2)

- [ ] 4.1 Adapter cripto principal (ACL, JSON Schema propio, lectura lossless, sin datos del usuario) con fixtures grabados tras la verificación (TC-FX-PROVIDER-026, TC-FX-PROVIDER-028)
- [ ] 4.2 Adapter cripto de respaldo de otro operador (TC-FX-PROVIDER-027)
- [ ] 4.3 Límites, caché y `Retry-After` persistido para los providers cripto, también en el backfill paginado (TC-FX-PROVIDER-029); solicitudes con símbolos y rangos de instalación (TC-FX-PROVIDER-034)
- [ ] 4.4 Migraciones expand-only: `fx.rate_pair_list`, `fx.rate_pair` (RLS forzada, `platform.workspace_scoped_table`), `fx.provider_history_point` (instalación), CHECKs de `rate_type` (`MARKET`) y `provider`; timestamps posteriores a la última de `main`
- [ ] 4.5 Configuración `FX_PROVIDER_CRYPTO_*`, `FX_STALE_AFTER_MARKET*`, `FX_ANOMALY_THRESHOLD_VOLATILE_PCT`, `FX_STABLECOIN_CODES`, `FX_CRYPTO_HISTORY_FROM` en el contrato único; `.env.example` con `none` hasta tener un provider verificado; `pnpm config:docs`
- [ ] 4.6 Colas y jobs en el worker sin consumidores nuevos; test de arranque del worker y presupuesto de conexiones sin cambios (TC-PLATFORM-EVENTS-018 en verde)
- [ ] 4.7 Portabilidad: secciones `fx-rate-pairs` en export e import (TC-IDENTITY-EXPORT-013)
- [ ] 4.8 Tests de integración: quitar un par conserva el histórico (TC-FX-PROVIDER-023); punto histórico del patrimonio con cierre cripto (TC-REPORTING-NETWORTH-014); `pnpm test:integration` dos veces en verde

## 5. API

- [ ] 5.1 OpenAPI: `getFxRatePairs`, `replaceFxRatePairs`, `MARKET` en `FxRateType`/`FxRateTypeInput`/`FxRatePreferenceListInput`, `FxRateProvider` como `x-extensible-enum` con `FxRateProviderInput`, `FxProviderStatusList.pairs`; `fx.RateRecorded.v1` con `MARKET` y los ids nuevos; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 5.2 Controller `fx-rate-pairs` y tests de API (TC-FX-PROVIDER-021, TC-FX-PROVIDER-022, TC-FX-PROVIDER-025, TC-FX-PROVIDER-037, TC-FX-RATE-006); atribución de cruzadas en el resumen (TC-FX-PROVIDER-035, TC-REPORTING-NETWORTH-013)

## 6. UI

- [ ] 6.1 Configuración → Tasas automáticas: lista de pares (por defecto o personalizada), cobertura por par, antigüedad de la última tasa y atribución; i18n es/en/pt; axe y móvil
- [ ] 6.2 `MARKET` en el registro manual de tasas y en la preferencia por par; atribución de componentes en la tasa cruzada del Home y del patrimonio

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E con providers simulados: el EDITOR agrega BTC/USDT, corre un ciclo y el Home muestra BTC valorado en BOB con ambas atribuciones; con `PF_E2E_PROJECT`
- [ ] 7.2 Smoke en vivo opcional (nightly, no bloqueante) de los providers cripto verificados, una solicitud por endpoint
- [ ] 7.3 Regresión: TC-FX-HISTORICAL-001/002, TC-FX-PROVIDER-001..019, TC-REPORTING-NETWORTH-\*, TC-REPORTING-DASHBOARD-\*

## 8. DOCS

- [ ] 8.1 ADR-0029 (1.1); docs/01 FR-FX-009 (pares configurables y providers cripto); docs/08 §1 (`fx.provider_history_point` como tabla de instalación); docs/10 (endpoints); docs/11 (`fx.RateRecorded.v1`); docs/config-reference.md
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-crypto-rate-providers --strict`
