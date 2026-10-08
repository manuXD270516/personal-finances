# Propuesta: add-custom-fields

## Why

Categorías, tags y contrapartes no cubren todos los atributos que el owner quiere registrar: número de factura para el crédito fiscal, centro de costo (casa/oficina), persona del hogar que pagó, número de cuota, fecha de vencimiento de una garantía, o datos propios de una cuenta (sucursal, ejecutivo). FR-CLASSIFICATION-009 (Should, Phase 2, `classification/custom-fields`) pide definir campos personalizados tipados (texto, número, decimal, fecha, booleano, selección), con opciones, obligatoriedad y entidad objetivo (`transaction`/`account`), validar sus valores y conservar los valores históricos al archivar la definición. FR-TRANSACTIONS-003/026 ya prevén custom fields en la transacción y en cada split, y docs/08 diseñó `classification.custom_field_definition` y `txn.split_custom_field_value` como "Phase 2, aún no creadas".

## What Changes

- **Catálogo de definiciones** (CLASSIFICATION): clave `snake_case` única entre las activas e inmutable, etiqueta, tipo `TEXT | NUMBER | DECIMAL | DATE | BOOLEAN | SELECT`, opciones (para `SELECT`, con clave estable y etiqueta), obligatoriedad, entidad objetivo `TRANSACTION | ACCOUNT`, orden; archivar/desarchivar sin perder valores; cambios de definición restringidos cuando ya hay valores (tipo y objetivo bloqueados, opciones en uso no removibles).
- **Valores** validados contra la definición: en transacciones, por split nominal (FR-TRANSACTIONS-026; con un único split se muestran como de la transacción); en cuentas, por cuenta. Los decimales viajan como string exacto (nunca punto flotante).
- **Obligatoriedad no retroactiva**: un campo obligatorio se exige al crear transacciones/cuentas nuevas y al editar sus custom fields, no a los registros existentes.
- **Sin efecto en el ledger** (INV-033) y **periodos cerrados** respetados (`PERIOD_CLOSED`, extensión de D49 para custom fields de transacción).
- **Listado de transacciones** filtrable por valor de custom field (igualdad; rango para número/decimal/fecha).
- Evento `classification.CustomFieldDefinitionChanged.v1`; cambios de valores en `transactions.TransactionUpdated.v1` (`changedFields=[customFields]`) y `accounts.AccountUpdated.v1`.
- **Fuera de alcance:** tipos `MULTI_SELECT` y `MONEY` (docs/04 los menciona; fuera de Phase 2 por decisión del owner, docs/33 D96), custom fields en transferencias y conversiones (no tienen split nominal), en categorías/contrapartes/metas/préstamos, reglas que fijan custom fields (Phase 6, `SET_CUSTOM_FIELD`), reportes por custom field (Phase 7), recorrido (máquina de estados) de las definiciones.

## Capabilities

### New Capabilities
- `classification/custom-fields`: definiciones tipadas con clave estable, opciones, obligatoriedad y entidad objetivo; validación de valores; valores en splits de transacciones y en cuentas; archivado con conservación de valores; cambios de definición protegidos; periodos cerrados; control por rol.

### Modified Capabilities
- `transactions/transaction-recording`: MODIFIED `Datos de la transacción` (valores de custom fields por split) y `Listado y filtrado de transacciones` (filtro por custom field).

## Impact

**Specs impactadas:** crea `classification/custom-fields` (11 requirements: 1 Must, 10 Should); modifica 2 requirements Must de `transactions/transaction-recording`.

**Componentes/contextos impactados:** CLASSIFICATION (`@pf/classification`): agregado `CustomFieldDefinition`, query `ValidateCustomFieldValues` en `ClassificationValidator` (contrato público), comandos `DefineCustomField`, `UpdateCustomField`, `ArchiveCustomField`, `UnarchiveCustomField`. TRANSACTIONS: VO `CustomFieldValue` en `TransactionSplit`, persistencia y filtro. ACCOUNTS: valores en `Account`. `apps/api` y `apps/web` (configuración de campos, inputs dinámicos en formularios de transacción y cuenta, filtro en el registro).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `listCustomFields`, `createCustomField`, `getCustomField`, `updateCustomField`, `archiveCustomField`, `unarchiveCustomField` (`W/custom-fields`, docs/10 §13); campo `customFields` en `TransactionSplit`/`TransactionSplitInput` y en `Account`/`AccountCreate`/`AccountUpdate`; parámetro `customField[<key>]` en `listTransactions`. Códigos nuevos: `CUSTOM_FIELD_KEY_TAKEN` (409), `CUSTOM_FIELD_ARCHIVED` (409), `CUSTOM_FIELD_TYPE_LOCKED` (409), `CUSTOM_FIELD_OPTION_IN_USE` (409), `CUSTOM_FIELD_VALUE_INVALID` (422), `CUSTOM_FIELD_REQUIRED` (422), `CUSTOM_FIELD_TARGET_MISMATCH` (422).

**Tablas impactadas:** nuevas `classification.custom_field_definition`, `txn.split_custom_field_value`, `accounts.account_custom_field_value` (docs/08 §5.4/§5.5 con ajustes: tipos de FR-CLASSIFICATION-009, `target`, opciones con clave).

**Eventos impactados:** nuevo `classification.CustomFieldDefinitionChanged.v1`; `transactions.TransactionUpdated.v1` y `accounts.AccountUpdated.v1` con `customFields` en `changedFields` (sin cambio de schema: `changedFields` es lista abierta; los valores no viajan en el evento).

**Migraciones requeridas:** expand, no destructiva: tres tablas nuevas con RLS forzada por `workspace_id`, grants (`DELETE` permitido solo en las tablas de valores, que son de enlace, docs/08 §8) y registro en `platform.workspace_scoped_table`.

**Invariantes afectadas:** INV-001 (decimales como string exacto), INV-015 (periodos cerrados), INV-019 (definición archivada no asignable, valores conservados), INV-029, INV-033.

**Test cases:** AÑADIDOS — TC-CLASSIFICATION-CUSTOMFIELD-001..011, TC-TRANSACTIONS-CUSTOMFIELD-001, TC-TRANSACTIONS-CUSTOMFIELD-002 (`draft`/`ready`, `not_automated`). MODIFICADOS — ninguno (los TC vigentes de `Datos de la transacción` y del listado siguen válidos: los custom fields son opcionales). DEPRECADOS — ninguno.

**Impacto de regresión:** el payload de splits y cuentas gana un campo opcional; los TC de ida y vuelta de transacciones y cuentas deben seguir verdes sin custom fields. El cálculo de splits (INV-021) y el traductor de postings no cambian.

**Riesgos introducidos:** crecimiento de la consulta del listado con filtros por custom field (índice por `(workspace_id, field_id, valor)`); validación de valores en el camino caliente de creación de transacciones (NFR-PERF-003; caché por workspace de las definiciones activas).
