# Propuesta: add-import-pipeline

## Why

Phase 6 (docs/24 §5.6) pide «reducir la captura manual mediante imports confiables y clasificación automática», con dos criterios de salida que dependen de este change: **importar 3 meses de extractos reales del owner sin duplicados** y **re-importar el mismo archivo crea 0 transacciones** (el tercero, ≥ 70 % clasificado por reglas, lo mide `add-rule-engine` sobre lo que este change persiste).

Hoy existe el subconjunto CSV básico de Phase 3 (`add-basic-csv-import`, FR-IMPORTS-003): un CSV de una cuenta por `multipart`, mapeo manual sin perfiles, duplicados exactos por huella y probables sin puntaje, todo «sin categoría» y sin deshacer. Faltan los Must de Phase 6: documentos como origen (FR-IMPORTS-001/002), formatos OFX, QIF y JSON (FR-IMPORTS-004), perfiles reutilizables por institución (FR-IMPORTS-005), normalización de extractos bancarios reales (FR-IMPORTS-006), deduplicación con puntaje y resolución registrada (FR-IMPORTS-007, FR-TRANSACTIONS-032), reglas en la vista previa (FR-IMPORTS-008), vista previa editable (FR-IMPORTS-009) e idempotencia por identificador del banco (FR-IMPORTS-010); y los Should de reconciliación contra el extracto (FR-IMPORTS-011) y deshacer (FR-IMPORTS-012). Además, el matching con compromisos de Phase 3 dejó «la confirmación en lote se diseña con el import de Phase 6» (docs/13 §8.3) y las conversiones importadas deben llevar su tasa de referencia (Phase 5, FR-FX-008).

## What Changes

- **Importación desde un documento** (`add-document-attachments`): la UI sube el extracto con propósito «extracto para importar» y crea la importación con `documentId`; el worker lo lee en streaming. La ruta `multipart` del CSV básico se conserva y se marca obsoleta cuando la UI use documentos.
- **Etapas en el worker, reanudables:** lectura → normalización → validación → clasificación (alias, reglas, categoría por defecto) → duplicados (exactos y con puntaje) → coincidencias con compromisos → vista previa. Estados nuevos del job (`UPLOADED`, `PROCESSING`, `PARSE_FAILED`, `COMPLETED_WITH_DIFFERENCE`, `REVERTING`, `ROLLED_BACK`, `PARTIALLY_ROLLED_BACK`) con su máquina en `audit/lifecycle-timeline` (D151). Sin consumidores nuevos: el consumidor `imports.persist` existente atiende también las etapas y el deshacer (D249).
- **Formatos:** CSV, OFX 1.x/2.x, QIF y JSON propio versionado (Must); XLSX (Could, FR-IMPORTS-017). Puerto `StatementParser` por formato, listo para el parser de PDF de un change propio (D277, D282).
- **Perfiles de mapeo** por institución y opcionalmente por cuenta, versionados e inmutables por versión, sugeridos y aplicados automáticamente por encabezado; opciones de extractos bancarios (pie, indicador D/C, descripción multicolumna, alias de moneda, referencia única o no, saldo corrido).
- **Duplicados** (`transactions/duplicate-detection`): puntaje determinista de docs/13 §8.2, preselección de confianza alta, resolución registrada (conservar ambas, fusionar = vincular sin tocar el movimiento existente, excluir), duplicados dentro del archivo, una transacción viva por identificador externo e idempotencia entre formatos y rangos solapados.
- **Vista previa editable** por fila y en lote, con la clasificación propuesta por `add-rule-engine` (orden de etapas acordado) y «reevaluar reglas»; filas como **transferencia** o **conversión** entre cuentas propias (la conversión con su tasa de referencia); **coincidencias con compromisos** confirmadas por el usuario, una por una o «todas las de confianza alta» (D121: nunca automático).
- **Persistencia** por el camino por lote de `add-bulk-imported-transactions`, ampliado con clasificación, transferencias y conversiones.
- **Reconciliación contra el saldo final del extracto** al terminar (sin ajustes automáticos) y **deshacer** un import (anulación con reversa, todo o nada salvo deshacer parcial explícito).
- **Fuera de alcance:** parser de extractos PDF (change propio por D277/D282, pregunta 1); `BankingProvider`, conexiones y adapters de exchange (`add-banking-providers`, que entra por la etapa de normalización); el motor de reglas (`add-rule-engine`); subida, cuarentena y verificación de archivos (`add-document-attachments`); auto-aprobación; pegado desde el portapapeles; plantillas de perfiles de bancos reales sin muestra exportable (pregunta 7); OCR.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `imports/import-pipeline`: pipeline completo (2 requirements MODIFIED, 23 ADDED: 16 Must, 6 Should, 1 Could).
- `transactions/duplicate-detection`: detección y resolución de duplicados en imports (6 ADDED: 4 Must, 2 Should).
- `audit/lifecycle-timeline`: recorrido de una importación (1 ADDED, Must).

## Impact

