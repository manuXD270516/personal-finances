# Tareas

> Lector de extractos PDF con texto (FR-IMPORTS-016, D324). Requiere aplicados `add-import-pipeline` (54) y `add-document-attachments` (53); los grupos 1 y 2 pueden avanzar antes con `PdfTextDocument` en memoria. Sin consumidores ni conexiones nuevos (D249). **Ningún PDF real entra al repositorio ni a CI** (D255, D281, D282): todo PDF de prueba se genera por código desde los movimientos sintéticos y no se versiona. Sin Docker en la sesión, `pnpm test:integration`, `pnpm test:e2e` y `pnpm perf:bench` los valida CI; se dice en el informe.
>
> **Orden de implementación.** Grupo 1 → 2 (dominio) → 3 (aplicación) → 4 (infraestructura) → 5 (API) → 6 (UI) → 7 (pruebas) → 8 (docs) → 9 (verificación del owner). La pregunta 1 de docs/58 bloquea el grupo 3.4 (falla cerrada); la 4 bloquea el archivado.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `imports/import-pipeline`; `pnpm exec openspec validate add-pdf-statement-parser --strict` (el INFO del MODIFIED es esperado hasta archivar el 54)
- [ ] 1.2 Revisar TC-IMPORTS-PDF-001..049 contra los scenarios (cifras: 155.00 + 0.07 + 1250.00 − 85.50 − 300.25 = 1019.32; 155.00 + 0.07 + 1250.00 − 85.50 = 1319.57; 1319.57 − 1019.32 = 300.25; 2640.00 + 9410.66 = 12050.66; 23.00 + 640.00 + 1325.00 + 2512.18 + 1.61 = 4501.79; 4510.79 − 4501.79 = 9.00; 2640.00 − 2000.00 = 640.00); pasarlos a `ready`
- [ ] 1.3 Verificación cruzada con el 54 (`StatementParser`, `StatementRecord`, normalizador, huella, reconciliación, `ImportFailed.v1`) y el 53 (`DocumentContentReader`, inspección de PDF, D319); registrar diferencias en design.md antes de codificar
- [ ] 1.4 Esquema `contracts/imports/pdf-layout.v1.schema.json` y ampliación aditiva de `imports.profile.v1` (`format = PDF`)

## 2. DOMAIN (TDD)

- [ ] 2.1 Pintor de diseños `tests/fixtures/imports/statements-bo/pdf/paint-statement.ts` (destino `PdfTextDocument` en memoria) desde los `expected.json` sintéticos de BCP, Ganadero y BNB, con las variantes de design.md decisión 14; sin datos reales
- [ ] 2.2 `PdfNumberGrammar` y `PdfDateGrammar` con `SpanishMonths` test-first; PBT de ida y vuelta de montos como texto (TC-IMPORTS-PDF-026..031)
- [ ] 2.3 `PdfLayoutEngine`: palabras, líneas, bandas por rótulos, celdas ambiguas, anclas `DATE` y `AMOUNT`, continuaciones, orden impreso, secciones, filas omitidas test-first (TC-IMPORTS-PDF-017, -019..021, -035)
- [ ] 2.4 Páginas: encabezados y pies repetidos, continuación tras el salto, página en blanco, total de páginas test-first (TC-IMPORTS-PDF-022..025)
- [ ] 2.5 `PdfStatementHeader` (saldos, periodo, moneda, últimos 4 dígitos; descarte del resto) y `PdfCoherenceCheck` (totales, secciones, líneas no reconocidas) test-first (TC-IMPORTS-PDF-032..035)
- [ ] 2.6 `ScannedPageDetector` y `VolatileFragments` (comodín `{n}` sin expresiones regulares) test-first (TC-IMPORTS-PDF-043)
- [ ] 2.7 Descriptores `bo.bcp.cuenta.v1.json`, `bo.ganadero.cuenta.v1.json` y `bo.bnb.cuenta.v1.json` derivados de las fichas (literales de detección sin nombres de banco ni datos del titular) y diseño de prueba con coma decimal (no publicado)

