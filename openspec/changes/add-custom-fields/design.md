# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Este change crea `classification/custom-fields` (ARCHITECTURE §14) y extiende `transactions/transaction-recording`. Fuentes: FR-CLASSIFICATION-009, FR-TRANSACTIONS-003/026, docs/04 §3.4–§3.5 (AR `CustomFieldDefinition` en CLASSIFICATION; `CustomFieldValue` propiedad de TRANSACTIONS sobre el split, nota de docs/04: "los valores asignados son propiedad de Transactions; Classification es dueño de los catálogos"), docs/05 §2.5 (`ValidateClassification(…, customFields)`, evento `CustomFieldDefinitionChanged`), docs/08 §5.4–§5.5 (`classification.custom_field_definition`, `txn.split_custom_field_value`, "Phase 2, aún no creadas") y docs/10 §13 (`W/custom-fields`).

Capas afectadas:

| Capa | Cambios |
|---|---|
| domain | CLASSIFICATION: AR `CustomFieldDefinition` (`id, key, label, dataType, target, required, options[{key, label, position}], position, archivedAt, version, hasValues` derivado por query); reglas de clave, tipo y opciones; `CustomFieldValueValidator` puro (por tipo). TRANSACTIONS: VO `CustomFieldValue { fieldId, value }` en `TransactionSplit`; ACCOUNTS: en `Account`. |
| application | CLASSIFICATION: `DefineCustomField`, `UpdateCustomField`, `ArchiveCustomField`, `UnarchiveCustomField`; query pública `ValidateCustomFieldValues(target, values[], { requireMandatory })` y `ListActiveCustomFields` (caché por workspace invalidada por versión). TRANSACTIONS/ACCOUNTS: los comandos de creación/edición validan por el puerto; `ApplyClassification` acepta `customFields` (mismo camino que bulk edit). |
| infrastructure | Migración con las tres tablas; repositorios Kysely; consulta de "definición en uso" (`EXISTS` en las tablas de valores) para los bloqueos. |
| interface | `W/custom-fields` (CRUD + archive/unarchive); `customFields` en DTOs de split y cuenta; filtro `customField[<key>]=` / `customField[<key>][gte|lte]=` en `listTransactions`. UI: pantalla de configuración "Campos personalizados", inputs dinámicos por tipo en formularios de transacción (por split en modo avanzado) y cuenta, columnas y filtros opcionales en el registro. |

## Objetivos / No objetivos

**Objetivos:** FR-CLASSIFICATION-009 completo para transacciones (por split) y cuentas; filtro en el listado.

**No objetivos:** `MULTI_SELECT`/`MONEY`, custom fields en transferencias/conversiones u otras entidades, reglas automáticas, reportes por custom field, máquina de estados de la definición.

## Decisiones

