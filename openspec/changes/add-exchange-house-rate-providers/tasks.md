# Tareas

> Respuesta del owner a P14 (2026-10-13): soportar todos los bancos y billeteras de Bolivia a la fecha. El orden es incremental: **primero el catálogo, la medición y el framework (grupos 2, 3, 5 y 6, sin adapters reales); los adapters por entidad solo después de verificar y registrar sus términos (1.1 y 1.2 bloquean el grupo 4.2–4.4)**. Ningún adapter, fixture grabado ni smoke en vivo se escribe antes de que la fuente quede apta en el ADR (NFR-COMP-007, RISK-023). Los extractos del owner nunca entran al repositorio. Sin consumidores nuevos (D249). No toca `debt/loans` ni `debt/amortization` (D219). Preguntas en design.md §Preguntas abiertas.

## 1. SPEC, VERIFICACIÓN y TEST CASES

- [ ] 1.1 **Verificar en la fuente primaria** el censo y las fuentes de tasas: descargar los listados vigentes de ASFI (EIF por categoría, ESFC con ESPM y casas de cambio, ETF) y anotar fecha de corte, número por categoría y nombre, sigla y sitio de cada entidad; confirmar lo marcado "por verificar" en design.md §Investigación (cooperativas, IFD, ESPM distintas de E-Fectivo, billeteras y su entidad, Banco Unión y BDP). Para las fuentes de tasas (decisión 7): términos de uso del sitio del BCB, `robots.txt`, formato y horario de la tabla de cotización por entidad y del TCO, si publica la venta; luego, en orden, sitios de entidades y agregadores. Registrar cada resultado (apta / no apta, fecha, URLs, atribución, límites, razón) en un **ADR nuevo** (siguiente número libre; ADR-0029 es de las fuentes cripto) que extiende ADR-0025 — **Pendiente (2026-10-13):** la sesión de diseño no pudo abrir `asfi.gob.bo` ni `bcb.gob.bo` (el proxy los rechaza); hace falta una sesión con acceso o que el owner descargue los listados. No se afirma que ninguna fuente esté verificada
- [ ] 1.2 Trasladar a design.md (decisiones 7, 8 y 11 y §Contratos) los ids de proveedor, hosts, mapeos, límites y textos de atribución que fije el ADR de 1.1 — depende de 1.1
- [ ] 1.3 Revisar los deltas de `accounts/institutions`, `fx/market-rate-providers` e `identity/workspace-portability`; `openspec validate add-exchange-house-rate-providers --strict`
- [ ] 1.4 Revisar TC-ACCOUNTS-INSTCATALOG-001..010, TC-FX-INSTRATE-001..008 y TC-IDENTITY-EXPORT-014 contra los scenarios (cifras: 100.00 USD × 12.02 = 1202.00 BOB; 2 de 3 resueltas = 66.67 %); pasar a `ready` y `requirement_status: confirmed`
- [ ] 1.5 Respuestas del owner a las preguntas 1–10 de design.md (bloquean: 2 el archivo real del catálogo; 6 cualquier perfil o parser de importación) — **Espera al owner (2026-10-13)**

## 2. DOMAIN (TDD)

- [ ] 2.1 JSON Schema del catálogo y `CatalogValidator` test-first: censo por categoría, códigos únicos, fuente y fechas obligatorias, razón obligatoria en `NOT_ELIGIBLE`, `SUPPORTED` de tasas solo con proveedores `VERIFIED` (TC-ACCOUNTS-INSTCATALOG-006, TC-ACCOUNTS-INSTCATALOG-009, PBT con timeout explícito)
- [ ] 2.2 `SupportCoverage` test-first con Decimal y HALF_EVEN a 2 decimales; solo entradas `ACTIVE`; `complete` (TC-ACCOUNTS-INSTCATALOG-007, TC-ACCOUNTS-INSTCATALOG-008, PBT)
- [ ] 2.3 VO `CatalogRef` e `Institution` con vínculo opcional; regla "los tres o ninguno" (TC-ACCOUNTS-INSTCATALOG-002)
- [ ] 2.4 FX: `BANK_BUY`/`BANK_SELL`, `institutionCode` en la tasa y lectura exacta (TC-FX-INSTRATE-003, TC-FX-INSTRATE-004); `RateResolver` excluye `BANK_*` sin preferencia (TC-FX-INSTRATE-005)
- [ ] 2.5 Descriptores de proveedores por institución con `terms` y validación de configuración (como el change 38) (TC-FX-INSTRATE-001, TC-FX-INSTRATE-002)

