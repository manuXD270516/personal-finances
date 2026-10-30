# Diseño: add-banking-providers

## Contexto

docs/13 §6 define el puerto `BankingProvider` (fuentes `bank_api`, `aggregator`, `exchange`) y la conversión de registros de exchange en transacciones de dominio (§6.4); FR-IMPORTS-013 (Should) pide el puerto con sincronización incremental por cursor, reutilización de la etapa de normalización y tokens solo cifrados, y FR-IMPORTS-014 (Should) un adapter de exchange (p. ej. el CSV exportado del historial spot o P2P) que produzca conversiones con su detalle. FR-IMPORTS-015 (adapters reales de bancos o agregadores) es Phase 11. NFR-COMP-008 (Must, Phase 6) prohíbe almacenar usuario y contraseña de banca: solo tokens delegados cifrados. NFR-COMP-007 exige verificar los términos de cada fuente.

Estado real que condiciona el diseño:

- **ADR-0029** (aceptado el 2026-10-16) verificó Binance y Bybit solo para **datos públicos de mercado** y fijó la condición **C4: "sin claves, cuentas ni endpoints privados; sin P2P"**. Leer movimientos del usuario exige endpoints privados con su clave: es un **alcance nuevo** que ADR-0029 no cubre y que necesita una decisión del owner y un ADR propio.
- La tarea 1.5 del change 38 (`add-crypto-rate-providers`) sigue abierta: la red de las sesiones no resuelve los dominios de los exchanges, así que nadie leyó todavía el texto vigente de sus términos (docs/38 §2). Lo mismo pasaría con los términos de la API privada.
- Los bancos bolivianos no tienen API abierta (docs/13 §6.3): en Phase 6 no hay adapter bancario real.
- El despliegue es un VPS con Compose (ADR-0027): no hay Secrets Manager ni KMS; docs/12 §9 asume AWS.
- El pipeline completo (staging, vista previa, aprobación, persistencia masiva) lo redacta en paralelo `add-import-pipeline`; las reglas, `add-rule-engine`.

## Objetivos / No objetivos

**Objetivos**

- El puerto `BankingProvider`, el agregado `Connection`, el almacén de credenciales con cifrado de sobre, la verificación de solo lectura, la revocación y la sincronización incremental, probados con un proveedor simulado, **sin depender de ninguna decisión del owner**.
- El mapeo de registros de exchange a transacciones (conversiones, ingresos, gastos, comisiones) con el detalle tal como lo informa el exchange.
- Dejar los adapters reales (archivo y API de Binance y Bybit) detrás de una puerta explícita del owner que **no bloquea** el resto de Phase 6.

**No objetivos**

- Adapters de bancos o agregadores (FR-IMPORTS-015, Phase 11), webhooks, auto-aprobación de sincronizaciones (docs/13 pregunta 9).
- P2P, futuros, margen, staking detallado, wallets on-chain (docs/25 W-12).
- Cambiar los proveedores de precios de `add-crypto-rate-providers` (otra capability, otra condición C4).

## Decisiones

### 1. Proveedores dentro de IMPORTS, sin contexto nuevo

- `BankingProvider` es un puerto de `imports/application/ports` (ACL); los adapters viven en `imports/infrastructure/providers/<id>`. El agregado `Connection` y el almacén de credenciales son de IMPORTS (docs/13 §2 "Connection", docs/08 `imports.connection`). **Alternativa:** contexto `integrations` aparte: sin beneficio con un solo consumidor (el pipeline) y contradice docs/05.
- El descriptor de cada proveedor es código versionado (`ProviderDescriptor`: `id`, `kind` (`BANK_API`, `AGGREGATOR`, `EXCHANGE_API`, `EXCHANGE_FILE`, `FAKE`), `capabilities`, `credentialMode` (`NONE`, `API_KEY_SECRET`, `DELEGATED_TOKEN`; **no existe** `USERNAME_PASSWORD`, y el registro valida que no aparezca), `allowedHosts`, `termsStatus` (`VERIFIED`, `PENDING`, `REJECTED`, con ADR y fecha), `formatStatus` para archivos (`VERIFIED`, `PENDING_SAMPLE`)). Mismo patrón que los descriptores `VERIFIED` del change 38.

### 2. Puerto