## 3. APPLICATION

- [ ] 3.1 Puerto `PdfTextExtractor` y `PdfLayoutRegistry`; resolución del diseño (perfil de la cuenta → institución → detección por literales, versión más reciente primero) y `IMPORT_PDF_LAYOUT_UNKNOWN` (TC-IMPORTS-PDF-012..014)
- [ ] 3.2 `PdfStatementParser` como `StatementParser` en la etapa `PARSE`: búfer acotado, extracción, motor, `StatementRecord`/`StatementBalance`; staging solo después de la coherencia; reentrega idempotente (TC-IMPORTS-PDF-003)
- [ ] 3.3 Verificación de cuenta (`accountNumberLast4`) y moneda; `IMPORT_PDF_ACCOUNT_MISMATCH`, `IMPORT_PDF_ACCOUNT_UNVERIFIED`, `IMPORT_CURRENCY_MISMATCH` (TC-IMPORTS-PDF-038..040)
- [ ] 3.4 Falla cerrada por coherencia según la pregunta 1 de docs/58 (`IMPORT_PDF_TOTALS_MISMATCH`, `IMPORT_PDF_PAGE_COUNT_MISMATCH`, `IMPORT_PDF_NO_TEXT`) con `pdf.coherence` sin textos (TC-IMPORTS-PDF-010, -011, -033, -034)
- [ ] 3.5 Diferencia del saldo inicial con `AccountBalanceAtPort` al llegar a revisión (TC-IMPORTS-PDF-036, -037)
- [ ] 3.6 Huella con fragmentos variables del diseño; re-descarga del mismo mes = 0 nuevas (TC-IMPORTS-PDF-042, -043)

## 4. INFRASTRUCTURE

- [ ] 4.1 `pdfjs-dist` en el catálogo (versión ≥ la que corrige CVE-2024-4367) sin su dependencia opcional nativa; test de arquitectura que verifica que no hay binarios nativos ni `canvas` instalados o importados; `pnpm arch:check`
- [ ] 4.2 `PdfjsTextExtractor` + `pdf-text-extractor.worker.ts`: `worker_thread` por documento, `resourceLimits`, `env: {}`, transferencia del búfer, temporizador con `terminate`, límites de páginas, fragmentos y caracteres, opciones de PDF.js de design.md decisión 2 (`isEvalSupported: false`, recursos locales), sin metadatos, respuesta validada con `zod`; el archivo del hilo en la salida de compilación (TC-IMPORTS-PDF-004..009)
- [ ] 4.3 Generador PDF del pintor con `pdfkit` (`devDependency`), fechas fijas, en memoria o `os.tmpdir()`; variantes: carácter por carácter, orden aleatorio con semilla, contraseña de propietario, páginas de imagen, truncado, 201 páginas, 100 páginas con 5 000 movimientos
- [ ] 4.4 `PdfLayoutRegistry` sobre archivos con validación al arrancar y `pdf-layouts.lock.json` (SHA-256 por versión publicada); test de inmutabilidad (TC-IMPORTS-PDF-015)
- [ ] 4.5 Migración expand: `imports.import_job.pdf jsonb`, CHECK de `format`/`source` (`PDF`, `FILE_PDF`) y de `imports.mapping_profile.format`; export del workspace con `pdf` y su JSON Schema; ida y vuelta en verde
- [ ] 4.6 Config `IMPORT_PDF_*` en `@pf/platform` con rangos validados y `docs/config-reference.md` (`pnpm config:docs`); test de arranque del worker con la plantilla del host (sin consumidores nuevos; memoria del hilo dentro del presupuesto)
- [ ] 4.7 Test de política «sin PDF versionados» sobre `git ls-files` y regla en `.gitignore` (TC-IMPORTS-PDF-044)
- [ ] 4.8 (Could) `pnpm imports:pdf:probe`: salida estructural sin valores, con test sobre el fixture (TC-IMPORTS-PDF-047)

