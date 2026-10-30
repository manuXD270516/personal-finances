# Tareas

> Phase 6. Los grupos 1–4 (puerto, conexiones, credenciales, verificación, revocación, sincronización con el proveedor simulado) **no dependen del owner ni de otros changes de Phase 6**. Los grupos 5 y 7 (integración con la vista previa y la persistencia) requieren `add-import-pipeline` (design § Dependencias). **El grupo 9 (adapters reales) depende del owner** (preguntas 1–3 de design.md, ADR-0031, términos, muestras y fixtures) y **no bloquea** el cierre de Phase 6: si sigue abierto al archivar, sus tareas se marcan `[x]` con la nota de diferimiento por decisión del owner. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `imports/banking-providers`, el delta de `identity/workspace-portability` y las preguntas 1–7 de design.md; registrar las respuestas en el doc de decisiones de Phase 6; `openspec validate add-banking-providers --strict`
- [ ] 1.2 Revisar TC-IMPORTS-BANKING-001..036 contra los scenarios (cifras a mano: 0.01500000 × 65000.00 = 975.000000 USDT; 0.01500000 − 0.00001500 = 0.01498500 BTC; 200.000000 + 1.000000 = 201.000000 USDT; 20 + 9 = 29 transacciones tras la ventana solapada); pasar a `ready` y `requirement_status: confirmed` al aprobar
- [ ] 1.3 Verificación cruzada con `add-import-pipeline` de los puntos (a)–(f) de design § Dependencias; registrar el resultado aquí
- [ ] 1.4 Leer la documentación pública de los endpoints de permisos de clave, historial de trades y de depósitos y retiros de Binance y Bybit (GitHub oficial, como ADR-0029) y anotar aquí qué permite verificar solo lectura; si un exchange no lo permite, no se habilita (design decisión 5)

## 2. DOMAIN (TDD)

- [ ] 2.1 `ProviderDescriptor` y registro (sin `USERNAME_PASSWORD`, `FAKE` prohibido en staging y producción, términos y formato) test-first (TC-IMPORTS-BANKING-002, -003, -010)
- [ ] 2.2 AR `Connection` (máquina de estados, mapeo con moneda de la cuenta, cursor confirmado vs provisional, `retryNotBefore`) test-first (TC-IMPORTS-BANKING-004, -006, -013, -018, -019)
- [ ] 2.3 `ExchangeRecordMapper` (trade ⇒ conversión con comisiones por lado; depósito, retiro, comisión, recompensa; P2P y otros excluidos; activo sin mapear; namespace `imports.provider:<exchange>:<tipo>`) test-first con montos exactos (TC-IMPORTS-BANKING-005, -023, -024, -025)
- [ ] 2.4 Política de presupuesto y espera (`Retry-After`, 418, 403 con 30 min) test-first (TC-IMPORTS-BANKING-029)

## 3. APPLICATION

- [ ] 3.1 `CredentialVault` y `X25519CredentialKeyWrapper` (DEK por credencial, AAD, huella, la API sin clave privada, destrucción) con vectores de prueba propios (TC-IMPORTS-BANKING-007, -008)
- [ ] 3.2 `ConnectionsService`: crear (idempotencia con huella, sin secretos), actualizar mapeo, reemplazar credencial, revocar; auditoría y recorrido en la misma unidad de trabajo (TC-IMPORTS-BANKING-004, -013, -033, -034)
- [ ] 3.3 Job `imports.connection-verify` (solo lectura, `REJECTED` y destrucción) y re-verificación al sincronizar (TC-IMPORTS-BANKING-011, -012)
- [ ] 3.4 Job `imports.connection-sync` (ventana, cursor, páginas en transacciones cortas, reanudación, `IMPORT_CONNECTION_EXPIRED`, `CONNECTION_SYNC_IN_PROGRESS`) con `FakeExchangeProvider` (TC-IMPORTS-BANKING-014, -017, -019, -029, -030)
- [ ] 3.5 Job `imports.credentials-rewrap` y `kid` ausente ⇒ `NEEDS_ATTENTION` sin detener las demás (TC-IMPORTS-BANKING-015, -016)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: `imports.connection`, `imports.connection_credential` (grants por columna: `pf_app` sin lectura de `wrapped_dek`/`ciphertext`), columna y CHECK de `import_job`; RLS forzada y fail-closed; `workspace_scoped_table`; tests de RLS y permisos (TC-IMPORTS-BANKING-008, -035)
- [ ] 4.2 Migración aparte con índices únicos parciales `CONCURRENTLY` (`import_job` en curso por conexión, `transaction_provider_ref_uk`)
- [ ] 4.3 TRANSACTIONS: `ImportedConversionsCommand.recordBatch` reutilizando el agregado de conversión; tests de contrato y TC-TRANSACTIONS-CONV-* en verde (TC-IMPORTS-BANKING-023)
- [ ] 4.4 `ProviderHttpClient` reutilizado con allowlist por descriptor y query fija; bloqueo de redirecciones fuera de la lista; `FakeExchangeProvider` y suite de contrato común (TC-IMPORTS-BANKING-001, -031, -032)
- [ ] 4.5 Config `CONNECTION_*` e `IMPORTS_PROVIDER_FAKE_ENABLED` en `@pf/platform`, `.env.example` con valores de desarrollo generados por `pnpm setup:env`, redacción de logs (`pino.redact`) y `docs/config-reference.md` (TC-IMPORTS-BANKING-009)
- [ ] 4.6 Registrar los tres jobs en la `JobQueue` existente con concurrencia 1; validar el test de arranque del worker (presupuesto de conexiones sin cambios)
- [ ] 4.7 Sección de export `import-connections` (sin credenciales); `connection_credential` declarada excluida en el test de cobertura de tablas; importación en `NEEDS_CREDENTIAL` (TC-IMPORTS-BANKING-036)