```ts
// imports/application/ports (ilustrativo, normativo en cuanto a forma)
export interface BankingProvider {
  readonly descriptor: ProviderDescriptor;
  /** Verifica la credencial y devuelve sus permisos efectivos (sin leer movimientos). */
  verifyCredential(ctx: ProviderCallContext): Promise<CredentialPermissions>;
  /** Activos o cuentas del proveedor (para el mapeo). */
  listAssets(ctx: ProviderCallContext): Promise<readonly ExternalAsset[]>;
  /** Registros de la ventana desde el cursor, en páginas; cada página trae el cursor a confirmar. */
  fetchRecords(ctx: ProviderCallContext, window: { from: string; to: string }, cursor: string | null)
    : AsyncIterable<{ readonly records: readonly ExternalRecord[]; readonly nextCursor: string | null }>;
}
export interface FileHistoryProvider {
  readonly descriptor: ProviderDescriptor;          // kind EXCHANGE_FILE, credentialMode NONE
  parse(file: ReadableStream<Uint8Array>): AsyncIterable<ExternalRecord>;
}
export interface CredentialPermissions {
  readonly read: boolean; readonly trade: boolean; readonly withdraw: boolean; readonly transfer: boolean;
  readonly ipRestricted: boolean | null;
}
export type ExternalRecordType = 'TRADE' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'REWARD' | 'P2P' | 'OTHER';
export interface ExternalRecord {
  readonly type: ExternalRecordType;
  readonly externalId: string;                      // estable por proveedor y tipo
  readonly executedAt: string;                      // instante ISO UTC informado por el proveedor
  readonly legs: readonly { readonly asset: string; readonly amount: string; readonly direction: 'IN' | 'OUT' }[];
  readonly fees: readonly { readonly asset: string; readonly amount: string; readonly kind: 'PROVIDER' | 'NETWORK' }[];
  readonly quotedPrice?: { readonly base: string; readonly quote: string; readonly price: string };
  readonly description: string | null;              // texto del proveedor, no confiable
  readonly raw: Readonly<Record<string, string>>;   // campos crudos (staging, purgables)
}
```

- `ProviderCallContext` lleva la credencial descifrada **solo en memoria** del worker, el reloj, el cliente HTTP con allowlist (`ProviderHttpClient` de FX, con query fija construida por el adapter; se reutiliza) y el presupuesto de solicitudes.
- Montos siempre texto decimal exacto (INV-001); el normalizador los lleva a la escala de la moneda de la cuenta; exceso de escala ⇒ fila inválida, nunca redondeo (INV-003).
- **Suite de contrato común** (`providerContractSuite(provider, fixtures)`): ventana respetada, ids estables entre páginas, cursor reanudable (cortar en la página k y reanudar da los mismos registros una vez), montos exactos, sin solicitudes fuera de `allowedHosts`, sin datos del workspace en las solicitudes.

### 3. Cifrado de sobre de credenciales

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| (a) Clave maestra simétrica en API y worker (patrón `BFF_SESSION_ENC_KEY`) | DEK AES-256-GCM por credencial, envuelta con la KEK simétrica | Simple, ya existe el patrón de key ring con `kid` | Un compromiso de la API permite descifrar todas las credenciales |
| **(b) Clave pública en la API, privada solo en el worker (elegida)** | DEK aleatoria AES-256-GCM cifra el secreto; la DEK se envuelve con X25519 (clave efímera) + HKDF-SHA256 + AES-256-GCM hacia la clave pública vigente | La API cifra pero **no puede descifrar**; solo el worker, que sincroniza, tiene la privada | Dos variables por entorno y rotación algo más compleja |
| (c) KMS o Secrets Manager (docs/12 §9) | `secret_ref` al servicio | Rotación gestionada | No existe en el VPS N1 (ADR-0027); queda como adaptador futuro del mismo puerto `CredentialKeyWrapper` |

