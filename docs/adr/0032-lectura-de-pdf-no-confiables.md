# ADR-0032: Lectura de PDF no confiables

- Estado: **Aceptado (2026-10-29)** — decisiones del owner D324 (docs/57), D347–D358 (docs/58)
- Fecha: 2026-10-30
- Decisores: Owner (Product/Tech Lead)
- Relacionado: [ADR-0030](0030-documentos-cifrados-por-la-aplicacion-y-descarga-por-la-api.md) (DOCUMENTS inspecciona y cifra los PDF); [ADR-0018](0018-monorepo-and-build-tooling.md) (versiones fijadas en el catálogo); docs/12-security.md (threat model del lector de PDF, NFR-SEC-020); docs/13-import-architecture.md §5; docs/01 FR-IMPORTS-016; docs/02 NFR-SEC-012, NFR-SEC-013, NFR-SEC-015; `openspec/changes/add-pdf-statement-parser` (decisiones 2, 3, 13 y 17); OpenSpec capability `imports/import-pipeline`

## Contexto y problema

El criterio de salida de Phase 6 exige importar extractos bancarios reales, que son **PDF con texto** (docs/statement-formats). Un PDF es un formato complejo que puede ser hostil: flujos comprimidos que se expanden sin límite, fuentes malformadas, contenido activo, referencias circulares y una larga historia de CVE en sus lectores (CVE-2024-4367 en PDF.js: ejecución de código al compilar fuentes). El lector corre en el **worker** de PFOS, que tiene acceso a la base de datos y a las claves de cifrado de documentos; un fallo del lector no puede comprometerlo ni tumbarlo.

DOCUMENTS (ADR-0030) ya **rechaza** los PDF con JavaScript, acciones, adjuntos, XFA o contraseña de apertura, con un inspector estructural propio que corre en un `worker_thread`. Falta decidir **qué biblioteca extrae el texto con posiciones** y **cómo se aísla**, para IMPORTS y para cualquier lectura futura de PDF en DOCUMENTS (decisión D352: una sola biblioteca de PDF que vigilar y actualizar).

## Drivers de decisión

- Posiciones por fragmento (x, y, ancho, alto): las columnas de las tablas se reconstruyen por coordenadas, no por el orden del flujo.
- Sin binarios nativos ni licencias copyleft en la imagen del worker (superficie de CVE en C, licencia).
- Un PDF hostil no debe poder agotar memoria ni tiempo del proceso, ni ejecutar código, ni tocar la red, la base ni el entorno.
- Mantenimiento activo y correcciones rápidas de vulnerabilidades; versión fijada y actualizada por Renovate (ADR-0018).
- Falla cerrada: si algo no se puede leer con certeza, no hay importación (D347).

## Opciones consideradas

| Biblioteca | Licencia | Veredicto |
|---|---|---|
| **`pdfjs-dist`** (Mozilla PDF.js) | Apache-2.0 | **Elegida.** JS puro, motor de Firefox, posiciones por fragmento, cifrado RC4/AES con contraseña vacía (D319), CMaps y flujos comprimidos; historial de CVE público y corregido rápido. |
| `unpdf` | MIT | Envuelve una compilación «serverless» de PDF.js: la misma base con otra capa y otro ritmo de actualización. |
| `pdf-parse` 1.x | MIT | Copia de PDF.js de 2017 sin parches; solo texto plano. |
| `pdf2json` | Apache-2.0 | Fork antiguo; mantenimiento por una persona. |
| `pdf-lib` | MIT | No extrae texto. |
| Poppler (`pdftotext -bbox-layout`) | GPL-2.0 | Binario nativo copyleft; se usó solo para analizar las muestras fuera del repositorio. |
| MuPDF (WASM) | AGPL-3.0 | Licencia incompatible con un servicio sin publicar su código. |
| OCR (Tesseract) | Apache-2.0 | Fuera de alcance: un PDF escaneado se rechaza con `IMPORT_PDF_NO_TEXT`. |

Aislamiento: (a) en el hilo del consumidor; (b) un **`worker_thread` por documento** con límites; (c) un proceso hijo o contenedor aparte. Se elige (b): el hilo cumple el aislamiento de memoria y tiempo que importa (`resourceLimits`, `terminate`) sin sumar un proceso ni una conexión al presupuesto del host de 2 GB (ADR-0027); (c) queda como evolución si el modelo de amenazas lo exige.

## Decisión

