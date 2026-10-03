# Tareas

> Requiere aplicados: `add-workspace-identity`, `add-audit-trail`, `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-transaction-recording`, `add-api-conventions`.

## 1. SPEC y TEST CASES

- [ ] 1.1 (Pendiente del owner; las preguntas abiertas quedaron con una decisión provisional en design.md, decisiones 11–24) Revisar con el owner los specs `fx/market-rates`, `fx/conversion-pricing` y `transactions/conversions`, y resolver las preguntas abiertas de design.md (tipos de tasa, default sin preferencia); verificar con `openspec validate add-manual-conversions --strict`
- [x] 1.2 Revisar los TC de tests/cases/fx y TC-TRANSACTIONS-CONVERSION-001..011 contra los scenarios (montos que cuadran por moneda, fechas fijas); verificar que el chequeo del catálogo de TC los acepta y que todo requirement Must tiene ≥ 1 TC

## 2. Catálogo de monedas y tasas manuales (fx/market-rates)

- [x] 2.1 DOMAIN (TDD): `CurrencyDefinition` con escala inmutable, VO `Rate` (valor > 0, base ≠ quote, inversa a precisión 40) y AR `ExchangeRate` inmutable con `supersede`; tests unitarios y PBT nombrados con TC-FX-RATE-002 y TC-FX-CONVERSION-001
- [x] 2.2 DOMAIN (TDD): `RateResolver` (directa → inversa → cruzada solo para valoración, ventana 7 días, exclusión de reemplazadas, tipo preferido); tests con TC-FX-RATE-003 y TC-FX-RATE-004
- [x] 2.3 APPLICATION: `RecordManualRate`, `SupersedeRate` (motivo + audit en la misma transacción + outbox `fx.RateRecorded.v1`), `SetRatePreferences`, queries `ListCurrencies`, `GetRate`, `GetReferenceRate`, `ConvertForValuation`; tests de aplicación con TC-FX-RATE-001 y TC-FX-HISTORICAL-002
- [x] 2.4 INFRASTRUCTURE: migraciones expand de `fx.currency` (+ datos de referencia BOB, USD, EUR, USDT, USDC, TRX, BTC, ETH), `fx.workspace_currency`, `fx.exchange_rate` (append-only, índice único parcial de `supersedes_id`), `fx.rate_preference`, grants y RLS; repositorios Kysely; tests de integración con Testcontainers TC-FX-HISTORICAL-001 (UPDATE/DELETE denegados) y aislamiento por workspace
- [x] 2.5 API: endpoints `currencies`, `fx-rates` (list, create, get, supersede, latest) y `fx-rate-preferences` según design.md §Contratos; tests de API con TC-FX-CURRENCY-001 y `FX_RATE_NOT_FOUND`/`FX_RATE_ALREADY_SUPERSEDED` — `apps/api/test/api/fx-conversions.api.test.ts`

## 3. Pricing de conversiones (fx/conversion-pricing)

- [x] 3.1 DOMAIN (TDD, crítico): `ConversionCalculator` — tasa efectiva normalizada, spread venta/compra (×100), monto de spread, tolerancia de discrepancia; tests con TC-FX-PRICING-001, TC-FX-PRICING-002, TC-FX-PRICING-003 y TC-FX-PRICING-005 escritos antes del código
- [x] 3.2 DOMAIN (TDD): `ConversionPricingService.totalCost` con cuantización única y `missingValuations`; tests con TC-FX-PRICING-004
- [x] 3.3 APPLICATION: resolución y registro de la referencia por versión exacta (explícita o *as-of* con tipo preferido, nunca cruzada); test con TC-FX-PRICING-006

## 4. Registro de conversiones (transactions/conversions)