**Specs impactadas:** `imports/import-pipeline` (MODIFIED «Deduplicación básica con movimientos existentes» y «Aprobación y creación de las transacciones»; 23 ADDED; el `## Purpose` de la spec debe reescribirse al archivar, ya no es solo el subconjunto CSV), `transactions/duplicate-detection` (6 ADDED; el Purpose deja de decir «llega en Phase 6»), `audit/lifecycle-timeline` (1 ADDED). Leídas sin cambios: `rules/rule-engine` y `transactions/transaction-recording` de `add-rule-engine`, `documents/attachments` de `add-document-attachments`, `imports/banking-providers` de `add-banking-providers`, `commitments/recurrence-engine` (matching), `transactions/conversions`, `fx/conversion-pricing`, `transactions/reconciliation`, `transactions/transfers`.

**Componentes/contextos impactados:** IMPORTS (domain: máquina ampliada, `MappingProfile`, lectores por formato, normalizador de extractos, `DuplicateScorer` consumido vía Transactions; application: casos de uso de etapas, perfiles, edición, deshacer; infrastructure: lectores, repos; interface: API y consumidor), TRANSACTIONS (`DuplicateCandidatesQuery.findForImport` con puntaje, índice de referencias externas por institución, `recordBatch` con tipos de movimiento, `ImportedTransactionsCommand.voidBatch`), COMMITMENTS (sin cambios: usa `OccurrenceMatchCandidatesQuery` y `OccurrenceLinkPort`), FX (sin cambios: resolución de la referencia de la conversión), DOCUMENTS y RULES por sus contratos, AUDIT (máquina `IMPORT_JOB`), IDENTITY (secciones de portabilidad), web (asistente y página de perfiles).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: variante JSON de `createImport` con `documentId`; `ImportJob` con campos nuevos; `PATCH` de fila con campos opcionales; operaciones nuevas `bulkEditImportRows`, `reevaluateImportRules`, `confirmImportOccurrenceMatches`, `setImportStatement`, `getImportRevertPreview`, `revertImport` y las de perfiles (`listImportProfiles`, `createImportProfile`, `getImportProfile`, `createImportProfileVersion`, `archiveImportProfile`). Códigos nuevos en `ErrorCode`: `IMPORT_PARSE_FAILED`, `IMPORT_REVERT_BLOCKED`; enum abierto de fila `ImportRowIssueCode` con `IMPORT_CURRENCY_MISMATCH`, `IMPORT_AMBIGUOUS_DATE`, `IMPORT_AMBIGUOUS_NUMBER`, `IMPORT_RUNNING_BALANCE_GAP`, `IMPORT_RULES_UNAVAILABLE`, `IMPORT_OCCURRENCE_LINK_SKIPPED`.

**Tablas impactadas:** nueva `imports.mapping_profile`; columnas nuevas nullable en `imports.import_job` y `imports.staged_transaction`; columnas nuevas en `imports.row_link`; índice único parcial nuevo en `txn.transaction` para referencias `imports.ext:*`.

**Eventos impactados:** nuevos `imports.ImportFileUploaded.v1`, `imports.ImportPreviewReady.v1`, `imports.ImportFailed.v1`, `imports.ImportRevertRequested.v1`, `imports.ImportReverted.v1`; `imports.ImportCompleted.v1` amplía de forma aditiva sus valores de `status` y `sourceType` (enum abierto).

**Migraciones requeridas:** expand-only: tabla nueva con RLS forzada y registro en `platform.workspace_scoped_table`, columnas nullable, CHECK de estados y fuentes ampliados, índice `CONCURRENTLY`. No destructivas.

**Test cases:** AÑADIDOS — TC-IMPORTS-PIPELINE-002..071 (70) y TC-TRANSACTIONS-DEDUPE-001..014 (14). MODIFICADOS — TC-IMPORTS-CSV-020 y TC-IMPORTS-CSV-022 (la decisión de un posible duplicado admite la preselección; sin cambio de su resultado esperado), TC-IMPORTS-CSV-023 (aprobación con la clasificación de la vista previa). DEPRECADOS — ninguno.

**Impacto de regresión:** el CSV básico por `multipart` sigue igual (TC-IMPORTS-CSV-001..030 en verde); la clasificación de duplicados agrega puntaje y preselección sin dejar de exigir decisión; la persistencia agrega tipos de movimiento al camino por lote.

**Riesgos introducidos:** RISK-016 (clasificación o deduplicación incorrecta en masa: mitigado con vista previa obligatoria, decisión exigida para todo candidato y deshacer), RISK-010 (archivos sensibles: binario en DOCUMENTS cifrado, staging purgado a 90 días, sin datos en logs), RISK-006 (formatos bancarios cambiantes: perfiles versionados y «esperando mapeo» con la columna faltante).

**Invariantes afectadas:** INV-001/003 (montos exactos sin redondeo, también en XLSX), INV-004/005/021/023 (asientos de transferencias y conversiones importadas), INV-008 (deshacer = reversa exacta), INV-010/011/012 (conversiones importadas: detalle inmutable, referencia fija), INV-014 (idempotencia por archivo, fila e identificador externo), INV-015 (periodos cerrados bloquean filas y deshacer), INV-029 (auditoría en la misma unidad de trabajo).