1. **Tipos según FR-CLASSIFICATION-009** (`TEXT`, `NUMBER`, `DECIMAL`, `DATE`, `BOOLEAN`, `SELECT`), que prevalece sobre la lista de docs/04 (`MULTI_SELECT`, `MONEY`) y de docs/08 (`ENUM`): `SELECT` reemplaza a `ENUM`. `NUMBER` = entero (|n| < 10^15) y `DECIMAL` (hasta 18 decimales) comparten la columna `value_number numeric(38,18)`, con entrada/salida como string decimal (INV-001: nunca `number` de JS). Pregunta abierta 1 sobre `MULTI_SELECT`/`MONEY`.
2. **Objetivo `TRANSACTION` vive en el split** (docs/08 `txn.split_custom_field_value`, FR-TRANSACTIONS-026): con un único split la UI lo presenta a nivel transacción; en multi-split, por split. Al cambiar montos de splits (reversa + nueva revisión) los valores se copian a los splits nuevos que conservan su posición; los splits reemplazados conservan sus valores históricos (no se borran: las filas de valores de splits reemplazados se mantienen).
3. **Objetivo `ACCOUNT`** en `accounts.account_custom_field_value` (valores propiedad de ACCOUNTS; validación por el puerto de CLASSIFICATION).
4. **Opciones con clave estable** (`[{ key, label, position }]` en `jsonb`): los valores guardan la clave, así renombrar la etiqueta no toca valores; eliminar una opción usada ⇒ `CUSTOM_FIELD_OPTION_IN_USE`.
5. **Bloqueos por uso**: `dataType` y `target` no cambian si existe algún valor (activo o histórico) ⇒ `CUSTOM_FIELD_TYPE_LOCKED`; si no hay valores se permite (la definición es solo catálogo).
6. **Obligatoriedad no retroactiva**: se valida en creación y cuando el comando de edición incluye `customFields` (o cambia montos de splits, que regenera splits) — no en ediciones descriptivas. Hacer obligatorio un campo existente no requiere migrar datos.
7. **Archivado**: `archived_at` (soft-archive, docs/08 §1); la unicidad de `key` es parcial sobre activas (`WHERE archived_at IS NULL`), por eso la clave queda libre. Desarchivar con una activa de la misma clave ⇒ `CUSTOM_FIELD_KEY_TAKEN`.
8. **Periodos cerrados** (alcance único del requirement "Alcance de la edición en periodos cerrados" de `planning/month-closing`, extensión de D49 consolidada el 2026-10-05 y confirmada por el owner, docs/33 D65; pregunta abierta 2): cambiar valores de transacciones con `business_date` en un periodo cerrado ⇒ `PERIOD_CLOSED` vía `LedgerService.assertPeriodOpen({date})` (mes calendario hasta ADR-0028; por rango del periodo financiero después). Sin cierres (antes de `add-month-closing`) el chequeo es inocuo. Valores de cuentas no dependen de periodos.
9. **Auditoría y eventos**: valores dentro del diff de `transactions.transaction.updated` / `accounts.account.updated` (un campo `customFields.<key>` por clave con antes/después — con varios splits, un texto JSON con el valor de cada split —; la allow-list de AUDIT admite el comodín de prefijo `customFields.*`; `TEXT` puede contener datos personales: se trata como PII baja y se enmascara en logs, docs/12 §13.1). Evento `classification.CustomFieldDefinitionChanged.v1` (`fieldId`, `key`, `change: DEFINED|UPDATED|ARCHIVED|UNARCHIVED`, `dataType`, `target`) para invalidar cachés; los valores no viajan en eventos.
10. **Límites**: máximo 50 definiciones activas por workspace y 20 valores por split/cuenta (`VALIDATION_FAILED`), para acotar formularios y consultas.
11. **Filtro**: igualdad para todos los tipos; `gte`/`lte` para `NUMBER`, `DECIMAL`, `DATE`. Índices por tipo de valor: `(workspace_id, field_id, value_text)`, `(…, value_number)`, `(…, value_date)`, `(…, value_bool)`.

### Contratos (OpenAPI)

| Operación | Ruta | Rol |
|---|---|---|
| `listCustomFields` | `GET W/custom-fields?target=&includeArchived=` | VIEWER |
| `createCustomField` | `POST W/custom-fields` (`Idempotency-Key`) | EDITOR |
| `getCustomField` | `GET W/custom-fields/{id}` | VIEWER |
| `updateCustomField` | `PATCH W/custom-fields/{id}` (`If-Match`) | EDITOR |
| `archiveCustomField` / `unarchiveCustomField` | `POST W/custom-fields/{id}/archive|unarchive` (`If-Match`) | EDITOR |

Schemas: `CustomFieldDefinition`, `CustomFieldDefinitionCreate`, `CustomFieldDefinitionUpdate`, `CustomFieldOption`, `CustomFieldValues` (mapa `clave → string | boolean`; los números y decimales viajan como string) y `CustomFieldValuesInput` (mapa `clave → valor | null`; `null` quita, lo no mencionado se conserva). **As-built (2026-10-08):** `TransactionSplit.customFields` ya existía en el contrato como mapa por clave, así que se conserva esa forma (cambiarla a una lista `[{fieldId, key, value}]` sería un cambio incompatible para oasdiff); `Account.customFields` y `SplitInput`/`AccountCreate`/`AccountUpdate.customFields` siguen el mismo mapa. Códigos nuevos (proposal.md). No hay `DELETE` de definiciones (405, como categorías, D7). El filtro del listado se declara como parámetro `customField` con `style: deepObject` (`customField[clave]=v`, `customField[clave][gte|lte]=v`); la validación de contrato anida las claves planas del parser de consulta de Express.

### Modelo de datos

