# Diseño: add-pdf-statement-parser

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: docs/01 FR-IMPORTS-004, 006, 010, 011 y **016** (parsers de PDF por institución, «best effort, siempre con preview»; Phase 11 → Phase 6 por D324); docs/02 NFR-PERF-007, NFR-SEC-012, 013 y 015; docs/13 §5 (adapters de entrada), §7 (idempotencia), §9 (reconciliación), §11 (archivos grandes), §12 (locale), §13 (seguridad); **[docs/statement-formats](../../../docs/statement-formats/README.md)** (fichas de BCP, Ganadero, BISA y BNB y sus fixtures sintéticos `statement.txt` + `expected.json`, con el oráculo TC-IMPORTS-STMT-001..005); decisiones D255, D281 y D282 (los extractos reales nunca entran al repositorio ni a CI; fichas de 4 entidades), D277 (parser de PDF en un change propio con fichas de ≥ 3 entidades), D319 (PDF con contraseña de apertura rechazado; solo de propietario, aceptado), D324 (este change), D325 (los candidatos de baja confianza siguen exigiendo decisión), D329 (5 000 filas por importación), D330 (sin plantillas de CSV/XLS sin muestra), D346 (siempre vista previa); D249 (presupuesto de conexiones).

Changes de los que depende, con los contratos que consume:

| Change | Lo que este change consume |
|---|---|
| `add-import-pipeline` (54) | Puerto `StatementParser` (`sniff`, `parse`, `statement`), `StatementRecord`/`StatementBalance`, etapas `PARSE`/`NORMALIZE` reanudables en el consumidor `imports.persist`, normalizador (montos texto → `Decimal`, escala, `IMPORT_INVALID_AMOUNT`, `IMPORT_AMBIGUOUS_NUMBER`), perfiles `imports.mapping_profile`, saldo corrido (`IMPORT_RUNNING_BALANCE_GAP`), reconciliación contra el saldo final (decisión 14), huella de fila e idempotencia, `IMPORT_PARSE_FAILED`/`PARSE_FAILED` y el evento `imports.ImportFailed.v1` |
| `add-document-attachments` (53) | `DocumentQuery.getForProcessing` (`detectedFormat = PDF`, `purpose = IMPORT_SOURCE`), `DocumentContentReader.open` (flujo verificado por bloque); inspección previa del PDF: firma, sin `/JavaScript`, `/Launch`, `/EmbeddedFile`, `/XFA`, `/RichMedia`, sin contraseña de apertura, ≤ 10 000 objetos y ≤ 50 MiB inflados, en un `worker_thread` con límites |
| `add-bulk-imported-transactions` (52) | Persistencia por lote, sin cambios |
| `add-exchange-house-rate-providers` (41) | Catálogo de instituciones (`statementImport`): este change no lo modifica; el paso a `SUPPORTED` de BCP y Ganadero queda para la tarea 4.2 del 41 cuando el owner valide con sus extractos (tarea 9.3) |

| Capa | Cambios |
|---|---|
| domain (`@pf/imports`) | `PdfTextDocument` (páginas con fragmentos y posiciones), `PdfLayout` (descriptor validado), `PdfLayoutEngine` (líneas, columnas, filas, continuaciones, secciones, páginas), `PdfNumberGrammar` y `PdfDateGrammar` (con `SpanishMonths`), `PdfStatementHeader` (saldos, periodo, moneda, cuenta), `PdfCoherenceCheck`, `ScannedPageDetector`, `VolatileFragments` (huella) |
| application (`@pf/imports`) | Resolución del diseño en la etapa `PARSE` (perfil de la cuenta → de la institución → detección), verificación de cuenta y moneda, diferencia del saldo inicial (`BalanceQuery`), puerto nuevo `PdfTextExtractor` |
| infrastructure (`@pf/imports`) | `PdfjsTextExtractor` con su `worker_thread` (`pdf-text-extractor.worker.ts`), `PdfStatementParser` (implementa `StatementParser`), `PdfLayoutRegistry` (descriptores versionados + `pdf-layouts.lock.json`), migración expand, diagnóstico local |
| interface | Campos nuevos de `ImportJob` y del asistente; mensajes es/en/pt de los códigos nuevos |
| tests | Generador de PDF sintéticos con `pdfkit` y pintor de diseños compartido; test de política «sin PDF versionados» |

## Objetivos / No objetivos

**Objetivos:** que los extractos PDF con texto de BCP y Banco Ganadero (y BNB, si la reconstrucción por coordenadas resulta estable con los extractos del owner) entren al pipeline del change 54 con montos exactos, saldos del extracto verificados, sin filas perdidas ni inventadas y con re-importación sin duplicados, de modo que el owner pueda cumplir el criterio de salida de Phase 6 con 3 meses reales; y hacerlo sin que un PDF hostil comprometa el worker.