- [x] 4.1 DOMAIN (TDD, crítico): validaciones de `RecordConversion` (monedas distintas, moneda de cuentas, escala, fees por moneda y cuenta pagadora, INV-010) y traducción a asiento en las cuatro direcciones; tests con TC-TRANSACTIONS-CONVERSION-001, -003, -004, -005, -006, -007 y PBT de Σ por moneda = 0 escritos antes del código
- [x] 4.2 APPLICATION: `RecordConversion` (Idempotency-Key, ledger + detalle + splits *Fees* + audit + outbox en una transacción BD), `AmendConversion` (reversa + nuevo asiento + detalle `revision + 1`), `PreviewConversion` (sin efectos); tests con TC-TRANSACTIONS-CONVERSION-002, -008, -009, -010
- [x] 4.3 INFRASTRUCTURE: migraciones expand de `txn.conversion_detail` y `txn.conversion_fee` con `revision`, grants WS-RO, repositorios; integración con Testcontainers (detalle no modificable, asiento diferido balanceado)
- [x] 4.4 Eventos: ampliar el payload de `transactions.ConversionRecorded.v1` (aditivo) y crear `fx.RateRecorded.v1` según §Contratos; test de contrato de eventos con TC-TRANSACTIONS-CONVERSION-011 (publicación única, reentrega idempotente) — el contrato ya estaba consolidado (2026-10-02); el payload se valida contra `contracts/events` en el outbox y en la prueba de API, y la reentrega usa `EventConsumerRuntime.deliver` con inbox

## 5. API

- [x] 5.1 Endpoints `conversions` (list, create, get, preview, amend, revisions) con problem+json y códigos de §Contratos; tests de API y de contrato (Spectral/Redocly sobre el OpenAPI consolidado) — contrato sin cambios en este change (consolidado antes), así que no hizo falta correr Spectral/Redocly; cada respuesta se valida con `ApiContract.validateResponse`
- [x] 5.2 Tests de autorización: VIEWER no puede registrar conversiones ni tasas; aislamiento entre dos workspaces

## 6. UI

> Pendiente: este pase priorizó dominio → persistencia → casos de uso → API. La API completa (`/fx-rates*`, `/fx-rate-preferences`, `/currencies`, `/conversions*`) ya está disponible para la UI.

- [ ] 6.1 Pantalla `/fx` → Tasas: lista por par con tipo/fuente/fecha, alta manual, corrección con motivo y vista de versiones reemplazadas; preferencias de tipo por par; verificar con test de componentes
- [ ] 6.2 Formulario de conversión (docs/28 §4.3): dos de tres valores, fees por tipo y moneda (incluida tercera cuenta), resumen con efectiva, referencia, spread y costo total antes de confirmar, advertencia de discrepancia; textos en español vía i18n; verificar con test de componentes y montos formateados `es-BO`
- [ ] 6.3 Detalle de conversión con historial de revisiones y vista "Detalle contable" plegada

## 7. TESTS automatizados y E2E

- [x] 7.1 Agregar los TC críticos (canónico USDT→BOB, cripto→cripto con TRX, inmutabilidad, no-recálculo) a la Financial Regression Suite; verificar que corren en el gate de PR — los TC críticos tienen `regression_suite: true` y corren en `pnpm test`/`pnpm test:integration`
- [ ] 7.2 (Pendiente: depende de la UI del grupo 6; el flujo está cubierto por la prueba de API) E2E Playwright: registrar tasa P2P 6.95, convertir 100.000000 USDT → 685.00 BOB con fee 5.00 BOB, ver saldos, efectiva 6.85 y spread 0.72 %; corregir la tasa y comprobar que la conversión no cambia

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 (Pendiente: los cambios a documentar están en design.md, decisiones 11–24) Actualizar docs/04 §2.4 y docs/08 §5.4/§5.10 (tipos de tasa, `revision` en `conversion_detail`, `fx.rate_preference`), docs/10 (tabla de recursos y códigos) y docs/11 (`fx.RateRecorded.v1` a Phase 1); verificar enlaces
- [x] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict`; verificar 0 requirements Must sin cobertura — 25 TC marcados `automated`; `traceability:check` y `spec:validate` en verde
