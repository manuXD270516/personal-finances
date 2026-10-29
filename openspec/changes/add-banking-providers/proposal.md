# Propuesta: add-banking-providers

## Why

Phase 6 incluye el puerto `BankingProvider` y un adapter de exchange (docs/24 §5.6; docs/13 §6). FR-IMPORTS-013 (Should) pide un contrato de sincronización incremental que reutilice la normalización del pipeline y guarde los tokens solo cifrados; FR-IMPORTS-014 (Should) pide que el historial de un exchange produzca conversiones con su detalle; NFR-COMP-008 (Must, Phase 6) prohíbe almacenar usuario y contraseña de banca. El owner opera USDT y cripto en exchanges (D251) y hoy registra a mano cada trade. El obstáculo es externo: ADR-0029 solo habilita datos **públicos** de mercado (condición C4: sin claves ni endpoints privados) y nadie pudo leer todavía los términos vigentes de Binance y Bybit (tarea 1.5 del change 38). Este change entrega todo lo que no depende de eso (puerto, conexiones, credenciales cifradas, solo lectura, revocación, sincronización, mapeo a transacciones) probado con un proveedor simulado, y deja los adapters reales detrás de una puerta explícita del owner que no bloquea el resto de Phase 6.

## What Changes

- **Puerto `BankingProvider`** y `FileHistoryProvider` en IMPORTS (ACL) con descriptor por proveedor (tipo, capacidades, modo de credencial, hosts permitidos, estado de términos y de formato) y una **suite de contrato común**; registros externos con id estable, montos como texto decimal exacto y cursor reanudable, entregados al pipeline desde la normalización.
- **Proveedores habilitados solo con términos (y formato) verificados** (`BANKING_PROVIDER_NOT_AVAILABLE`); `FAKE_EXCHANGE` solo fuera de staging y producción.
- **Conexiones** (`Connection`): nombre, proveedor, mapeo de cada activo a una cuenta de la misma moneda (`CURRENCY_MISMATCH`; activo sin mapear ⇒ fila `CONNECTION_ASSET_UNMAPPED`), máquina de estados `PENDING_VERIFICATION → ACTIVE ↔ NEEDS_ATTENTION`, `REJECTED`, `REVOKED`, `NEEDS_CREDENTIAL`.
- **Credenciales con cifrado de sobre**: clave de datos por credencial envuelta con una clave pública (X25519 + HKDF + AES-256-GCM) cuya privada solo tiene el worker; nunca en respuestas, logs, errores, auditoría, idempotencia ni export; huella enmascarada `…a1b2`; rotación de la clave maestra sin descifrar los secretos; nunca usuario y contraseña.
- **Solo lectura verificada** con el proveedor al crear y en cada sincronización (`CONNECTION_CREDENTIAL_NOT_READ_ONLY`, credencial destruida); **revocación** con destrucción criptográfica, auditada, conservando lo importado; credencial rechazada ⇒ `IMPORT_CONNECTION_EXPIRED` y reemplazo.
- **Sincronización incremental**: crea un import con vista previa obligatoria; primera ventana de hasta 365 días; cursor confirmado solo al completar el import; una sola en curso (`CONNECTION_SYNC_IN_PROGRESS`); presupuesto de solicitudes y `Retry-After` persistido; reanudación sin duplicados; hosts permitidos y sin datos de PFOS en las solicitudes.
- **Mapeo a transacciones**: trades spot ⇒ conversiones con precio, montos y comisiones tal como los informa el exchange (contrato nuevo `ImportedConversionsCommand`); depósitos y retiros ⇒ ingresos y gastos con señal "posible transferencia" y comisión de red aparte; recompensas ⇒ ingresos; P2P y otros ⇒ excluidos (`CONNECTION_RECORD_UNSUPPORTED`); idempotencia por `imports.provider:<exchange>:<tipo>` compartida entre archivo y API.
- **Archivo de historial** de exchange como proveedor sin credenciales, con formato versionado y verificado contra una muestra real (`IMPORT_UNSUPPORTED_FORMAT`).
- **Portabilidad**: conexiones en el export sin credenciales; al importar quedan "requiere credencial".
- **Puerta del owner (no bloquea Phase 6):** decidir el alcance de datos privados (ADR-0030, extiende ADR-0029), leer los términos de la API privada y de la exportación, compartir muestras reales y grabar fixtures; recién entonces se habilitan `EXCHANGE_FILE_*` y `EXCHANGE_API_*` de Binance y Bybit.
- **Sin consumidores ni eventos nuevos**: tres jobs en la cola existente del worker con concurrencia 1, sin ampliar el pool (D249).
- **Fuera de alcance:** adapters de bancos y agregadores (FR-IMPORTS-015, Phase 11), webhooks, auto-aprobación, P2P, futuros, margen, wallets on-chain, Bitget, KMS en la nube (Phase 9).

## Capabilities