**No objetivos:** OCR y PDF escaneados (rechazo explícito, decisión 13); BISA (sin muestra con movimientos); mapeo manual de un PDF por el usuario (columnas por coordenadas en la UI); PDF de tarjetas de crédito; otros bancos sin ficha; plantillas de CSV/XLS (D330); cambiar la inspección de seguridad de DOCUMENTS; auto-aprobación (D346).

## Decisiones

1. **Alcance por entidad.** BCP (`bo.bcp.cuenta`) y Banco Ganadero (`bo.ganadero.cuenta`) son el núcleo: texto por columnas, saldo corrido, saldos del extracto explícitos. BNB (`bo.bnb.cuenta`) se entrega en este change con ancla por monto y secciones, pero su ficha advierte que el texto plano se desordena: si con el diagnóstico local (decisión 15) sobre los extractos reales la reconstrucción no es estable, el diseño se retira antes de publicar y la entidad queda `NOT_ELIGIBLE/UNSTABLE_FORMAT` en el catálogo (pregunta 3 de docs/58). BISA queda fuera: la muestra no tiene movimientos y la ficha prohíbe escribir el parser sin ella (pregunta 2). Ninguna entidad se publica como soportada hasta que el owner valide un extracto real (tarea 9.1).

2. **Biblioteca de extracción: `pdfjs-dist`** (Mozilla PDF.js, build `legacy` para Node). Se usa solo `getDocument` + `page.getTextContent()`, que entrega cada fragmento con su texto, matriz de transformación (posición x/y), ancho, alto y marca de fin de línea; nunca `render`. Opciones obligatorias: `isEvalSupported: false` (mitiga la clase de CVE-2024-4367, ejecución de código por compilación de fuentes; la versión mínima es la que la corrige, ≥ 4.2.67), `disableFontFace: true`, `useSystemFonts: false`, `disableAutoFetch: true`, `disableStream: true`, `stopAtErrors: true` (falla cerrada), `verbosity: 0`, sin `url` (los bytes se pasan como `Uint8Array`), y `cMapUrl`/`standardFontDataUrl` apuntando a los archivos locales del paquete (nunca a la red). La dependencia opcional nativa de `pdfjs-dist` (canvas) se excluye en `pnpm-workspace.yaml` (`ignoredOptionalDependencies` o el mecanismo equivalente de la versión de pnpm fijada); un test de arquitectura verifica que no está instalada ni se importa. Versión fijada en el catálogo (ADR-0018), actualizada por Renovate con `minimumReleaseAge`.

   | Alternativa | Licencia | Por qué no |
   |---|---|---|
   | **`pdfjs-dist`** (elegida) | Apache-2.0 | — Mantenida por Mozilla (motor de Firefox), JS puro, posiciones por fragmento, maneja cifrado RC4/AES con contraseña vacía (D319), CMaps y flujos comprimidos; historial de CVE público y corregido rápido |
   | `unpdf` | MIT | Envuelve una compilación «serverless» de PDF.js: misma base con una capa más y su propio ritmo de actualización; no aporta frente a usar PDF.js directo con las opciones de arriba |
   | `pdf-parse` 1.x | MIT | Incluye una copia de PDF.js de 2017 sin parches; solo texto plano sin posiciones |
   | `pdf2json` | Apache-2.0 | Fork antiguo de PDF.js con parches propios; menor base de usuarios y unidades de posición propias; mantenimiento por una sola persona |
   | `pdf-lib` | MIT | No extrae texto (crea y modifica PDF); sin publicaciones recientes |
   | Poppler `pdftotext -bbox-layout` | GPL-2.0 | Binario nativo en la imagen del worker (superficie de CVE en C, licencia copyleft); se usó solo para analizar las muestras fuera del repositorio |
   | MuPDF (`mupdf` WASM) | AGPL-3.0 | Licencia incompatible con un servicio sin publicar su código; WASM pesado |
   | OCR (Tesseract) | Apache-2.0 | Fuera de alcance (decisión 13) |

   La inspección estructural de DOCUMENTS (change 53) deja abierta su biblioteca (`pdf-lib` o `pdfjs-dist`); usar la misma reduce la superficie a una sola (pregunta 6 de docs/58, no bloqueante).