- Variables: `CONNECTION_CREDENTIALS_PUBLIC_KEYS` (API y worker, `kid:clave[,kid:clave]`, la primera es la vigente) y `CONNECTION_CREDENTIALS_PRIVATE_KEYS` (**solo worker**). En `.env.example` valores de desarrollo obvios generados por `pnpm setup:env`; nunca reales (NFR-SEC-007). Sin las variables, el módulo de conexiones queda deshabilitado (la API responde `BANKING_PROVIDER_NOT_AVAILABLE`), sin afectar el resto.
- AAD = `workspace_id | connection_id | credential_version` (una credencial copiada a otra fila no descifra).
- **Nunca expuestas:** el DTO de entrada marca los campos `secret` como `writeOnly` y `format: password`; el logger los redacta (`pino.redact`, TC); la clave de idempotencia se calcula con la **huella** (SHA-256 del identificador de la clave), no con el secreto; la auditoría guarda la huella enmascarada; el export excluye la tabla.
- **Revocación = destrucción criptográfica:** se borran `wrapped_dek` y `ciphertext` (quedan `NULL` con `destroyed_at`), en la misma unidad de trabajo que la auditoría.
- **Rotación:** job `imports.credentials-rewrap` (worker, manual o al arrancar si hay `kid` no vigentes): desenvuelve la DEK con la privada vieja y la envuelve con la pública vigente; el secreto nunca se descifra. Una credencial con `kid` ausente ⇒ su conexión pasa a `NEEDS_ATTENTION`.

### 4. Agregado `Connection` y máquina de estados

```
PENDING_VERIFICATION ──verify ok──▶ ACTIVE ◀──replace credential + verify ok── NEEDS_ATTENTION
        │                             │  └──auth rechazada / permisos ampliados / kid ausente──▶ NEEDS_ATTENTION
        └──verify: no solo lectura──▶ REJECTED (credencial destruida)
NEEDS_CREDENTIAL (import del workspace) ──cargar credencial──▶ PENDING_VERIFICATION
cualquier estado no terminal ──revoke──▶ REVOKED (terminal, credencial destruida)
```

- Conexiones `EXCHANGE_FILE` nacen `ACTIVE` (sin credencial) y solo sirven para subir archivos con su mapeo e idempotencia.
- Recorrido de estados en `audit/lifecycle-timeline` como los demás agregados con máquina (D52).

### 5. Verificación de solo lectura

- Tras crear o reemplazar la credencial, la API encola `imports.connection-verify`; el worker descifra, llama a `verifyCredential` y: `read && !trade && !withdraw && !transfer` ⇒ `ACTIVE`; si no ⇒ `REJECTED` y destrucción. La UI consulta el estado (polling con `ETag`).
- Cada sincronización vuelve a llamar a `verifyCredential` antes de `fetchRecords`.
- Endpoints a confirmar en la lectura de documentación de la tarea 1.4 (no se afirman como verificados aquí): Binance publica la consulta de restricciones de la clave de API con banderas de lectura, trading spot, retiros y transferencias; Bybit publica la consulta de la clave con un indicador de solo lectura y sus permisos. Si un proveedor no permite verificar permisos, **no se habilita** (no hay "confianza en el usuario").

### 6. Sincronización

- `POST W/imports/connections/{id}/sync` (OWNER/EDITOR, `Idempotency-Key`, cuota `costly`): crea un `ImportJob` con `source = EXCHANGE_API` (o `BANK_API`/`AGGREGATOR_API`) y `connectionId`, y encola `imports.connection-sync`. El worker:
  1. Re-verifica permisos.
  2. Recorre `fetchRecords` desde el cursor confirmado; **no** mantiene una conexión de BD abierta durante las esperas HTTP: cada página se escribe en el staging en una transacción corta junto con el cursor provisional de la página (reanudación tras caída sin repetir: TC-IMPORTS-BANKING-030).
  3. Entrega los registros al pipeline en la etapa **normalize** (contrato con `add-import-pipeline`, § Dependencias) y el job queda en vista previa.
- El cursor **confirmado** (`connection.sync_cursor`) solo avanza cuando el import llega a `COMPLETED*`; cancelar o expirar la revisión lo deja como estaba (la siguiente sincronización vuelve a traer esos registros y la idempotencia evita duplicados).
- Primera sincronización: `from` obligatorio, como máximo 365 días atrás (`CONNECTION_SYNC_MAX_DAYS`); `to` = hoy en la zona del workspace.
- Una sola en curso por conexión: índice único parcial sobre `imports.import_job (connection_id) WHERE status no terminal` ⇒ `409 CONNECTION_SYNC_IN_PROGRESS`.
- **Jobs y conexiones (D249):** `imports.connection-verify`, `imports.connection-sync` e `imports.credentials-rewrap` se registran en la `JobQueue` existente del worker con concurrencia 1 cada uno; **no** son consumidores de eventos ni colas pg-boss nuevas, y no cambian `DATABASE_POOL_MAX`. Ocupan como máximo 1 conexión del pool del worker solo durante las escrituras cortas. Se valida con el test de arranque del worker (presupuesto de conexiones) en la tarea 4.6.