## 3. APPLICATION

- [ ] 3.1 Puerto `InstitutionCatalogReader`; `GetInstitutionCatalog` con filtros, `adoptedInstitutionId` del workspace y cobertura (TC-ACCOUNTS-INSTCATALOG-001)
- [ ] 3.2 `AdoptCatalogInstitutions` en una unidad de trabajo con auditoría `accounts.institutions.adopted`: códigos desconocidos o `DELISTED` → 422 sin cambios; `alreadyLinked`; conflictos `NAME_TAKEN`; `links[]` (TC-ACCOUNTS-INSTCATALOG-002, TC-ACCOUNTS-INSTCATALOG-003, TC-ACCOUNTS-INSTCATALOG-004)
- [ ] 3.3 Entrada `DELISTED`: la institución adoptada conserva datos y cuentas e informa la fecha (TC-ACCOUNTS-INSTCATALOG-005)
- [ ] 3.4 Ingesta de tasas por institución con el doble en memoria (`FakeInstitutionRateProvider`): registro por workspace, idempotencia, anomalía por entidad y lado (TC-FX-INSTRATE-003, TC-FX-INSTRATE-004)
- [ ] 3.5 `GetProviderStatus` con `institutions[]` y obsolescencia de 72 h (TC-FX-INSTRATE-007, TC-FX-INSTRATE-008)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migraciones expand-only: columnas de vínculo en `accounts.institution` con CHECK e índice único parcial; `institution_code` en `fx.exchange_rate`; CHECKs de `rate_type` con `BANK_BUY`/`BANK_SELL` en `fx.exchange_rate`, `fx.rate_preference` y `txn.conversion_detail`; índice de idempotencia ampliado; timestamps posteriores a la última de `main`
- [ ] 4.2 Archivo real `reference/institutions/BO.json` con el censo verificado en 1.1 (solo datos públicos de registro, sin logos), estados de línea base (decisión 5) y validación en verde — requiere 1.1 y la pregunta 2; mientras tanto el código y los tests usan el catálogo ficticio (`Banco Andino Demo`, `Cooperativa Illimani Demo`, `Billetera Altiplano Demo`)
- [ ] 4.3 Adapter del proveedor principal por institución (candidato BCB, ACL, JSON Schema propio del contenido, lectura lossless, sin datos del usuario, allowlist de hosts) con fixtures grabados tras la verificación — requiere 1.1 y 1.2. Si la fuente no califica: se marca `[x]` con la nota "no apta según ADR-00NN" y las entidades pasan a `NOT_ELIGIBLE` o a la siguiente candidata
- [ ] 4.4 Adapters de las siguientes candidatas aptas (sitios de entidades, agregadores), uno por entidad o fuente y solo tras su verificación — requiere 1.1 y 1.2
- [ ] 4.5 Configuración `FX_PROVIDER_INSTITUTION_RATES`, `FX_INSTITUTION_RATES_INTERVAL`, `FX_STALE_AFTER_INSTITUTION` en el contrato único; `.env.example` con `none`; `pnpm config:docs`
- [ ] 4.6 Jobs en las colas existentes, sin consumidores nuevos; test de arranque del worker (TC-PLATFORM-EVENTS-018) y presupuesto 55/60 sin cambios
- [ ] 4.7 Portabilidad: `catalogRef` de instituciones e `institutionCode` de tasas en export e import (TC-IDENTITY-EXPORT-014)
- [ ] 4.8 Tests de integración: índice único de adopción, RLS e idempotencia de tasas por institución; `pnpm test:integration` dos veces en verde