## 5. INTEGRACIÓN CON EL PIPELINE (requiere `add-import-pipeline`)

- [ ] 5.1 Entrada de registros externos en la etapa normalize; `ImportJob` con `connectionId` y fuentes `EXCHANGE_API`/`EXCHANGE_FILE`; filas de conversión de dos cuentas; señal `POSSIBLE_TRANSFER`; reglas sobre ingresos y gastos (TC-IMPORTS-BANKING-005, -024, -026)
- [ ] 5.2 Idempotencia por referencia de proveedor en la vista previa y la persistencia; archivo y API comparten namespace (TC-IMPORTS-BANKING-020, -021, -022)
- [ ] 5.3 El cursor confirmado avanza solo al completar el import; cancelar o expirar no lo mueve (TC-IMPORTS-BANKING-017, -018)
- [ ] 5.4 Subida del archivo de historial con `connectionId` y detección de formato verificado (TC-IMPORTS-BANKING-027, -028)

## 6. API

- [ ] 6.1 Operaciones de design.md § Contratos en `contracts/openapi/finance-api.v1.yaml` (`writeOnly` y `format: password` en el secreto, `If-Match`, `Idempotency-Key`, `x-rate-limit: costly` en `syncConnection`), códigos nuevos en `ErrorCode` con mensajes es/en/pt; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores
- [ ] 6.2 Tests de API: respuestas sin secretos, 405 en `DELETE`, 409, 412, 422, roles (OWNER para credenciales y revocación) (TC-IMPORTS-BANKING-002, -006, -007, -019, -033)

## 7. UI

- [ ] 7.1 "Conexiones" en Importaciones (docs/28): catálogo de proveedores con disponibilidad y atribución; alta con mapeo de activos y campo de secreto que no se vuelve a mostrar; estado con último error y "requiere atención"; sincronizar (fecha de inicio la primera vez); subir historial; reemplazar credencial; revocar con el recordatorio de borrar la clave en el exchange; i18n es/en/pt
- [ ] 7.2 En la vista previa: filas de conversión con su detalle, señal "posible transferencia", filas excluidas con motivo (con `add-import-pipeline`)

## 8. AUTOMATED TESTS y E2E

- [ ] 8.1 Automatizar TC-IMPORTS-BANKING-001..036 con el TC-ID en el nombre; actualizar front matter
- [ ] 8.2 Integración con PostgreSQL real y el proveedor simulado: crear ⇒ verificar ⇒ sincronizar ⇒ vista previa ⇒ aprobar ⇒ conversiones balanceadas por moneda (INV-004) ⇒ re-sincronizar con ventana solapada ⇒ 0 duplicados; caída del worker a mitad y reanudación; revocar ⇒ credencial indescifrable
- [ ] 8.3 Escaneo de secretos: test que busca el secreto de prueba en logs, respuestas, auditoría, idempotencia y export de una corrida completa y exige 0 apariciones (TC-IMPORTS-BANKING-009)
- [ ] 8.4 E2E (con `PF_E2E_PROJECT` y `IMPORTS_PROVIDER_FAKE_ENABLED`): crear una conexión simulada, sincronizar, aprobar y ver las conversiones; revocar

## 9. ADAPTERS REALES — puerta del owner (no bloquea Phase 6)

- [ ] 9.1 **[owner]** Responder las preguntas 1–3 de design.md; si aprueba la lectura con claves de solo lectura, redactar y aceptar **ADR-0031** "Lectura de movimientos de exchanges con claves de solo lectura" (extiende ADR-0029, cuya C4 sigue vigente para precios)
- [ ] 9.2 **[owner/red]** Desde una red con acceso (máquina del owner o VPS N1; misma limitación que la tarea 1.5 de `add-crypto-rate-providers`): leer el texto vigente de los términos de la API privada y de la exportación de historial de Binance y Bybit; registrar fecha, URLs y resultado en ADR-0031
- [ ] 9.3 **[owner]** Compartir en la conversación (nunca en el repositorio, D255) una exportación real de trades y de depósitos y retiros de cada exchange; fijar las fichas de formato en `docs/statement-formats/exchanges/` con fixtures anonimizados y pasar `formatStatus` a `VERIFIED`
- [ ] 9.4 Adapters `EXCHANGE_FILE_BINANCE` y `EXCHANGE_FILE_BYBIT` con los fixtures de 9.3 y la suite de contrato (requiere 9.3)
- [ ] 9.5 **[owner]** Grabar fixtures anonimizados de los endpoints privados con una clave de solo lectura del owner (la clave nunca en el repositorio ni en la conversación con el agente: la carga el owner en su instancia)
- [ ] 9.6 Adapters `EXCHANGE_API_BINANCE` y `EXCHANGE_API_BYBIT` (verificación de permisos, historial paginado, límites de ADR-0029) con los fixtures de 9.5 y la suite de contrato; descriptores `VERIFIED` solo con 9.1 y 9.2 hechos (requiere 9.1, 9.2 y 9.5)

## 10. DOCUMENTATION

- [ ] 10.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 08, 10, 12, 13, adr, config-reference, statement-formats, docs/38 §2), runbook "Conectar un exchange y revocar una clave" y la matriz de trazabilidad; `pnpm spec:validate` y `pnpm traceability:check` (0 errores, 0 advertencias)
- [ ] 10.2 Al archivar, reemplazar el `## Purpose` "TBD" de `imports/banking-providers` por un propósito real
