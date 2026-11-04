---
id: TC-IMPORTS-PDF-022
title: "Una glosa cortada por el salto de página se une al último movimiento de la página anterior"
spec: imports/import-pipeline
related_specs: []
requirement: "Saltos de página, encabezados y pies del extracto PDF"
scenario: "Glosa cortada por el salto de página"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/pdf-statement-reader.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Glosa cortada por el salto de página\" del delta de add-pdf-statement-parser"
steps:
  - "la glosa de un movimiento de \"Banco Pampa Demo\" empieza en la última línea de la página 1 y sigue en la página 2 después del encabezado repetido de la tabla"
expected_result:
  - "la vista previa tiene una sola fila con la glosa completa"
  - "el encabezado repetido no aparece como fila"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-022 — Una glosa cortada por el salto de página se une al último movimiento de la página anterior

## Intención

El sistema DEBE (MUST) descartar los encabezados y pies que el diseño declara en cada página, sin que aparezcan como filas ni como inválidas; una glosa cortada por un salto de página DEBE (MUST) unirse al último movimiento de la página anterior; una página en blanco declarada por el diseño DEBE (MUST) omitirse; y si el extracto declara su número total de páginas, el sistema DEBE (MUST) verificar que leyó todas y, si no, dejar la importación en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH`, sin filas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando la glosa de un movimiento de "Banco Pampa Demo" empieza en la última línea de la página 1 y sigue en la página 2 después del encabezado repetido de la tabla
Entonces la vista previa tiene una sola fila con la glosa completa
  Y el encabezado repetido no aparece como fila
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