## 5. API

- [ ] 5.1 OpenAPI: `getInstitutionCatalog`, `adoptCatalogInstitutions`, schemas nuevos, `Institution.catalogRef`, `BANK_BUY`/`BANK_SELL`, `FxRate.institutionCode`, `FxProviderStatusList.institutions`, `INSTITUTION_CATALOG_ENTRY_UNKNOWN`; `fx.RateRecorded.v1` con los tipos y `institutionCode`; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas. Los ids de proveedor se agregan a `FxRateProvider` solo tras 1.1
- [ ] 5.2 Controllers y tests de API: catálogo, adopción (roles, 422, conflictos, idempotencia), estado de providers con instituciones (TC-ACCOUNTS-INSTCATALOG-001..005, TC-FX-INSTRATE-007, TC-FX-INSTRATE-008)

## 6. UI

- [ ] 6.1 Instituciones → "Agregar desde el catálogo": búsqueda, filtro por categoría, fuente y fecha de corte visibles, selección múltiple, conflictos; i18n es/en/pt; axe y móvil (TC-ACCOUNTS-INSTCATALOG-001, TC-ACCOUNTS-INSTCATALOG-002)
- [ ] 6.2 Estado de soporte por dimensión y razón en el catálogo y en cada institución adoptada; "no figura en el registro desde …" (TC-ACCOUNTS-INSTCATALOG-005, TC-ACCOUNTS-INSTCATALOG-006)
- [ ] 6.3 Panel de cobertura (Configuración): censo por categoría, resueltas y pendientes por dimensión, `NOT_ELIGIBLE` con razón, indicador de soporte completo (TC-ACCOUNTS-INSTCATALOG-007)
- [ ] 6.4 Tasas por institución en el historial, como referencia elegible al registrar una conversión y en la preferencia por par (TC-FX-INSTRATE-006)

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 Test sobre el archivo real del catálogo: validación estructural siempre en verde y cobertura informada en la salida (TC-ACCOUNTS-INSTCATALOG-010)
- [ ] 7.2 E2E con catálogo ficticio y proveedor simulado: el EDITOR adopta dos entidades, ve su estado de soporte y una tasa `BANK_SELL` como referencia de una conversión; con `PF_E2E_PROJECT`
- [ ] 7.3 Smoke en vivo opcional (nightly, no bloqueante) de los proveedores por institución verificados — requiere 4.3
- [ ] 7.4 Regresión: TC-ACCOUNTS-INSTITUTION-001..004, TC-ACCOUNTS-INSTLINK-001, TC-FX-HISTORICAL-001/002, TC-FX-PROVIDER-001..019, TC-FX-COST-\*

## 8. DOCS y DATOS DEL OWNER

- [ ] 8.1 ADR nuevo de fuentes de tasas por institución y catálogo de referencia (1.1); docs/01 FR-ACCOUNTS-012 (catálogo de referencia) y FR-FX-009 (tasas por institución); docs/08 (columnas nuevas); docs/10 (endpoints y `INSTITUTION_CATALOG_ENTRY_UNKNOWN`); docs/11 (`fx.RateRecorded.v1`); docs/config-reference.md; docs/29 (el catálogo real no es una seed); docs/38 (meta de soporte completo y revisión del censo)
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-exchange-house-rate-providers --strict`
- [ ] 8.3 Fichas de formato de extractos por entidad (sin datos reales) y fixtures sintéticos a partir de las muestras del owner; actualizar `statementImport` de cada entidad (`GENERIC_ONLY`, `NOT_ELIGIBLE` con `IMAGE_ONLY_STATEMENT` o `PENDING_SAMPLE`) — **Espera al owner (2026-10-13):** el owner ofreció PDFs de extractos de distintos bancos; se reciben fuera del repositorio, se describe el formato, se fabrica el fixture sintético y se borra el PDF (design.md decisión 10, preguntas 6 y 10). Si al cerrar el change no hay muestras, se marca `[x]` con la nota "diferida por el owner" y las entidades siguen `PENDING_SAMPLE`
