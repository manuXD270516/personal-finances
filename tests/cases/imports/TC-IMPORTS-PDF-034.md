---
id: TC-IMPORTS-PDF-034
title: "Un total de sección distinto de la suma de sus filas falla la importación"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldos del extracto PDF y coherencia interna"
scenario: "Total de una sección distinto de sus filas"
requirement_status: provisional
fr: ["FR-IMPORTS-011", "FR-IMPORTS-016"]
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
error_code: IMPORT_PDF_TOTALS_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Total de una sección distinto de sus filas\" del delta de add-pdf-statement-parser"
steps:
  - "la sección de retiros de \"Banco Altiplano Demo\" imprime \"Total retiros 4,510.79\" y sus filas suman 4501.79"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PDF_TOTALS_MISMATCH` y una diferencia de 9.00 BOB, sin filas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-034 — Un total de sección distinto de la suma de sus filas falla la importación

## Intención

El sistema DEBE (MUST) tomar del extracto PDF el saldo inicial, el saldo final y el periodo que declara el diseño, que NO DEBEN (MUST NOT) aparecer como movimientos, y registrarlos como saldo del extracto para la reconciliación al terminar la importación. Antes de la vista previa DEBE (MUST) verificar que el saldo inicial más la suma de los movimientos leídos sea igual al saldo final y, cuando el extracto imprime totales por sección o por columna, que coincidan con la suma de sus filas; si no se cumple, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y la diferencia, sin filas, en lugar de mostrar una vista previa incompleta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando la sección de retiros de "Banco Altiplano Demo" imprime "Total retiros 4,510.79" y sus filas suman 4501.79
Entonces la importación queda en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y una diferencia de 9.00 BOB, sin filas
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