3. **Aislamiento: un `worker_thread` por extracción, con límites y falla cerrada.** `PdfjsTextExtractor` (infraestructura) crea un `Worker` nuevo por documento con `resourceLimits: { maxOldGenerationSizeMb: IMPORT_PDF_WORKER_MAX_OLD_MB (192), maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }`, le transfiere el `ArrayBuffer` del PDF (sin copia) y espera un único mensaje con el `PdfTextDocument` o un error tipado. Un temporizador de `IMPORT_PDF_EXTRACTION_TIMEOUT` (`PT30S`) llama a `worker.terminate()`; `ERR_WORKER_OUT_OF_MEMORY` y la salida con código ≠ 0 se traducen a `IMPORT_PDF_EXTRACTION_FAILED` con `reason ∈ { TIMEOUT, MEMORY, PAGE_LIMIT, TEXT_LIMIT, MALFORMED, ENCRYPTED }`. Dentro del hilo: se lee primero `numPages` y se corta con `PAGE_LIMIT` si supera `IMPORT_PDF_MAX_PAGES` (200) antes de pedir el contenido de ninguna página; se acumulan fragmentos hasta `IMPORT_PDF_MAX_TEXT_ITEMS` (300 000) y `IMPORT_PDF_MAX_TEXT_CHARS` (4 MiB) (`TEXT_LIMIT`); `PasswordException` ⇒ `ENCRYPTED` (no debería ocurrir: DOCUMENTS ya rechaza la contraseña de apertura). El hilo no recibe variables de entorno (`env: {}`), no tiene acceso a la configuración ni a la base, y su respuesta se valida con un esquema `zod` antes de usarla (un hilo comprometido no puede inyectar campos). Los metadatos (`getMetadata`) nunca se piden. La concurrencia es la del consumidor `imports.persist` (1): a lo sumo un hilo de extracción por proceso de worker; memoria pico ≈ 20 MiB del documento + 192 MiB del hilo, validada con el test de arranque del worker y el benchmark.

4. **Entrada al pipeline.** `PdfStatementParser` implementa el `StatementParser` del change 54: `sniff(head)` exige `%PDF-1.` en el byte 0 (coherente con DOCUMENTS); `parse(stream)` lee el flujo de `DocumentContentReader.open` a un búfer acotado por `DOCUMENT_IMPORT_SOURCE_MAX_BYTES` (20 MiB; PDF.js necesita acceso aleatorio a la tabla de referencias), llama al extractor, resuelve el diseño (decisión 6), corre `PdfLayoutEngine` y la coherencia (decisión 10) y entrega `StatementRecord` con los campos crudos de texto (fecha, hora, descripción, monto o débito/crédito, saldo, referencia, sección, página y línea) y un `StatementBalance`. La etapa `NORMALIZE` del 54 aplica las gramáticas del diseño (decisión 9) en lugar de las opciones de un mapeo CSV. La etapa `PARSE` de un PDF es atómica (extracción y reconstrucción completas antes de escribir el staging): el punto de control del 54 sigue valiendo desde `NORMALIZE`; una reentrega durante `PARSE` vuelve a extraer (idempotente, sin filas a medias porque el staging se escribe después de la coherencia, por bloques de 1 000 con `ON CONFLICT DO NOTHING`). Sin consumidores, colas ni conexiones nuevas (D249). `createImport` acepta `detectedFormat = PDF` (MODIFIED «Formatos de archivo detectados por contenido»); `source = FILE_PDF`, `format = PDF`.

5. **Texto con posiciones (`PdfTextDocument`, dominio).** `{ pageCount, pages: [{ number, width, height, items: [{ text, x, y, width, height }] }] }` con origen arriba a la izquierda (se invierte la `y` de PDF), coordenadas en puntos redondeadas a 0,01 (geometría, no dinero: `number` es correcto aquí) y texto normalizado NFC. Es el único contrato entre infraestructura y dominio: todo el algoritmo de las decisiones 7 a 12 es puro y se prueba con `PdfTextDocument` construidos en memoria, sin PDF.

