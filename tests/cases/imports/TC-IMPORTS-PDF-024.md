---
id: TC-IMPORTS-PDF-024
title: "Leer menos páginas que las declaradas falla con IMPORT_PDF_PAGE_COUNT_MISMATCH"
spec: imports/import-pipeline
related_specs: []
requirement: "Saltos de página, encabezados y pies del extracto PDF"
scenario: "Página faltante"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: IMPORT_PDF_PAGE_COUNT_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Página faltante\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto declara \"Total Páginas: 3\" y el PDF tiene 2 páginas"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PDF_PAGE_COUNT_MISMATCH` y sin filas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-024 — Leer menos páginas que las declaradas falla con IMPORT_PDF_PAGE_COUNT_MISMATCH

## Intención

El sistema DEBE (MUST) descartar los encabezados y pies que el diseño declara en cada página, sin que aparezcan como filas ni como inválidas; una glosa cortada por un salto de página DEBE (MUST) unirse al último movimiento de la página anterior; una página en blanco declarada por el diseño DEBE (MUST) omitirse; y si el extracto declara su número total de páginas, el sistema DEBE (MUST) verificar que leyó todas y, si no, dejar la importación en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH`, sin filas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto declara "Total Páginas: 3" y el PDF tiene 2 páginas
Entonces la importación queda en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH` y sin filas
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