### 7. Límites del proveedor

- Presupuesto por conexión: ≤ 10 solicitudes por minuto (como ADR-0029), con espera persistida de `Retry-After` (429, y 418 de Binance) o de la espera publicada (Bybit 403: 30 min), guardada en `imports.connection.retry_not_before`. El job se reprograma, no duerme con recursos tomados.
- Reintentos con backoff y DLQ del runtime (NFR-REL-012); una falla no transitoria deja el import `FAILED` con el código del proveedor (`PROVIDER_UNAVAILABLE`, `IMPORT_CONNECTION_EXPIRED`), nunca `COMPLETED`.

### 8. Mapeo de registros a transacciones (docs/13 §6.4)

| Registro | Propuesta en la vista previa | Contrato de Transactions |
|---|---|---|
| `TRADE` | Conversión entre las cuentas mapeadas de sus dos activos; `ConversionDetail` con precio cotizado, montos y comisiones **tal como los informa el exchange**, instante de ejecución, proveedor = id del proveedor | `ImportedConversionsCommand.recordBatch` (nuevo, abajo) |
| `DEPOSIT` | Ingreso en la cuenta del activo, "sin categoría de ingreso", señal `POSSIBLE_TRANSFER` | `recordBatch` existente (`IN`) |
| `WITHDRAWAL` | Gasto en la cuenta del activo, señal `POSSIBLE_TRANSFER`; comisión de red como gasto aparte con categoría de sistema `FEES` | `recordBatch` (`OUT`) |
| `FEE` suelto | Gasto `FEES` | `recordBatch` (`OUT`) |
| `REWARD` | Ingreso "sin categoría de ingreso" (las reglas pueden clasificarlo) | `recordBatch` (`IN`) |
| `P2P`, `OTHER` | Fila excluida `CONNECTION_RECORD_UNSUPPORTED` | — |

- La señal `POSSIBLE_TRANSFER` la consume la acción "vincular como transferencia" de la vista previa de `add-import-pipeline` (si ese change no la ofrece, el usuario puede omitir la fila).
- Las filas de ingreso y gasto pasan por las reglas (`RuleEvaluationQuery`, `add-rule-engine`); las conversiones no.
- Referencia externa: `externalRef = { namespace: 'imports.provider:<providerId>:<type>', id: externalId }`; el archivo y la API del mismo exchange usan el **mismo** namespace (`<providerId>` es el del exchange, p. ej. `BINANCE`), así un trade importado por un camino aparece como ya importado por el otro. Índice único parcial de Transactions `(workspace_id, account_id, external_ref_namespace, external_ref_id) WHERE external_ref_namespace LIKE 'imports.provider:%' AND status <> 'VOIDED'` (análogo a `transaction_import_ref_uk`).
- Conversiones: la referencia externa va en la transacción de la conversión con la cuenta **origen** como `account_id` del índice.

### 9. Archivo de historial de exchange

- `FileHistoryProvider` por exchange y tipo de reporte, con un descriptor de formato versionado (columnas, separador, zona de las fechas, formato de números) en `docs/statement-formats/exchanges/` con fixture sintético, igual que las fichas de bancos del change 41 (`statementImport: PENDING_SAMPLE` hasta tener una muestra real del owner). Sin muestra verificada, el proveedor queda `formatStatus = PENDING_SAMPLE` y no se ofrece.
- La subida reutiliza la del pipeline (Documents, presigned, antimalware y límites de `add-import-pipeline` y `security/file-upload-security`); la conexión de archivo aporta mapeo e idempotencia.

### 10. Proveedores reales: puerta explícita del owner (no bloquea Phase 6)