6. **Diseños declarativos por institución, versionados (`imports.pdf-layout.v1`).** Cada diseño es un JSON validado por JSON Schema en `packages/contexts/imports/src/infrastructure/pdf/layouts/<id>.v<N>.json`, cargado y validado al arrancar (`PdfLayoutRegistry`; un descriptor inválido impide arrancar). Campos:
   - `id` (`bo.bcp.cuenta`, `bo.ganadero.cuenta`, `bo.bnb.cuenta`), `version`, `institutionCode` (código del catálogo del change 41, opcional), `currencyLabels` (`"Bolivianos"`, `"EXPRESADO EN BOLIVIANOS"`, `"BOLIVIANOS"` ⇒ BOB; `"$US"` ⇒ USD).
   - `detect.literals[]`: rótulos fijos de la primera página, comparados sin mayúsculas ni acentos (p. ej. Ganadero: `OFICINA/CANAL`, `TRANSACCIÓN`, `NRO. DE CUENTA`); **nunca el nombre del banco ni datos del titular**, para que los fixtures de entidades ficticias usen el mismo descriptor (requirement de diseños).
   - `header`: cómo leer `account` (rótulo y valor a su derecha), `currency`, `period` (patrón de fecha o mes en texto), `openingBalance` y `closingBalance` (rótulo + valor a la derecha, fila de la tabla con descripción literal como `Saldo anterior`, o rótulo del pie de la última página como `TOTAL SALDO ACTUAL`), `totalPages` (rótulo `Total Páginas:` o patrón `Página N de M`).
   - `table`: `columns[]` en orden con `label`, `role` (`DATE`, `TIME`, `DESCRIPTION`, `AMOUNT`, `DEBIT`, `CREDIT`, `BALANCE`, `REFERENCE`, `IGNORE`) y `align` (`LEFT`|`RIGHT`); `rowAnchor` (`DATE` o `AMOUNT`); `sections[]` opcionales (`startLabel`, `totalLabel`, `sign: CREDIT|DEBIT`); `skipRows[]` (descripción literal ⇒ captura de saldo, no movimiento); `endLabels[]`.
   - `page`: `repeatedLiterals[]` (encabezado repetido, `Página Actual:`), `footerLiterals[]`, `blankPageLiterals[]`, `discardLiterals[]` (avisos legales).
   - `number` (`decimal`, `thousands` o `null`, `negative: LEADING_MINUS`), `date` (`YYYYMMDD`, `DD/MM/YYYY`, `DD-MM-YYYY`), `time` (`HH:mm:ss`, `HH:mm`), `reference.unique` (siempre `false` para Ganadero y BNB, fichas), `volatileFragments[]` (decisión 12).
   
   **Versionado:** una versión publicada es inmutable; `pdf-layouts.lock.json` guarda la suma SHA-256 de cada `<id>@<version>` y un test falla si un archivo publicado cambia o desaparece (TC-IMPORTS-PDF-015). Un formato nuevo del banco ⇒ `v<N+1>`. **Resolución:** (a) perfil `format = PDF` de la cuenta, (b) de su institución — el perfil PDF solo fija `{ pdfLayout: { id, version } }` y opcionalmente `descriptionCleanup` (prefijos literales, como en el 54); (c) detección: se prueban los diseños cuyos `detect.literals` aparecen todos en la página 1, la versión más reciente primero; el primero cuya tabla se reconstruye sin error estructural gana. Sin candidato ⇒ `PARSE_FAILED` con `IMPORT_PDF_LAYOUT_UNKNOWN`. El job guarda `pdf.layout { id, version }` y, si vino de un perfil, `mapping_profile_id/version` como en el 54. El usuario no edita diseños (no hay mapeo manual de PDF en Phase 6).

7. **Reconstrucción de la tabla (dominio, `PdfLayoutEngine`).**
   1. **Palabras:** los fragmentos de una página se ordenan por `y` y `x` (el orden del flujo de contenido se ignora: resuelve el desorden de BNB). Fragmentos contiguos en la misma línea base se unen si la separación es menor que `0,25 × alto`; si es mayor que `0,15 × alto` y menor que el umbral de celda se inserta un espacio (texto dibujado carácter por carácter, espacios como separación sin carácter).
   2. **Líneas:** agrupación por línea base con tolerancia `0,5 × mediana del alto` de la página.
   3. **Encabezado de la tabla:** la primera línea que contiene todos los `columns[].label` (normalizados) fija las **bandas**: para `LEFT`, desde el borde izquierdo del rótulo hasta el borde izquierdo del siguiente; para `RIGHT`, desde el borde derecho del rótulo anterior hasta el borde derecho del propio (los montos se alinean a la derecha). Se recalculan en cada página con su encabezado repetido.
   4. **Celdas:** cada palabra va a la banda que contiene su extensión completa; una palabra que cruza el límite de dos bandas no se asigna por aproximación: la fila resultante queda inválida con `IMPORT_PDF_AMBIGUOUS_CELL` y su línea (`row issue`).
   5. **Filas:** con `rowAnchor = DATE`, una línea cuya celda de fecha cumple la gramática del diseño abre un movimiento; con `AMOUNT` (BNB), lo abre la celda de monto, y las celdas de fecha, hora, descripción y referencia de las líneas vecinas se asignan al ancla más cercana dentro del bloque delimitado por los puntos medios entre anclas consecutivas. Las líneas sin ancla y con contenido solo en `DESCRIPTION`/`REFERENCE` son **continuaciones** del movimiento abierto y se unen con un espacio (la referencia partida en dos líneas se une sin espacio si la primera parte termina en `-`, ficha BNB). Una línea sin ancla con contenido en columnas de monto es estructuralmente inválida ⇒ cuenta como no reconocida (decisión 10 la detecta).
   6. **Orden:** las filas conservan el orden impreso (página, línea); nunca se ordenan por fecha (fichas: interés y retención al final del día).
   7. **Secciones (BNB):** las filas entre `startLabel` y `totalLabel` toman el signo de la sección; el total impreso se guarda para la coherencia.
   8. **Filas omitidas:** `skipRows` (p. ej. `Saldo anterior`) alimentan el saldo inicial y no son movimientos.

8. **Páginas.** Se descartan las líneas que contienen `page.repeatedLiterals`, `footerLiterals` y `discardLiterals`, y todo lo que está por encima del encabezado de la tabla en las páginas siguientes a la primera; una continuación al inicio de una página (antes de cualquier ancla) se une al último movimiento de la página anterior; una página cuyo texto es un `blankPageLiterals` se omite sin advertencia; si el diseño declara `totalPages`, páginas leídas ≠ declaradas ⇒ `PARSE_FAILED` con `IMPORT_PDF_PAGE_COUNT_MISMATCH`.