## 5. API y eventos

- [ ] 5.1 `contracts/openapi/finance-api.v1.yaml`: `PDF`/`FILE_PDF` en los enums abiertos, `ImportPdfInfo` en `ImportJob`, `format = PDF` en perfiles, `ErrorCode` e `ImportRowIssueCode` nuevos con mensajes es/en/pt; `pnpm contract:breaking`, Spectral y Redocly limpios
- [ ] 5.2 `contracts/events/README.md`: valores nuevos de los enums abiertos y códigos de `ImportFailed.v1`
- [ ] 5.3 Tests de API validados contra el OpenAPI: PDF aceptado y PNG rechazado al crear (TC-IMPORTS-PDF-001, -002); `getImport` con `pdf` en cada código de falla

## 6. UI (web)

- [ ] 6.1 Asistente de importación: subir PDF como extracto; mostrar diseño y versión, saldo del extracto, coherencia, diferencia de saldo inicial y advertencia de cuenta no verificada; mensajes de falla por código (escaneado con la alternativa, diseño desconocido, coherencia con páginas y líneas, otra cuenta) en es/en/pt
- [ ] 6.2 Perfil PDF de la cuenta: fijar la versión del diseño (sin edición de columnas)

## 7. Pruebas y E2E

- [ ] 7.1 Golden: los tres PDF generados se leen exactamente igual a sus `expected.json` (TC-IMPORTS-PDF-045); variantes de dibujo con el mismo resultado (TC-IMPORTS-PDF-016, -018)
- [ ] 7.2 Integración del pipeline completo con PDF: revisión, aprobación, reconciliación `COMPLETED`, re-descarga = 0 (TC-IMPORTS-PDF-003, -012, -042); Financial Regression Suite: -033, -042, -045
- [ ] 7.3 Seguridad: metadatos y datos del titular ausentes del staging, job, auditoría, outbox y logs con expresiones con límites (TC-IMPORTS-PDF-009, -041); límites del hilo (-004..-007)
- [ ] 7.4 E2E con `PF_E2E_PROJECT` (TC-IMPORTS-PDF-048, -049)
- [ ] 7.5 Benchmark: fila informativa de PDF de 100 páginas en `imports.perf.ts` (TC-IMPORTS-PDF-046)
- [ ] 7.6 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`, `pnpm test:integration` (dos veces), `pnpm test:e2e`

## 8. Docs

- [ ] 8.1 docs/01 (FR-IMPORTS-016 a Phase 6 con la prioridad de la pregunta 4), docs/13 (§1, §5, §6.3, §7), docs/12 (threat model del lector), docs/08, docs/10, docs/11, docs/28 según design.md § Cambios a docs compartidos
- [ ] 8.2 `docs/statement-formats`: README y fichas BCP, Ganadero y BNB con el diseño publicado y su versión; extracción por coordenadas como decisión
- [ ] 8.3 Runbook: importar un extracto PDF y usar el diagnóstico local; docs/38 con el estado

## 9. Verificación del owner (fuera del repositorio)

- [ ] 9.1 El owner corre `pnpm imports:pdf:probe` sobre un extracto real de BCP y uno de Ganadero (y BNB) en su máquina y comparte solo la salida estructural; si algo no cuadra, se corrige el diseño con un fixture sintético nuevo que reproduzca el caso (procedimiento D281) y, si ya estaba publicado, en una versión nueva
- [ ] 9.2 Con la salida de la 9.1, decidir la publicación de `bo.bnb.cuenta@1` (pregunta 3)
- [ ] 9.3 Tras la validación, proponer en el change 41 (tarea 4.2) `statementImport = SUPPORTED` para las entidades validadas
- [ ] 9.4 Criterio de salida de Phase 6: el owner importa 3 meses reales en su entorno, sin duplicados, y re-importa uno con 0 transacciones creadas; registra el resultado (sin datos) en docs/38
