# Propuesta: add-pdf-statement-parser

## Why

El criterio de salida de Phase 6 (docs/24 §5.6) pide **importar 3 meses de extractos reales del owner sin duplicados** y que **re-importar el mismo archivo cree 0 transacciones**. Los extractos reales que el owner compartió son **PDF con texto** de cuatro entidades (BCP, Banco Ganadero, BISA y BNB; fichas en [docs/statement-formats](../../../docs/statement-formats/README.md), D282) y no hay evidencia de que su banca en línea exporte CSV o XLS (docs/38 §2). El pipeline de `add-import-pipeline` (change 54) deja listo el puerto `StatementParser` pero rechaza los PDF con `IMPORT_UNSUPPORTED_FORMAT`; sin un lector de PDF, el criterio de salida no se puede verificar. El owner decidió abrir ya este change (D324, respuesta a la pregunta 14 de docs/56, sobre el umbral de D277 cumplido por D282), en paralelo con su confirmación de si el banco exporta CSV o XLS. FR-IMPORTS-016 (parsers de PDF por institución, «best effort, siempre con preview») estaba en Phase 11 como Could: este change lo adelanta a Phase 6.

## What Changes

- **Formato PDF como entrada del pipeline:** un documento `IMPORT_SOURCE` detectado como PDF (`add-document-attachments`, ya verificado: sin JavaScript, acciones, adjuntos ni XFA, y sin contraseña de apertura, D319) se acepta al crear la importación y entra por la etapa de lectura del pipeline con el mismo flujo de vista previa, duplicados, reglas, aprobación, reconciliación y deshacer del change 54. Ningún atajo: siempre vista previa (D346).
- **Extracción de texto con posiciones en un `worker_thread` aislado** dentro del worker, con límites de memoria, tiempo, páginas y elementos de texto, y falla cerrada. Biblioteca: **`pdfjs-dist`** (Apache-2.0, Mozilla), solo lectura de texto, sin render, sin `eval` ni fuentes del sistema y sin binarios nativos (design.md decisión 2, con alternativas descartadas).
- **Reconstrucción de la tabla por columnas** a partir de las coordenadas (no del orden del flujo de contenido): agrupación por línea base, bandas de columna derivadas de los rótulos del encabezado de la tabla, glosas multilínea, saltos de página con encabezados y pies repetidos, secciones con signo (BNB) y filas no cronológicas conservadas en el orden impreso.
- **Diseños de extracto por institución, versionados e inmutables** (`imports.pdf-layout.v1`): descriptores declarativos derivados de las fichas existentes, detectados por literales del encabezado y registrados en la importación con su versión. En este change: BCP y Banco Ganadero (Must), BNB (Should). BISA queda fuera hasta una muestra con movimientos (ficha: «el parser no debe escribirse sin una muestra con actividad»; pregunta 2 de docs/58).
- **Montos y fechas exactos:** separadores de miles y decimal declarados por diseño (es-BO real: punto o coma según la entidad), texto → `Decimal` sin pasar por `number` y sin redondeo (INV-001, INV-003); fechas por formato declarado y meses en español por tabla propia, sin depender del locale del sistema.
- **Saldo inicial y final del extracto y coherencia interna:** el saldo inicial, el final y el periodo salen del extracto y alimentan la reconciliación del change 54; si `saldo inicial + Σ movimientos ≠ saldo final`, o faltan páginas, la importación falla (`IMPORT_PDF_TOTALS_MISMATCH`, `IMPORT_PDF_PAGE_COUNT_MISMATCH`) en lugar de mostrar una vista previa incompleta. La vista previa muestra además la diferencia entre el saldo inicial del extracto y el saldo de la cuenta al día anterior (meses faltantes o movimientos manuales sin importar).
- **Cuenta y moneda verificadas** contra la cuenta destino (últimos 4 dígitos y etiqueta de moneda); los demás datos del encabezado (titular, dirección, operador) y los metadatos del PDF se descartan y nunca se guardan ni se registran.
- **PDF escaneado sin texto: rechazo explícito** con `IMPORT_PDF_NO_TEXT` y una indicación para el usuario; sin OCR (FR-DOCUMENTS-009 sigue en Phase 11).
- **Pruebas sin datos reales:** los PDF de prueba se **generan por código** con `pdfkit` (ya en el catálogo) desde los `expected.json` sintéticos existentes y nunca se versionan; un test de política impide versionar archivos `.pdf` (D255, D281, D282). Herramienta local opcional de diagnóstico estructural para que el owner valide sus PDF reales sin compartir valores.
- **Fuera de alcance:** OCR y PDF escaneados; BISA; plantillas de CSV o XLS (D330); mapeo manual de columnas de un PDF por el usuario; PDF de tarjetas de crédito y de otros bancos sin ficha; cambiar la inspección de seguridad de DOCUMENTS.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `imports/import-pipeline`: lectura de extractos PDF con texto (1 requirement MODIFIED, 13 ADDED: 10 Must, 2 Should, 1 Could).