- `FAKE_EXCHANGE` (solo `local`, `test`, `ci`; el arranque falla en staging y producción si está habilitado) cubre todo el comportamiento en CI.
- `EXCHANGE_FILE_BINANCE`, `EXCHANGE_FILE_BYBIT`, `EXCHANGE_API_BINANCE`, `EXCHANGE_API_BYBIT`: descriptores con `termsStatus = PENDING`. Para pasar a `VERIFIED` (grupo 9 de tasks.md, **tareas del owner**):
  1. **Decisión del owner** (pregunta 1) de ampliar el alcance de ADR-0029 a datos privados de su cuenta con clave de solo lectura (hoy C4 lo prohíbe) ⇒ **ADR-0031** "Lectura de movimientos de exchanges con claves de solo lectura".
  2. Lectura directa de los términos de la API privada y de la exportación de historial desde una red con acceso (la misma limitación que la tarea 1.5 del change 38; puede hacerse en la misma sesión desde la máquina del owner o el VPS N1).
  3. Muestras reales de los archivos de historial (sin subirlas al repositorio, D255) para fijar los formatos y grabar fixtures anonimizados.
  4. Fixtures grabados de los endpoints privados con una clave de solo lectura del owner (anonimizados; la clave nunca en el repositorio).
- Mientras tanto Phase 6 cumple sus criterios de salida (extractos bancarios, 70 % por reglas, re-import, uploads maliciosos) sin exchanges.

### Capas afectadas

| Contexto | Capa | Cambio |
|---|---|---|
| Imports | domain | AR `Connection` (estados, mapeo, cursor), VO `AssetMapping`, `ExternalRecord` ⇒ propuesta de fila (`ExchangeRecordMapper`), política de presupuesto |
| Imports | application | `ConnectionsService` (crear, reemplazar credencial, mapear, revocar, sincronizar), jobs verify/sync/rewrap, `CredentialVault` |
| Imports | infrastructure | `PgConnectionRepository`, `X25519CredentialKeyWrapper`, adapters (`FakeExchangeProvider`; reales tras la puerta), suite de contrato |
| Imports | interface | Controller de conexiones |
| Transactions | application/infrastructure | `ImportedConversionsCommand.recordBatch`; índice de referencias de proveedor |
| Platform | config | Variables `CONNECTION_*`; redacción de logs |
| `apps/web` | UI | Conexiones: catálogo de proveedores, alta con mapeo, estado, sincronizar, subir historial, reemplazar credencial, revocar |

## Contratos

