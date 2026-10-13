# Propuesta: add-exchange-house-rate-providers

## Why

D232 dejó este change en espera de P14 (qué casas de cambio o bancos usa el owner). El owner respondió el 2026-10-13: el sistema **debe soportar todos los bancos y billeteras disponibles en Bolivia a la fecha de hoy** (2026-10-13), y ofreció compartir PDFs de extractos de distintos bancos (nunca van al repositorio). Esa respuesta amplía el change: ya no se trata de uno o dos adapters de tasas, sino de cubrir el universo de entidades del país, en tres dimensiones: catálogo para las cuentas, tasas de cambio por entidad e importación de extractos.

"Soportar todas" no puede significar scraping de más de 60 sitios sin verificar términos (NFR-COMP-007, RISK-023), ni prometer un parser por banco que todavía no existe. Además, desde el 2026-06-29 Bolivia tiene un tipo de cambio oficial flexible (Resolución de Directorio BCB N.º 88/2026, por verificar en la fuente primaria) y cada banco fija su propia cotización, así que las tasas por entidad ahora importan para las conversiones del owner. El change convierte "soportar todas" en un **objetivo medible**: un catálogo de referencia con todas las entidades del registro oficial, un estado de soporte por entidad y dimensión (soportada, en verificación, pendiente de muestra, no apta con su razón, no aplica) y un indicador de cobertura que llega al 100 % cuando ninguna entidad queda sin resolver.

## What Changes

- **Catálogo de referencia de instituciones de Bolivia** (FR-ACCOUNTS-012): un archivo de datos versionado (no código) con todas las entidades del registro oficial de ASFI en las categorías del alcance (bancos múltiples, PYME y público, entidades financieras de vivienda, cooperativas de ahorro y crédito abiertas, instituciones financieras de desarrollo, empresas de servicios de pago móvil y, según la pregunta 3, empresas de tecnología financiera), con fuente, fecha de corte y fecha de consulta. Solo datos públicos de registro (nombre, sigla, categoría, sitio web); sin logos.
- **Adopción desde el catálogo**: el EDITOR elige entidades del catálogo y cada una se crea en su workspace como una institución normal (editable y archivable), vinculada a su código de catálogo. El workspace nuevo sigue empezando vacío (FR-ACCOUNTS-012).
- **Estado de soporte por institución y dimensión**: cada entrada del catálogo declara su estado para `rates` (tasas de cambio) y `statementImport` (importación de extractos): `SUPPORTED`, `GENERIC_ONLY` (solo importación), `IN_VERIFICATION`, `PENDING_SAMPLE` (solo importación), `NOT_ELIGIBLE` con razón obligatoria, `NOT_APPLICABLE`. Un estado `SUPPORTED` de tasas exige un proveedor con términos verificados y registrados en un ADR.
- **Indicador de soporte completo**: cobertura del catálogo frente al censo oficial y estado resuelto de cada entidad en cada dimensión; "soporte completo" = censo 100 % cubierto y ninguna entidad `IN_VERIFICATION` ni `PENDING_SAMPLE`. Se consulta por la API y se valida con un test sobre el archivo real del catálogo.
- **Framework de proveedores de tasas por institución**: tipos de tasa aditivos `BANK_BUY` y `BANK_SELL` (convención D39, desde el lado del owner) con el código de la institución; proveedores habilitados solo con términos verificados; las tasas por institución nunca valoran salvo preferencia explícita por par, y quedan como referencia para conversiones y para el análisis de costo (change 40).
- **Adapters por entidad solo tras verificar términos**: la primera candidata es la publicación del BCB de la cotización de compra de cada entidad (una sola fuente pública que cubre a todos los bancos que operan divisas), y la tasa oficial flexible del BCB; ninguna está verificada todavía. Sitios de bancos, agregadores de terceros y casas de cambio se evalúan después, uno por uno. Sin verificación, la entidad queda `IN_VERIFICATION` y no se envía ninguna solicitud.
- **Importación de extractos**: este change **solo** registra el estado por entidad (línea base `PENDING_SAMPLE`) y el procedimiento para muestras del owner (los PDFs nunca entran al repositorio; se describen los formatos y se fabrican fixtures sintéticos). Los perfiles por institución (FR-IMPORTS-005) y los parsers de PDF (FR-IMPORTS-016) siguen en Phase 6 y Phase 11, salvo que el owner adelante (pregunta 6).
- **Portabilidad**: el vínculo de cada institución con el catálogo viaja en el export.
- **Fuera de alcance:** parsers de extractos PDF o XLS y perfiles de mapeo por institución (Phase 6/11, FR-IMPORTS-005/016/017); conexión a APIs bancarias o agregadores (`imports/banking-providers`, Phase 6/11; NFR-COMP-008); exchanges cripto (change 38) y entidades fuera de Bolivia; logos o marcas de las entidades; scraping de sitios cuyos términos no se verificaron; cambiar la valoración por defecto (D29 sigue: `PARALLEL` valora USD/BOB); alertas por NOTIFY de tasas por institución; precios de commodities e inversiones (42 y 43, diferidos).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `accounts/institutions`: catálogo de referencia por país, adopción desde el catálogo, entrada retirada del registro, estado de soporte por institución y dimensión, medición del soporte completo y completitud frente al censo oficial (6 requirements ADDED).
- `fx/market-rate-providers`: proveedores de tasas por institución solo con términos verificados, compra y venta por institución como tipos de tasa propios, tasas por institución fuera de la valoración por defecto y estado de tasas por institución (4 requirements ADDED; no modifica requirements existentes para no chocar con el delta del change 38 sin archivar).
- `identity/workspace-portability`: vínculo con el catálogo de referencia en el export (1 requirement ADDED).