9. **Números y fechas exactos.** `PdfNumberGrammar` acepta solo `^-?\d{1,3}(T\d{3})*D\d+$` o `^-?\d+D\d+$` con `T`/`D` los separadores del diseño (sin miles declarado: solo la segunda forma); el texto se limpia de separadores y se convierte a `Decimal` con el constructor de cadena (nunca `Number`/`parseFloat`); escala mayor que la de la moneda ⇒ `IMPORT_INVALID_AMOUNT` sin redondear (INV-003); un número que no cumple la gramática pero sí la del otro separador ⇒ `IMPORT_AMBIGUOUS_NUMBER`. Signo: `AMOUNT` con signo; `CREDIT − DEBIT` (ambos ≠ 0 ⇒ `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`); o el signo de la sección. Fechas por formato del diseño con validación de calendario (`31/02` ⇒ `IMPORT_INVALID_DATE`); `SpanishMonths` es una tabla propia (`enero`…`diciembre`, sin acentos ni mayúsculas, también abreviadas `ene`…`dic`) independiente de `Intl` y del locale y la zona del proceso; el periodo «Marzo 2026» ⇒ `2026-03-01..2026-03-31`. La hora sin zona se interpreta en la zona del workspace (America/La_Paz) y la fecha de negocio es la fecha literal impresa (sin conversión). «es-BO» no se infiere del sistema: cada diseño declara sus separadores (BCP sin miles y punto decimal, Ganadero y BNB coma de miles y punto decimal, BISA coma decimal).

10. **Saldos y coherencia (falla cerrada).** Tras reconstruir: `saldoInicial + Σ montos = saldoFinal` (si el diseño declara ambos) y, por sección o columna con total impreso, `total = Σ filas`; también `filas no reconocidas = 0`. Si algo falla ⇒ `PARSE_FAILED` con `IMPORT_PDF_TOTALS_MISMATCH` y `pdf.coherence { totals: MISMATCH, difference, recognizedRows, unrecognizedLines: [páginas y números de línea] }` (sin textos). Motivo: el criterio de salida es «sin duplicados» y una vista previa con un movimiento perdido llevaría a un saldo erróneo aprobado sin aviso; el usuario no puede reparar en la UI una fila que el lector no vio (pregunta 1 de docs/58 ofrece la alternativa de revisar con advertencia). El saldo corrido por fila se verifica como en el 54 (advertencia `IMPORT_RUNNING_BALANCE_GAP`, en orden impreso) y no bloquea si los totales cuadran. El `StatementBalance { openingBalance, closingBalance, periodFrom, periodTo }` pasa a la reconciliación del 54 (decisión 14 del 54: `COMPLETED` o `COMPLETED_WITH_DIFFERENCE`, nunca ajustes). **Saldo inicial contra la cuenta (Should):** al llegar a `AWAITING_REVIEW`, `BalanceQuery` de la cuenta al cierre de `periodFrom − 1 día` (mismo criterio de estados que la reconciliación del 54) ⇒ `pdf.openingDifference = openingBalance − saldo`; solo se muestra.