### OpenAPI (aditivo, tag Imports, `x-openspec-capability: imports/banking-providers`)

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listBankingProviders` | `GET W/imports/providers` | VIEWER | Descriptores: `id`, `kind`, `credentialMode`, `capabilities`, `availability` (`AVAILABLE`, `PENDING_VERIFICATION`, `UNAVAILABLE`), `attribution` |
| `listConnections` | `GET W/imports/connections` | VIEWER | Sin credenciales; `credential { fingerprint: "…a1b2", kid, verifiedAt, permissions }` |
| `createConnection` | `POST W/imports/connections` | OWNER | `Idempotency-Key` (hash sin secretos); `{ providerId, name, assetMappings[{ asset, accountId }], credential?: { keyId, secret (writeOnly) } }` ⇒ 202 `PENDING_VERIFICATION` (o 201 `ACTIVE` para archivo); 422 `BANKING_PROVIDER_NOT_AVAILABLE`, `CURRENCY_MISMATCH`, `REFERENCE_NOT_FOUND`; 409 `ACCOUNT_CLOSED`, `ACCOUNT_ARCHIVED` |
| `getConnection` | `GET W/imports/connections/{id}` | VIEWER | `ETag`; estado, último error (`code`), cursor confirmado (fecha), `retryNotBefore` |
| `updateConnection` | `PATCH W/imports/connections/{id}` | OWNER | `If-Match`; nombre y mapeos |
| `replaceConnectionCredential` | `PUT W/imports/connections/{id}/credential` | OWNER | `If-Match`; ⇒ `PENDING_VERIFICATION` |
| `revokeConnection` | `POST W/imports/connections/{id}/revoke` | OWNER | `If-Match`; `DELETE` ⇒ 405 |
| `syncConnection` | `POST W/imports/connections/{id}/sync` | EDITOR | `Idempotency-Key`, `x-rate-limit: costly`; `{ from? }` ⇒ 202 con `importJobId`; 409 `CONNECTION_SYNC_IN_PROGRESS`, `IMPORT_CONNECTION_EXPIRED`, `INVALID_STATUS_TRANSITION` |
| (subida de archivo) | La de `add-import-pipeline` con `connectionId` | EDITOR | 422 `IMPORT_UNSUPPORTED_FORMAT` |

`ImportJob` gana `connectionId` y `source` admite `EXCHANGE_API`, `EXCHANGE_FILE` (`x-extensible-enum`). Códigos nuevos en `ErrorCode` (mensajes es/en/pt): `BANKING_PROVIDER_NOT_AVAILABLE` (422), `CONNECTION_CREDENTIAL_NOT_READ_ONLY` (422, también como `lastError.code` de la conexión), `CONNECTION_SYNC_IN_PROGRESS` (409), `IMPORT_CONNECTION_EXPIRED` (409, nombre de docs/13 §15). Códigos de fila (enum abierto `ImportRowIssueCode`): `CONNECTION_ASSET_UNMAPPED`, `CONNECTION_RECORD_UNSUPPORTED`, señal `POSSIBLE_TRANSFER`. `pnpm contract:breaking` limpio.

### Contrato nuevo de Transactions (aditivo)

```ts
export const PROVIDER_RECORD_NAMESPACE_PREFIX = 'imports.provider:' as const;
export interface ImportedConversionRowDto {
  readonly rowRef: string;
  readonly executedAt: string;                       // instante del exchange
  readonly date: string;                             // fecha de negocio en la zona del workspace
  readonly from: { readonly accountId: string; readonly amount: string; readonly currency: string };  // bruto entregado
  readonly to: { readonly accountId: string; readonly amount: string; readonly currency: string };    // bruto recibido
  readonly quotedRate: string;
  readonly fees: readonly { readonly kind: 'PROVIDER' | 'NETWORK'; readonly amount: string; readonly currency: string;
                             readonly deductedFrom: 'SOURCE' | 'DESTINATION' }[];
  readonly provider: string;
  readonly externalRef: { readonly namespace: string; readonly id: string };
}
export interface ImportedConversionsCommand {
  recordBatch(input: { workspaceId: string; importJobId: string; actorUserId: string;
                       rows: readonly ImportedConversionRowDto[] })
    : Promise<{ created: readonly { rowRef: string; transactionId: string }[];
                alreadyExisting: readonly { rowRef: string; transactionId: string }[] }>;
}
export const IMPORTED_CONVERSIONS_COMMAND = Symbol.for('pf.transactions.ImportedConversionsCommand');
```

Reutiliza el agregado de conversión (validaciones de `transactions/conversions`, detalle inmutable, tasa de referencia del día como metadato, `source = IMPORT`), en la unidad de trabajo del lote del llamador.

**Coordinación con `add-import-pipeline` y `add-bulk-imported-transactions`:** el pipeline amplía el camino por lote de `RecordImportedTransactions` con filas de conversión entre cuentas propias (fila marcada como conversión en la vista previa). Si al implementar ese camino ya acepta conversiones con comisiones por lado, precio cotizado e instante informados, las filas de exchange lo usan y `ImportedConversionsCommand` **no** se crea (lo que falte se agrega a esa fila, aditivo; regla de la decisión 6 de `add-bulk-imported-transactions`: quien llega segundo lo integra). Lo normativo es el comportamiento de la spec "Trades del exchange como conversiones", no el nombre del comando. La señal `POSSIBLE_TRANSFER` se resuelve con la acción "marcar como transferencia" de la vista previa del pipeline (spec "Filas como transferencia o conversión entre cuentas propias").

### Eventos

Sin eventos nuevos ni consumidores nuevos. Las conversiones creadas emiten `transactions.ConversionRecorded.v1` como hoy; el import emite `imports.ImportCompleted.v1` (su `sourceType` admite `EXCHANGE_API`/`EXCHANGE_FILE`, aditivo si el esquema lo enumera como abierto; si es `enum` cerrado, se pasa a `x-extensible-enum` en `add-import-pipeline`).

## Modelo de datos (expand-only)

| Tabla | Columnas y restricciones | RLS y grants |
|---|---|---|
| `imports.connection` (nueva) | `id`, `workspace_id`, `provider_id`, `name` (1–80), `status` (`PENDING_VERIFICATION`, `ACTIVE`, `NEEDS_ATTENTION`, `REJECTED`, `REVOKED`, `NEEDS_CREDENTIAL`), `asset_mappings jsonb` (`[{asset, accountId}]`), `sync_cursor text NULL`, `cursor_confirmed_at`, `retry_not_before timestamptz NULL`, `last_error_code text NULL`, `last_sync_at`, `version int`, `created_at`, `created_by`, `revoked_at`. Único `(workspace_id, lower(name)) WHERE status <> 'REVOKED'` | RLS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE; `workspace_scoped_table`; export |
| `imports.connection_credential` (nueva) | `workspace_id`, `connection_id` PK, `credential_version int`, `kid text`, `ephemeral_public_key bytea`, `wrapped_dek bytea NULL`, `dek_nonce bytea`, `ciphertext bytea NULL`, `nonce bytea`, `key_fingerprint text` (enmascarada), `permissions jsonb NULL`, `verified_at`, `destroyed_at`; CHECK `(destroyed_at IS NULL) = (wrapped_dek IS NOT NULL AND ciphertext IS NOT NULL)` | RLS forzada; `pf_app` INSERT/UPDATE (cifrar, destruir) y SELECT **sin** `wrapped_dek`/`ciphertext` (grants por columna); `pf_worker` SELECT/UPDATE completo; **excluida del export**; `workspace_scoped_table` (purga demo) |
| `imports.import_job` | `connection_id uuid NULL`; `source` amplía su CHECK; índice único parcial `(workspace_id, connection_id) WHERE connection_id IS NOT NULL AND status IN (estados no terminales)` | — |
| `txn.transaction` | Índice único parcial `transaction_provider_ref_uk` (`CONCURRENTLY`, migración aparte) | — |

## Riesgos / Trade-offs

- **Fuga de credenciales** (RISK-010): mitigado con sobre asimétrico, AAD, grants por columna, redacción de logs, idempotencia sin secretos, export sin la tabla, destrucción criptográfica, y solo lectura verificada (aun filtrada, una clave no opera ni retira).
- **Términos de la API privada** (RISK-023, NFR-COMP-007): sin verificar ⇒ ningún adapter real; la puerta es explícita y del owner.
- **Bloqueo geográfico** de los runners de CI (ADR-0029): los tests usan fixtures; los smoke reales, si los hay, solo desde el VPS o la máquina del owner.
- **Formato del archivo cambia sin aviso**: formato versionado, `IMPORT_UNSUPPORTED_FORMAT` y golden files.
- **Depósitos y retiros como ingreso o gasto** pueden inflar ingresos y gastos si el usuario no los vincula: señal `POSSIBLE_TRANSFER` visible en la vista previa (como la advertencia de transferencias del CSV básico).
- **Coordinación con `add-import-pipeline`**: la entrada desde normalize, `connectionId` en el job, filas de conversión de dos cuentas y la acción "vincular como transferencia". Sin eso, este change solo entrega la parte de conexión y credenciales.

## Plan de migración

1. Migración `imports` (tablas nuevas, columna y CHECK de `import_job`, grants por columna, RLS, `workspace_scoped_table`).
2. Migración aparte con los índices `CONCURRENTLY` (`import_job` y `txn.transaction`).
3. Variables `CONNECTION_*` en `@pf/platform` (`pnpm config:docs`); sin ellas el módulo queda deshabilitado.
4. Rollback: el código anterior ignora las tablas nuevas; sin datos destructivos.

## Dependencias entre changes

- **`add-import-pipeline` (Phase 6, en paralelo) — bloquea la integración (grupos 5 y 7), no el núcleo (grupos 2–4):** (a) entrada de registros externos desde la etapa normalize, independiente del formato (`StageExternalRecords(jobId, records)` o equivalente); (b) `ImportJob` con `connectionId` y fuentes `EXCHANGE_API`/`EXCHANGE_FILE`; (c) filas de conversión que afectan dos cuentas mapeadas y su persistencia con `ImportedConversionsCommand`; (d) "vincular como transferencia" para filas `POSSIBLE_TRANSFER`; (e) subida de archivo con `connectionId`; (f) la ruta masiva de `RecordImportedTransactions` (D152) también para estas filas.
- **`add-rule-engine`:** las filas de ingreso y gasto pasan por `RuleEvaluationQuery`.
- **`add-crypto-rate-providers` (change 38):** reutiliza `ProviderHttpClient` (allowlist, query fija) y el patrón de descriptores `VERIFIED`; la tarea 1.5 de ese change y la 9.2 de este se pueden hacer en la misma sesión con red. El 38 no depende de este.
- **ADR-0029:** su condición C4 sigue vigente para precios; este change necesita ADR-0031 para datos privados (pregunta 1).
- **Documents / `security/file-upload-security`** (Phase 6): subida del archivo de historial.

## Preguntas abiertas

1. **[B para el grupo 9, no para Phase 6] Ampliar el alcance a datos privados de exchanges.** ADR-0029 C4 prohíbe claves y endpoints privados. Opciones: (a) aprobar la lectura con claves de **solo lectura** del owner en un ADR-0031 nuevo, tras leer los términos de la API privada; (b) solo archivos de historial exportados por el owner (sin claves); (c) ninguna integración de exchanges en Phase 6 (solo el puerto y el simulado). **Recomendación: (b) primero y (a) después**: el archivo no necesita credenciales ni términos de API (son los datos del propio usuario) y cubre FR-IMPORTS-014; la API se habilita cuando ADR-0031 y la lectura de términos estén hechos.
2. **[B para el grupo 9] Qué exchanges y qué reportes.** D251 nombra Binance, Bitget y Bybit para precios. Opciones: (a) Binance y Bybit (los verificados en ADR-0029); (b) solo Binance; (c) los tres. **Recomendación: (a)**, y el owner comparte (en la conversación, nunca en el repositorio) una exportación real de trades y de depósitos y retiros de cada uno.
3. **Custodia de la clave privada del worker.** Opciones: (a) variable de entorno del worker en el VPS (como los demás secretos de N1); (b) archivo montado con permisos 0400 fuera del repositorio; (c) KMS cuando haya cloud. **Recomendación: (b)** en N1 (no aparece en `docker inspect`), (c) en Phase 9.
4. **Depósitos y retiros.** Opciones: (a) ingreso o gasto con señal "posible transferencia" (decisión 8); (b) transferencia pendiente de vincular obligatoriamente antes de aprobar. **Recomendación: (a)**; (b) bloquearía imports por movimientos con wallets externas que no están en PFOS.
5. **Recompensas y staking.** Opciones: (a) ingreso "sin categoría de ingreso" clasificable por reglas; (b) categoría de sistema nueva "Recompensas cripto" (docs/13 §6.4). **Recomendación: (a)**: una categoría de sistema nueva es un cambio en `classification/categories` (FR-CLASSIFICATION-003) sin necesidad para el owner hoy.
6. **Ventana máxima de la primera sincronización.** **Recomendación:** 365 días (`CONNECTION_SYNC_MAX_DAYS`), configurable.
7. **Auto-aprobación** (docs/13 pregunta 9). **Recomendación:** no en Phase 6; siempre vista previa.

## Cambios a docs compartidos

- **docs/01:** FR-IMPORTS-013 (cifrado de sobre asimétrico, verificación de solo lectura, revocación con destrucción criptográfica); FR-IMPORTS-014 (archivo primero, API tras ADR-0031; P2P fuera).
- **docs/08:** `imports.connection` y `imports.connection_credential` (reemplazan `secret_ref`), columna `import_job.connection_id`, índice `transaction_provider_ref_uk`, export sin credenciales.
- **docs/10:** operaciones de conexiones y proveedores; códigos `BANKING_PROVIDER_NOT_AVAILABLE`, `CONNECTION_CREDENTIAL_NOT_READ_ONLY`, `CONNECTION_SYNC_IN_PROGRESS`, `IMPORT_CONNECTION_EXPIRED` en §9.1.
- **docs/12 §1, §9 y §10:** credenciales de proveedores en `imports.connection_credential` con sobre X25519 (no Secrets Manager en N1); claves `CONNECTION_CREDENTIALS_*`; STRIDE del flujo de conexión (NFR-SEC-020).
- **docs/13 §2, §6, §13–§15:** `Connection` con estados, descriptor, puerto real, namespace `imports.provider:<id>:<tipo>`, archivo de historial como proveedor.
- **docs/adr:** ADR-0031 (pregunta 1) y nota en ADR-0029 de que C4 aplica a precios.
- **docs/config-reference.md:** `CONNECTION_CREDENTIALS_PUBLIC_KEYS`, `CONNECTION_CREDENTIALS_PRIVATE_KEYS`, `CONNECTION_SYNC_MAX_DAYS`, `CONNECTION_PROVIDER_REQUESTS_PER_MINUTE`, `IMPORTS_PROVIDER_FAKE_ENABLED`.
- **docs/statement-formats/exchanges/:** fichas de formato con fixtures sintéticos.
- **docs/38 §2:** puerta del owner (decisión, términos, muestras, fixtures).
- **docs/03 §7:** orden en Phase 6 (después de `add-import-pipeline` para la integración).
