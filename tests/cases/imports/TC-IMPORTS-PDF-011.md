---
id: TC-IMPORTS-PDF-011
title: "Una página de solo imagen entre páginas con texto rechaza el PDF indicando la página"
spec: imports/import-pipeline
related_specs: []
requirement: "Rechazo explícito de un PDF escaneado sin texto"
scenario: "Una página escaneada entre páginas con texto"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: medium
type: integration
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/pdf/pdf-statement-reader.pdf.test.ts
  - packages/contexts/imports/src/testing/import-pdf.test.ts
  - packages/contexts/imports/src/testing/pdf-statement-reader.test.ts
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
input: "Datos del scenario \"Una página escaneada entre páginas con texto\" del delta de add-pdf-statement-parser"
steps:
  - "un EDITOR importa un PDF de 3 páginas cuya página 2 es solo una imagen"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PDF_NO_TEXT` indicando la página 2, sin filas"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-011 — Una página de solo imagen entre páginas con texto rechaza el PDF indicando la página

## Intención

Un PDF sin texto extraíble —un extracto escaneado o fotografiado— NO DEBE (MUST NOT) procesarse con reconocimiento óptico de caracteres ni interpretarse por aproximación: la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_NO_TEXT`, sin filas, y la interfaz DEBE (MUST) indicar que se descargue el extracto digital desde la banca por internet o se registren los movimientos a mano. Una página sin texto entre páginas con texto, que no sea una página en blanco declarada por el diseño, DEBE (MUST) producir el mismo rechazo indicando el número de página.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un EDITOR importa un PDF de 3 páginas cuya página 2 es solo una imagen
Entonces la importación queda en "falló la lectura" con `IMPORT_PDF_NO_TEXT` indicando la página 2, sin filas
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