11. **Cuenta, moneda y datos personales.** El motor devuelve del encabezado solo: moneda, saldos, periodo, total de páginas y **los últimos 4 dígitos** del número de cuenta (los dígitos del valor a la derecha del rótulo, sin guiones). La aplicación compara con `accountNumberLast4` de `GetAccount` (ACCOUNTS): distinto ⇒ `PARSE_FAILED` con `IMPORT_PDF_ACCOUNT_MISMATCH`; ausente ⇒ advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED` en `pdf.warnings`. Moneda distinta de la cuenta ⇒ todas las filas `IMPORT_CURRENCY_MISMATCH` (como OFX). Titular, dirección, operador, sucursal, canal y número completo se descartan dentro del motor de dominio y nunca llegan al staging, al job, a la auditoría, a los eventos ni a los logs (logs solo con `importJobId`, conteos, códigos, páginas y números de línea; NFR-SEC-015). Los textos de las filas (descripción con nombres de terceros) se tratan como en el 54 («Textos importados como datos no confiables»).

12. **Huella e idempotencia.** Las filas de PDF usan la huella vigente (cuenta, fecha, monto, moneda, descripción normalizada, ordinal): re-descargar el mismo mes cambia la suma del archivo (la «Fecha Consulta» del encabezado) pero no las huellas ⇒ 0 nuevas (criterio de salida). `volatileFragments` del diseño son literales con un comodín numérico `{n}` (sin expresiones regulares: evita ReDoS, como la limpieza del 54) que se quitan **solo** de la descripción usada en la huella; la transacción guarda la glosa completa. Ganadero v1 declara `Aún falta {n}` y `Completado` (ficha: anotaciones de estado que cambian entre descargas). Las referencias no únicas (Ganadero, BNB) no se usan como identificador externo (`reference.unique = false`). Duplicados probables y su decisión siguen las reglas del 54 (D325).

13. **PDF escaneado: rechazo explícito.** `ScannedPageDetector`: una página con menos de `IMPORT_PDF_MIN_PAGE_TEXT_CHARS` (20) caracteres no blancos que no es una página en blanco declarada es una «página sin texto»; si hay alguna ⇒ `PARSE_FAILED` con `IMPORT_PDF_NO_TEXT` y `pdf.pagesWithoutText[]`. No se intenta OCR ni lectura parcial (una página escaneada dentro de un extracto rompería la coherencia de todos modos). La UI muestra: «Este PDF no tiene texto (parece escaneado o fotografiado). Descargá el extracto digital desde tu banca por internet o registrá los movimientos a mano.» (es/en/pt). Un PDF con capa de texto de OCR invisible se trata como texto y pasa o falla por diseño y coherencia.

14. **Pruebas sin datos reales (D255, D281, D282).** Ningún PDF entra al repositorio: un test de política (job `unit`) falla si `git ls-files` lista un `.pdf`, y `.gitignore` los ignora bajo `tests/`. Los PDF se generan **por código** en el test con `pdfkit` (MIT, ya en el catálogo, solo `devDependency` de `@pf/imports`): un **pintor de diseños** (`tests/fixtures/imports/statements-bo/pdf/paint-statement.ts`) toma el `expected.json` sintético existente de cada entidad más una geometría (posiciones de columnas, alto de línea, filas por página) y dibuja la misma página en dos destinos: un `PdfTextDocument` en memoria (pruebas de dominio, rápidas) y un PDF de `pdfkit` (pruebas de extremo a extremo con PDF.js). Variantes: glosa multilínea, corte de glosa en el salto de página con encabezado repetido, filas no cronológicas, orden de dibujo aleatorio con semilla fija (BNB), texto carácter por carácter y espacios como separación, página en blanco intencional, contraseña solo de propietario, páginas de solo imagen (PNG de un color generado por código), PDF truncado, 201 páginas y 100 páginas con 5 000 movimientos (benchmark). Las fechas de creación del PDF se fijan; los archivos generados viven en memoria o en `os.tmpdir()` y se borran. Un diseño de prueba no publicado cubre la coma decimal. El oráculo es el `expected.json` (comparación estructural exacta, TC-IMPORTS-PDF-045), el mismo de TC-IMPORTS-STMT-001..005.

15. **Diagnóstico local (Could).** `pnpm imports:pdf:probe <ruta>` (script de `@pf/imports`, sin red ni base) corre el extractor y el motor sobre un PDF fuera del repositorio e imprime solo: diseño y versión, páginas leídas y declaradas, filas reconocidas, líneas no reconocidas (página y número), resultado de cada verificación de coherencia (`OK`/`MISMATCH`, sin la diferencia) y códigos de fila por conteo. Sirve para que el owner valide sus extractos reales sin compartir valores (tarea 9.1); un test verifica que la salida no contiene dígitos de montos ni textos del fixture (TC-IMPORTS-PDF-047).

16. **Rendimiento.** Presupuesto para un PDF de 100 páginas y 5 000 movimientos: arranque del hilo ≤ 0,5 s, extracción ≤ 6 s, reconstrucción y coherencia ≤ 2 s; el resto del pipeline según el 54 (≈ 24 s con 200 reglas): ≤ 30 s (Should; fila nueva informativa en `imports.perf.ts`, TC-IMPORTS-PDF-046). Un extracto mensual real tiene 1 a 6 páginas.

17. **Seguridad (resumen).** Defensa en profundidad: DOCUMENTS ya rechazó contenido activo y contraseña de apertura; la lectura corre en un hilo con límites, sin `eval`, sin render, sin red ni sistema de archivos más allá de los recursos del paquete, sin entorno y con respuesta validada; diseños sin expresiones regulares; montos sin coma flotante; logs sin valores; PDF reales fuera del repositorio; dependencia con Renovate, Trivy y OSV (NFR-SEC-013). Threat model de docs/12 actualizado (NFR-SEC-020).

## Contratos

### OpenAPI (aditivo, tag Imports, `x-openspec-capability: imports/import-pipeline`)

- `ImportFormat` (enum abierto del 54) agrega `PDF`; `ImportSource` agrega `FILE_PDF`. `createImport` (variante JSON del 54) acepta documentos `detectedFormat = PDF` sin cambiar su cuerpo.
- `ImportJob.pdf` (nullable, solo para `format = PDF`):

```yaml
ImportPdfInfo:
  type: object
  required: [pagesRead]
  properties:
    layout: { $ref: '#/components/schemas/ImportPdfLayoutRef' }   # { id: string, version: integer }
    pagesRead: { type: integer, minimum: 0 }
    pagesDeclared: { type: integer, minimum: 1, nullable: true }
    pagesWithoutText: { type: array, items: { type: integer, minimum: 1 } }
    coherence:
      type: object
      properties:
        totals: { type: string, x-extensible-enum: [OK, MISMATCH, NOT_AVAILABLE] }
        difference: { $ref: '#/components/schemas/Money' }
        runningBalance: { type: string, x-extensible-enum: [OK, GAPS, NOT_AVAILABLE] }
        unrecognizedLines: { type: array, items: { type: object, properties: { page: { type: integer }, line: { type: integer } } } }
    openingDifference: { $ref: '#/components/schemas/Money' }
    extractionFailure: { type: string, x-extensible-enum: [TIMEOUT, MEMORY, PAGE_LIMIT, TEXT_LIMIT, MALFORMED, ENCRYPTED] }
    warnings: { type: array, items: { type: string, x-extensible-enum: [IMPORT_PDF_ACCOUNT_UNVERIFIED] } }