| Tabla | Definición | RLS / grants |
|---|---|---|
| `classification.custom_field_definition` | `id`, `workspace_id`, `key` (CHECK `^[a-z][a-z0-9_]{0,39}$`), `label` (1–80), `data_type` CHECK IN (`TEXT`,`NUMBER`,`DECIMAL`,`DATE`,`BOOLEAN`,`SELECT`), `target` CHECK IN (`TRANSACTION`,`ACCOUNT`), `required bool`, `options jsonb` (CHECK `data_type='SELECT' ⇔ jsonb_array_length(options) ≥ 1`), `position int`, `archived_at/by`, `version`, `created_*`/`updated_*`. Único parcial `(workspace_id, key) WHERE archived_at IS NULL` | WS forzada; `pf_app` SELECT/INSERT/UPDATE |
| `txn.split_custom_field_value` | PK `(workspace_id, split_id, field_id)`, `value_text`, `value_number numeric(38,18)`, `value_date`, `value_bool`; CHECK `num_nonnulls(...) = 1` (docs/08); FK compuesta a `txn.transaction_split`; `field_id` sin FK cross-schema (NFR-DATA-015) | WS; `pf_app` SELECT/INSERT/UPDATE/DELETE (tabla de enlace, docs/08 §8) |
| `accounts.account_custom_field_value` | PK `(workspace_id, account_id, field_id)`, mismas columnas de valor | WS; SELECT/INSERT/UPDATE/DELETE |

Las tres se registran en `platform.workspace_scoped_table` y se incluyen en el export del workspace (`add-workspace-export`).

## Riesgos / Trade-offs

- **Valores borrables (tabla de enlace)**: quitar un valor es `DELETE` de la fila; la historia queda en la auditoría (antes/después), como `txn.split_tag`. Alternativa (valores versionados por revisión) descartada por costo.
- **Latencia de creación de transacciones** por validar custom fields: caché de definiciones activas por workspace (invalidada por `version`/evento) ⇒ sin consulta extra en el camino caliente.
- **Filtros combinados** pueden degradar NFR-PERF-001: un filtro de custom field se resuelve primero por índice y luego se intersecta con el resto; benchmark con 50k transacciones y 10k valores.

## Plan de migración

1. Expand `20261008130000_classification_custom_fields.sql`: tres tablas, RLS forzada, grants, índices, `platform.workspace_scoped_table`. No destructiva, compatible N-1.
2. Contrato: operaciones nuevas y campos opcionales nuevos (MINOR).
3. Sin backfill.

## Preguntas abiertas

**Todas resueltas por el owner el 2026-10-08** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md), decisiones D59–D111); cada pregunta indica su decisión. Se conserva el texto original.

1. **Tipos `MULTI_SELECT` y `MONEY`** (docs/04). ¿Se necesitan? **Recomendación:** no en Phase 2; `MONEY` exige moneda y reglas de escala (mejor modelarlo como split o como dato de Debt/Goals), `MULTI_SELECT` se cubre con tags. → **Resuelta por el owner (2026-10-08): D96** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
2. **Custom fields de transacciones en periodos cerrados.** ¿Se rechaza el cambio con `PERIOD_CLOSED` (extensión de D49)? **Recomendación:** sí, igual que categoría y tags (misma respuesta que la pregunta 1 de `add-bulk-edit`). → **Resuelta por el owner (2026-10-08): D65** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
3. **Custom fields en transferencias y conversiones.** ¿Deben admitirse (a nivel cabecera, sin split nominal)? **Recomendación:** no en Phase 2; si el owner lo necesita (p. ej. "número de operación" de una conversión P2P), se agrega como valor de cabecera en un change posterior. → **Resuelta por el owner (2026-10-08): D97** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).

## Dependencias entre changes

- **Requiere aplicados:** `add-classification` (catálogo y `ClassificationValidator`), `add-transaction-recording`, `add-accounts-management`, `add-audit-trail`.
- **Lo consumen:** `add-bulk-edit` (requirement "Custom fields en la edición masiva"), `add-workspace-export` (definiciones y valores en el export/import).
- **Coordina con pf-p2a** (`planning/financial-periods`): `PERIOD_CLOSED` por `ledger.period_lock`.
- **Sin dependencia con pf-p2b**: los presupuestos no se segmentan por custom field en Phase 2.
