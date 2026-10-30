---
id: TC-IMPORTS-PDF-025
title: "La página en blanco declarada por el diseño se omite sin advertencias"
spec: imports/import-pipeline
related_specs: []
requirement: "Saltos de página, encabezados y pies del extracto PDF"
scenario: "Página en blanco intencional"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: low
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
input: "Datos del scenario \"Página en blanco intencional\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto de \"Banco Altiplano Demo\" tiene una página con el texto \"Esta página se dejó en blanco intencionalmente\""
expected_result:
  - "la página se omite sin advertencias y el número de páginas leídas la incluye"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-025 — La página en blanco declarada por el diseño se omite sin advertencias

## Intención

El sistema DEBE (MUST) descartar los encabezados y pies que el diseño declara en cada página, sin que aparezcan como filas ni como inválidas; una glosa cortada por un salto de página DEBE (MUST) unirse al último movimiento de la página anterior; una página en blanco declarada por el diseño DEBE (MUST) omitirse; y si el extracto declara su número total de páginas, el sistema DEBE (MUST) verificar que leyó todas y, si no, dejar la importación en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH`, sin filas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto de "Banco Altiplano Demo" tiene una página con el texto "Esta página se dejó en blanco intencionalmente"
Entonces la página se omite sin advertencias y el número de páginas leídas la incluye
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