1. **`pdfjs-dist`, fijada en una versión exacta del catálogo** (`pnpm-workspace.yaml`), siempre posterior a la corrección de CVE-2024-4367 (≥ 4.2.67; hoy 6.3.289). Se usa el build `legacy` solo con `getDocument` + `getTextContent`: **nunca** `render`, `getMetadata`, anotaciones ni acciones JavaScript.
2. **Opciones endurecidas obligatorias:** `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, `disableAutoFetch: true`, `disableStream: true`, `stopAtErrors: true`, `verbosity: 0`, sin `url` (los bytes entran como `Uint8Array`) y `cMapUrl`/`standardFontDataUrl` apuntando a archivos locales del paquete. La serie 6.x ya no compila funciones con `eval` ni `new Function` (un test lo verifica sobre el paquete instalado, para detectar una regresión al actualizar) y la opción `isEvalSupported` no figura en sus tipos: se pasa igual para que una versión que la reintroduzca nunca arranque con el valor por omisión.
3. **Sin binarios nativos.** La dependencia opcional nativa de `pdfjs-dist` (`@napi-rs/canvas`) se excluye con `ignoredOptionalDependencies` en `pnpm-workspace.yaml`; un test verifica que no está instalada ni se importa. PDF.js avisa por consola de que no puede cargarla (solo afecta al render, que no se usa); el hilo silencia la consola.
4. **Un `worker_thread` por documento** (`PdfjsTextExtractor` + `pdf-text-extractor.worker.ts`): `resourceLimits` (`maxOldGenerationSizeMb` = `IMPORT_PDF_WORKER_MAX_OLD_MB`, 192; `maxYoungGenerationSizeMb` 32; `stackSizeMb` 4), `env: {}` (sin variables de entorno), búfer transferido, temporizador `IMPORT_PDF_EXTRACTION_TIMEOUT` (`PT30S`) que llama a `terminate()`, tope de páginas (200, comprobado ANTES de leer el contenido de ninguna), de fragmentos (300 000) y de caracteres (4 MiB). La respuesta del hilo se valida con `zod` (`strictObject`) antes de usarla. Falla cerrada con el motivo estructural `TIMEOUT | MEMORY | PAGE_LIMIT | TEXT_LIMIT | MALFORMED | ENCRYPTED` (`IMPORT_PDF_EXTRACTION_FAILED`), sin texto del documento.
5. **Una sola biblioteca de PDF** (D352): `pdfjs-dist` es la biblioteca de referencia para IMPORTS y para cualquier lectura profunda de PDF que DOCUMENTS necesite. Hoy el inspector de DOCUMENTS es estructural y no usa ninguna biblioteca (recorre el archivo con límites propios), así que no hay una segunda biblioteca que vigilar; si DOCUMENTS pasa a parsear con una biblioteca, será esta y con estas mismas opciones.
6. **Datos personales:** el motor de dominio descarta titular, dirección, operador y metadatos del PDF; solo conserva moneda, saldos, periodo, páginas y los últimos 4 dígitos del número de cuenta. Los registros y la auditoría llevan códigos, conteos, páginas y números de línea, nunca valores.
7. **Operación:** el hilo corre dentro del consumidor `imports.persist` (concurrencia 1): una extracción a la vez, sin consumidores ni conexiones nuevos (D249). El techo de memoria del contenedor del worker sube de 288 a 448 MiB (`compose.prod.yaml`): heap principal 192 + hilo 192 + margen nativo.

## Consecuencias

**Positivas.** Un PDF hostil solo puede costar su propio hilo (tiempo o memoria agotados); sin ejecución de código, sin red y sin entorno dentro del hilo; una sola biblioteca de PDF; versión exacta, actualizable por Renovate y escaneada por Trivy y OSV.

**Negativas y riesgos.**

- **Reordenamiento de glifos sueltos:** si los glifos de una palabra se dibujan uno a uno en orden aleatorio, PDF.js los vuelve a juntar en el orden de dibujo y puede invertir letras contiguas. Es un caso patológico que no ocurre en los extractos reales (los generadores dibujan las palabras completas, en orden); la reconstrucción por coordenadas absorbe el desorden entre celdas, y la falla cerrada por coherencia atrapa cualquier lectura equivocada.
- **Memoria del worker:** 192 MiB adicionales como techo mientras se lee un PDF; en reposo el worker no cambia. Configurable (`IMPORT_PDF_WORKER_MAX_OLD_MB`, 64–512) y vigilado por un test que compara el techo del contenedor con el heap y el hilo.
- **CVE futuros en PDF.js:** mitigados por el hilo con límites, la inspección previa de DOCUMENTS, la actualización rápida por Renovate (`minimumReleaseAge`) y Trivy; el plan de evolución es un proceso o contenedor aparte con perfil `seccomp`.
- **El build `legacy` es más pesado** que el moderno; es el que soporta la versión de Node del host.

## Validación

- Tests con TC-IMPORTS-PDF-004..009 (tiempo, memoria, páginas, truncado, contraseña de propietario, metadatos) sobre PDF generados con `pdfkit` y nunca versionados (D255, D281, D282).
- Test de arquitectura: ningún binario nativo ni `canvas` instalados ni importados; el motor no contiene `eval` ni `new Function`; el hilo no recibe entorno ni usa `render`/`getMetadata`.
- Pruebas de seguridad: ni los metadatos ni los datos del titular aparecen en el staging, el job, la auditoría, el outbox ni los logs (TC-IMPORTS-PDF-009 y -041).
- La validación con extractos reales del owner (diagnóstico local `pnpm imports:pdf:probe`, tarea 9.1 del change) ocurre fuera del repositorio.