```

- `ErrorCode` (`x-extensible-enum`, mensajes es/en/pt; también como código del job en `PARSE_FAILED` y en `imports.ImportFailed.v1`): `IMPORT_PDF_NO_TEXT`, `IMPORT_PDF_LAYOUT_UNKNOWN`, `IMPORT_PDF_EXTRACTION_FAILED`, `IMPORT_PDF_TOTALS_MISMATCH`, `IMPORT_PDF_PAGE_COUNT_MISMATCH`, `IMPORT_PDF_ACCOUNT_MISMATCH`. `ImportRowIssueCode` (enum abierto): `IMPORT_PDF_AMBIGUOUS_CELL`, `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`. Reutilizados: `IMPORT_UNSUPPORTED_FORMAT`, `IMPORT_INVALID_AMOUNT`, `IMPORT_AMBIGUOUS_NUMBER`, `IMPORT_INVALID_DATE`, `IMPORT_CURRENCY_MISMATCH`, `IMPORT_RUNNING_BALANCE_GAP`. `pnpm contract:breaking` limpio; descripciones con comas entre comillas en los flow mappings.
- `ImportProfile.format` admite `PDF`; `options` de un perfil PDF: `{ pdfLayout: { id, version }, descriptionCleanup?: string[] }` (`imports.profile.v1` amplía su `oneOf` de forma aditiva).

### Eventos

`imports.ImportFileUploaded.v1.format` y `imports.ImportCompleted.v1.sourceType` admiten `PDF`/`FILE_PDF` (ya declarados enums abiertos por el 54; se documenta en `contracts/events/README.md`). `imports.ImportFailed.v1.code` lleva los códigos nuevos. Ninguno lleva texto del extracto.

### Puertos internos y contratos consumidos

| Puerto (IMPORTS) | Firma | Implementación |
|---|---|---|
| `PdfTextExtractor` (application) | `extract(bytes: Uint8Array, limits) → Promise<PdfTextDocument>`; lanza `PdfExtractionError { reason }` | `PdfjsTextExtractor` (worker_thread) |
| `PdfLayoutRegistry` (application) | `get(id, version)`, `candidates()` (más reciente primero) | archivos `layouts/*.json` + lock |
| `InstitutionOfAccountPort` (del 54) | amplía su resultado con `accountNumberLast4` (`GetAccount` ya lo expone) | ACCOUNTS existente |
| `AccountBalanceAtPort` (nuevo) | `(workspaceId, accountId, asOfDate) → Money` | `BalanceQuery` de TRANSACTIONS (existente) |
| `DocumentSourcePort` (del 54) | sin cambios | DOCUMENTS |

### Configuración (`@pf/platform`, `docs/config-reference.md`)

`IMPORT_PDF_EXTRACTION_TIMEOUT` (`PT30S`), `IMPORT_PDF_MAX_PAGES` (200), `IMPORT_PDF_MAX_TEXT_ITEMS` (300000), `IMPORT_PDF_MAX_TEXT_CHARS` (4194304), `IMPORT_PDF_WORKER_MAX_OLD_MB` (192), `IMPORT_PDF_MIN_PAGE_TEXT_CHARS` (20). Validadas al arrancar (rangos acotados: timeout ≤ `PT2M`, páginas ≤ 1 000, memoria 64..512).

### Esquema del diseño

`contracts/imports/pdf-layout.v1.schema.json` (`$id` versionado; JSON Schema 2020-12; `additionalProperties: false`; literales ≤ 120 caracteres; ≤ 30 columnas, ≤ 50 literales por lista; sin campos de expresión regular).

## Modelo de datos (expand-only)

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `imports.import_job` | Nullable `pdf jsonb` (forma de `ImportPdfInfo`, sin textos del extracto); CHECK de `format` agrega `PDF`; CHECK de `source` agrega `FILE_PDF` | sin cambios de política |
| `imports.mapping_profile` | CHECK de `format` agrega `PDF` | sin cambios |
| `imports.staged_transaction` | Sin columnas nuevas: página y línea van en `line_number` y en `warnings` como en el 54; la referencia no única en `external_id` sin usarse como identificador | sin cambios |

Migración con timestamp posterior a la última de `main` al implementar (y posterior a las del 54); sin defaults que reescriban la tabla; el export del workspace incluye `pdf` en su sección de `import_job` (JSON Schema actualizado).

## Riesgos / Trade-offs

- **El formato real puede diferir de la ficha** (una sola muestra por entidad): mitigado con diseños versionados, falla cerrada por coherencia y el diagnóstico local antes de publicar (tarea 9.1). Si la falla cerrada es demasiado estricta con extractos reales, la pregunta 1 de docs/58 ofrece la alternativa.
- **Fixtures generados por `pdfkit` no imitan exactamente** a Reporting Services, jsPDF o wkhtmltopdf (agrupación de fragmentos, codificación de fuentes): mitigado con variantes de dibujo (por celda, por carácter, desordenado) y con la validación del owner sobre sus PDF reales.
- **Falla cerrada** puede bloquear un extracto entero por una celda mal leída; preferible a importar un mes con un movimiento perdido. El diagnóstico dice la página y la línea para corregir el diseño (versión nueva).
- **CVE en PDF.js:** hilo con límites, sin `eval`, inspección previa de DOCUMENTS, actualización por Renovate; el hilo no tiene entorno ni base de datos.
- **Memoria del worker en el host de 2 GB:** un hilo de 192 MiB a la vez; validar con el test de arranque y el benchmark; configurable.
- **Anotaciones variables no previstas** en otras glosas cambiarían la huella: el usuario ve la fila como posible duplicado (no se pierde ni se duplica en silencio, D325) y el diseño agrega el fragmento en una versión nueva.
- **Dependencia del 54 para archivar:** el MODIFIED de «Formatos de archivo detectados por contenido» solo aplica cuando ese requirement esté en la spec principal; `openspec validate` lo informa (INFO) mientras el 54 no esté archivado.

## Plan de migración

1. Expand: columna `pdf` y CHECK ampliados.
2. Contrato OpenAPI MINOR (oasdiff), esquema `pdf-layout.v1`, códigos y mensajes es/en/pt.
3. Config nueva en `@pf/platform` y `docs/config-reference.md`.
4. Diseños publicados `bo.bcp.cuenta@1` y `bo.ganadero.cuenta@1` (y `bo.bnb.cuenta@1` según la pregunta 3) con el lock.
5. Rollback: la versión anterior ignora la columna; un job PDF pendiente queda en `UPLOADED` y se reanuda al volver a desplegar.

## Dependencias entre changes

- **Requiere aplicados:** `add-import-pipeline` (54: puerto, etapas, normalizador, reconciliación, huella) y `add-document-attachments` (53: documentos `IMPORT_SOURCE` y su inspección de PDF). El dominio (grupo 2) y el generador de fixtures pueden avanzar antes, con `PdfTextDocument` en memoria.
- **Archivado:** después del 54 (el MODIFIED necesita su requirement en la spec principal); al archivar se depreca TC-IMPORTS-PIPELINE-012 (`superseded_by: TC-IMPORTS-PDF-001`).
- **Criterio de salida de Phase 6:** la verificación con 3 meses reales (tarea 9.4) la hace el owner en su entorno con sus PDF, después de este change y del 54.

## Preguntas abiertas

En [docs/58-pdf-statement-parser-questions.md](../../../docs/58-pdf-statement-parser-questions.md). Bloqueantes: la 1 (falla cerrada por coherencia, bloquea el grupo 4) y la 4 (prioridad de FR-IMPORTS-016 en docs/01, bloquea el archivado).

## Cambios a docs compartidos

- **docs/01:** FR-IMPORTS-016 pasa a Phase 6 (D324) con la prioridad de la pregunta 4.
- **docs/13:** §1 y §6.3 (el PDF con texto entra en Phase 6 por diseños por institución; OCR sigue fuera); §5 (lector PDF: hilo aislado, diseños, coherencia); §7 (fragmentos variables de la huella); tabla de fuentes (`FILE_PDF` deja de ser «futuro OCR»).
- **docs/statement-formats:** README y fichas BCP, Ganadero y BNB enlazan el diseño publicado y su versión; «extracción recomendada» pasa de hipótesis a decisión (coordenadas con PDF.js).
- **docs/12:** threat model del lector de PDF (NFR-SEC-020).
- **docs/08, docs/10, docs/11:** columna `pdf`, `ImportPdfInfo`, códigos y enums.
- **docs/28:** asistente de importación con PDF (diseño detectado, coherencia, diferencia de saldo inicial, rechazo de escaneados).
- **docs/24 §5.6 y docs/38:** el criterio de salida con extractos reales depende de este change.
- **docs/config-reference.md:** variables `IMPORT_PDF_*`.
- **docs/runbooks/importar-extracto-csv.md:** sección de extractos PDF y del diagnóstico local.