### New Capabilities
- `imports/banking-providers`: puerto común y suite de contrato, proveedores solo con términos verificados, conexiones y mapeo, credenciales cifradas, nunca usuario y contraseña, solo lectura, revocación, credencial rechazada, rotación de la clave maestra, sincronización incremental, idempotencia por id del proveedor, trades como conversiones, depósitos/retiros/comisiones/recompensas, archivo de historial, límites y reintentos, privacidad de las solicitudes y permisos (17 requirements: 8 Must, 9 Should).

### Modified Capabilities
- `identity/workspace-portability`: conexiones en el export sin credenciales (1 requirement ADDED, Must).

## Impact

**Specs impactadas:** crea `imports/banking-providers` (17 requirements); agrega 1 a `identity/workspace-portability`. Lee sin cambios `transactions/conversions` (detalle inmutable, comisiones como gasto), `transactions/transaction-recording`, `transactions/duplicate-detection`, `accounts/account-management` (moneda de la cuenta), `fx/market-rates` (tasa de referencia como metadato), `audit/audit-trail`, `audit/lifecycle-timeline`, `security/access-control`; depende de `imports/import-pipeline` ampliado por `add-import-pipeline` y de `rules/rule-engine` (`add-rule-engine`).

**Componentes/contextos impactados:** IMPORTS (AR `Connection`, `ExchangeRecordMapper`, `ConnectionsService`, `CredentialVault`, `X25519CredentialKeyWrapper`, `PgConnectionRepository`, jobs `imports.connection-verify`, `imports.connection-sync`, `imports.credentials-rewrap`, `FakeExchangeProvider`, suite de contrato; adapters reales tras la puerta del owner). TRANSACTIONS: `ImportedConversionsCommand.recordBatch` e índice de referencias de proveedor. PLATFORM: variables `CONNECTION_*`, redacción de logs. `apps/api` (controller, composición), worker (jobs), `apps/web` (conexiones).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo (tag Imports, `x-openspec-capability: imports/banking-providers`): `listBankingProviders`, `listConnections`, `createConnection`, `getConnection`, `updateConnection`, `replaceConnectionCredential`, `revokeConnection`, `syncConnection`; `ImportJob` con `connectionId` y fuentes `EXCHANGE_API`/`EXCHANGE_FILE`. Códigos nuevos en `ErrorCode`: `BANKING_PROVIDER_NOT_AVAILABLE` (422), `CONNECTION_CREDENTIAL_NOT_READ_ONLY` (422), `CONNECTION_SYNC_IN_PROGRESS` (409), `IMPORT_CONNECTION_EXPIRED` (409); códigos de fila `CONNECTION_ASSET_UNMAPPED`, `CONNECTION_RECORD_UNSUPPORTED`; reutiliza `CURRENCY_MISMATCH`, `INVALID_STATUS_TRANSITION`, `IMPORT_UNSUPPORTED_FORMAT`, `INSUFFICIENT_ROLE`, `PRECONDITION_FAILED`, `METHOD_NOT_ALLOWED`, `RATE_LIMITED`.

**Tablas impactadas:** nuevas `imports.connection` e `imports.connection_credential` (RLS forzada, grants por columna, `platform.workspace_scoped_table`; la de credenciales excluida del export); `imports.import_job` (columna `connection_id`, CHECK de `source`, índice único parcial de sincronización en curso); `txn.transaction` (índice único parcial `transaction_provider_ref_uk`); `audit.audit_log`, `audit.lifecycle_transition`.

**Eventos impactados:** ninguno nuevo; `transactions.ConversionRecorded.v1` y `TransactionCreated.v1` se emiten como hoy con `source = IMPORT`; `imports.ImportCompleted.v1` con `sourceType` `EXCHANGE_API`/`EXCHANGE_FILE` (aditivo, coordinado con `add-import-pipeline`).

**Migraciones requeridas:** expand, no destructivas: dos tablas nuevas, columna nullable y CHECK ampliado en `import_job`, índices únicos parciales con `CREATE INDEX CONCURRENTLY` en migraciones aparte; sección de export `import-connections` (sin credenciales).

**Test cases:** AÑADIDOS — TC-IMPORTS-BANKING-001..036 (`draft`, `provisional`, `not_automated`; carpeta `tests/cases/imports/`). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** el CSV básico y el pipeline no cambian para archivos bancarios; Transactions agrega un camino de creación de conversiones en lote que reutiliza el agregado (TC-TRANSACTIONS-CONV-* en verde); export e import del workspace (test de cobertura de tablas, con la exclusión declarada); presupuesto de conexiones del worker (test de arranque).

**Riesgos introducidos:** RISK-010 (credenciales y archivos sensibles), RISK-023 (términos de proveedores), RISK-006 (duplicados entre archivo y API: namespace compartido), bloqueo geográfico de CI (fixtures sin red), dependencia de `add-import-pipeline` para la integración.

**Invariantes afectadas:** INV-001 y INV-003 (montos del proveedor como texto exacto a la escala de la moneda, sin redondeo), INV-002 (moneda del activo = moneda de la cuenta), INV-004/INV-005 (conversiones balanceadas por moneda vía Transactions), INV-014 (idempotencia por id del proveedor), INV-025 (RLS en las tablas nuevas), INV-027 (idempotencia de crear conexión y sincronizar), INV-029 (auditoría en la misma unidad de trabajo).
