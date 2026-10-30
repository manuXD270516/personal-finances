---
id: TC-IMPORTS-PDF-010
title: "Un PDF de solo imágenes falla con IMPORT_PDF_NO_TEXT y la interfaz indica la alternativa"
spec: imports/import-pipeline
related_specs: []
requirement: "Rechazo explícito de un PDF escaneado sin texto"
scenario: "Extracto escaneado"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: high
type: integration
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/web/src/ui/imports/pdf.test.tsx
  - packages/contexts/imports/src/infrastructure/pdf/pdf-statement-reader.pdf.test.ts
  - packages/contexts/imports/src/testing/import-pdf.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: IMPORT_PDF_NO_TEXT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Extracto escaneado\" del delta de add-pdf-statement-parser"
steps:
  - "un EDITOR importa un PDF de 2 páginas que solo contienen imágenes"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PDF_NO_TEXT` y sin filas"
  - "la interfaz indica descargar el extracto digital o registrar los movimientos a mano"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-010 — Un PDF de solo imágenes falla con IMPORT_PDF_NO_TEXT y la interfaz indica la alternativa

## Intención

Un PDF sin texto extraíble —un extracto escaneado o fotografiado— NO DEBE (MUST NOT) procesarse con reconocimiento óptico de caracteres ni interpretarse por aproximación: la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_NO_TEXT`, sin filas, y la interfaz DEBE (MUST) indicar que se descargue el extracto digital desde la banca por internet o se registren los movimientos a mano. Una página sin texto entre páginas con texto, que no sea una página en blanco declarada por el diseño, DEBE (MUST) producir el mismo rechazo indicando el número de página.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un EDITOR importa un PDF de 2 páginas que solo contienen imágenes
Entonces la importación queda en "falló la lectura" con `IMPORT_PDF_NO_TEXT` y sin filas
  Y la interfaz indica descargar el extracto digital o registrar los movimientos a mano
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Las imágenes se generan por código (PNG de un color); sin OCR.