## Impact

**Specs impactadas:** `imports/import-pipeline` (MODIFIED «Formatos de archivo detectados por contenido», que agrega `add-import-pipeline`: el PDF con texto pasa a ser importable; 13 ADDED). Leídas sin cambios: `documents/attachments` y `security/file-upload-security` de `add-document-attachments` (inspección y lectura del documento), `transactions/duplicate-detection` y el resto del delta de `add-import-pipeline`, `transactions/reconciliation`.

**Componentes/contextos impactados:** IMPORTS (domain: `PdfTextDocument`, `PdfLayout`, `PdfLayoutEngine`, `PdfCoherenceCheck`, tabla de meses; application: resolución del diseño en la etapa de lectura, diferencia de saldo inicial; infrastructure: `PdfjsTextExtractor` y su `worker_thread`, `PdfStatementParser`, registro de diseños versionados; interface: campos nuevos de la API y del asistente), ACCOUNTS (sin cambios: `accountNumberLast4` e institución por `GetAccount`), TRANSACTIONS (sin cambios: `BalanceQuery` para el saldo al día anterior), DOCUMENTS (sin cambios: `DocumentContentReader.open`), web (asistente de importación).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `PDF` en el formato de la importación y `FILE_PDF` en su fuente (enums abiertos), objeto `ImportJob.pdf` (diseño y versión, páginas, coherencia, diferencia del saldo inicial, avisos). Códigos nuevos en `ErrorCode` (`x-extensible-enum`, mensajes es/en/pt): `IMPORT_PDF_NO_TEXT`, `IMPORT_PDF_LAYOUT_UNKNOWN`, `IMPORT_PDF_EXTRACTION_FAILED`, `IMPORT_PDF_TOTALS_MISMATCH`, `IMPORT_PDF_PAGE_COUNT_MISMATCH`, `IMPORT_PDF_ACCOUNT_MISMATCH`; `ImportRowIssueCode` agrega `IMPORT_PDF_AMBIGUOUS_CELL` e `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`.

**Tablas impactadas:** `imports.import_job` (columna nullable `pdf jsonb`; CHECK de `format` y `source` ampliados con `PDF` y `FILE_PDF`), `imports.mapping_profile` (CHECK de `format` ampliado con `PDF`). Sin tablas nuevas.

**Eventos impactados:** `imports.ImportFileUploaded.v1` y `imports.ImportCompleted.v1` admiten `PDF` y `FILE_PDF` en sus enums abiertos (aditivo); `imports.ImportFailed.v1` lleva los códigos nuevos. Sin eventos ni consumidores nuevos (D249): la lectura corre en el consumidor `imports.persist`.

**Migraciones requeridas:** expand-only: columna nullable y CHECK ampliados. No destructivas.

**Dependencias nuevas:** `pdfjs-dist` (Apache-2.0) en `@pf/imports`, fijada en el catálogo y sin su dependencia opcional nativa; `pdfkit` (MIT, ya en el catálogo) solo como dependencia de desarrollo para generar los fixtures.

**Test cases:** AÑADIDOS — TC-IMPORTS-PDF-001..049 (49). MODIFICADOS — ninguno. DEPRECADOS — TC-IMPORTS-PIPELINE-012 (scenario «Documento PDF» de `add-import-pipeline`, reemplazado por TC-IMPORTS-PDF-001 y -002; se depreca al archivar este change, después del 54).

**Impacto de regresión:** los lectores CSV, OFX, QIF, JSON y XLSX no cambian; la huella de fila del CSV básico no cambia (los fragmentos variables solo existen en diseños PDF); un PDF que antes se rechazaba al crear la importación ahora se acepta y se procesa en el worker.

**Riesgos introducidos:** RISK-006 (formatos bancarios cambiantes: diseños versionados, detección por literales y falla cerrada por coherencia), RISK-010 (archivos sensibles: encabezado y metadatos descartados, logs sin valores, PDF reales fuera del repositorio), RISK-016 (lectura incorrecta en masa: coherencia de saldos obligatoria y vista previa), riesgo nuevo de parser no confiable (CVE en la biblioteca de PDF: `worker_thread` con límites, sin `eval`, sin render, inspección previa de DOCUMENTS, Renovate y Trivy).

**Invariantes afectadas:** INV-001/003 (montos exactos sin redondeo), INV-014 (idempotencia: re-descargar el mismo mes crea 0 transacciones), INV-029 (auditoría en la misma unidad de trabajo, sin cambios).