## Impact

**Specs impactadas:** `accounts/institutions`, `fx/market-rate-providers`, `identity/workspace-portability`. Leídas sin cambios: `fx/market-rates` (tipo preferido por par, tasas manuales `BANK`), `fx/conversion-pricing` (las tasas por institución pueden ser la referencia de una conversión), `imports/import-pipeline` (CSV básico, sin cambios), `audit/audit-trail`, `security/access-control`. No toca `debt/loans` ni `debt/amortization` (D219).

**Componentes/contextos impactados:** ACCOUNTS (`@pf/accounts`): lectura del catálogo de referencia (`InstitutionCatalogReader`, puerto e implementación sobre archivo), VO `CatalogRef`, `AdoptCatalogInstitutions`, cálculo de cobertura (`SupportCoverage`); FX (`@pf/fx`): tipos `BANK_BUY`/`BANK_SELL`, `institutionCode` en `FxRate`, puerto `InstitutionRateProvider`, descriptores con estado de términos (como el change 38), exclusión de la valoración por defecto, estado por institución; IDENTITY: sección de portabilidad; `apps/api` (catálogo, adopción, cobertura, estado), `apps/web` (adopción desde el catálogo, estado de soporte, cobertura), `apps/worker` (job de tasas por institución en las colas existentes).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `GET W/institution-catalog` y `POST W/institutions/adopt` (nuevas); `Institution.catalogRef` (opcional); `FxRateType` y `FxRateTypeInput` con `BANK_BUY`/`BANK_SELL`; `FxRate.institutionCode` (opcional); `FxProviderStatusList.institutions` (opcional); `FxRateProvider` gana los ids de proveedores por institución **solo** cuando su verificación queda registrada. Código de error nuevo en `ErrorCode` (`x-extensible-enum`): `INSTITUTION_CATALOG_ENTRY_UNKNOWN` (422). `pnpm contract:breaking` limpio.

**Tablas impactadas:** `accounts.institution` (columnas nuevas nulas `catalog_country`, `catalog_code`, `catalog_version`; índice único parcial por workspace y código entre no archivadas); `fx.exchange_rate` (columna nueva nula `institution_code`; CHECK de `rate_type` con `BANK_BUY`/`BANK_SELL`; índice único de idempotencia ampliado con `institution_code`); `fx.rate_preference` (CHECK de `rate_type` ampliado). El catálogo de referencia **no** es una tabla: es un archivo de datos versionado que lee la aplicación.

**Eventos impactados:** `fx.RateRecorded.v1` aditivo: `rateType` admite `BANK_BUY`/`BANK_SELL` e `institutionCode` opcional. ACCOUNTS no publica eventos de instituciones (solo de cuentas) y este change no los crea: la adopción queda en la auditoría. Sin eventos ni consumidores nuevos (D249).

**Migraciones requeridas:** expand-only (columnas nulas, CHECKs ampliados, índices); no destructivas.

**Test cases:** AÑADIDOS — TC-ACCOUNTS-INSTCATALOG-001..010 (10), TC-FX-INSTRATE-001..008 (8), TC-IDENTITY-EXPORT-014 (1); total 19. MODIFICADOS — ninguno. DEPRECADOS — ninguno. Regresión obligatoria: TC-ACCOUNTS-INSTITUTION-001..004, TC-ACCOUNTS-INSTLINK-001, TC-FX-HISTORICAL-001/002, TC-FX-PROVIDER-001..019, TC-FX-COST-\*.

**Impacto de regresión:** alta y edición de instituciones (el vínculo es opcional y el flujo actual no cambia); selección de la tasa de valoración (las tasas por institución quedan fuera por defecto); análisis de costo de conversiones (nuevas referencias posibles); export e import.

**Riesgos introducidos:** RISK-023 alto (términos de uso, sitios sin API, cambios de formato), catálogo desactualizado frente al registro oficial (entidades nuevas, intervenidas o fusionadas), percepción de "soporte" cuando la dimensión está en `NOT_ELIGIBLE` (se muestra la razón), cambio de régimen cambiario (fuentes `OFFICIAL` existentes que no reflejen el tipo flexible), RISK-010 (privacidad de los extractos del owner, que nunca entran al repositorio).

**Invariantes afectadas:** INV-011 (tasas históricas inmutables, también las de institución), INV-001/002 (valores Decimal exactos), aislamiento por workspace (RLS: el catálogo es de instalación y sin datos del usuario; la adopción crea filas del workspace). Sin consumidores nuevos ni asientos.
