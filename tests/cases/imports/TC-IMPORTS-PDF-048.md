---
id: TC-IMPORTS-PDF-048
title: "Desde el asistente, un extracto PDF coherente muestra el diseño, el saldo del extracto y la vista previa"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldos del extracto PDF y coherencia interna"
scenario: "Extracto coherente"
requirement_status: provisional
fr: ["FR-IMPORTS-011", "FR-IMPORTS-016"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pdf.test.tsx
  - tests/e2e/specs/import-pdf.spec.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf", "ui"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Extracto coherente\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto de \"Banco Cumbre Demo\" declara saldo inicial 155.00 y saldo final 1019.32 y sus movimientos son 0.07, 1250.00, -85.50 y -300.25"
expected_result:
  - "la importación registra el saldo del extracto de 155.00 a 1019.32 BOB del 2026-03-01 al 2026-03-31"
  - "queda \"en revisión\" con 4 filas"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-048 — Desde el asistente, un extracto PDF coherente muestra el diseño, el saldo del extracto y la vista previa

## Intención

El sistema DEBE (MUST) tomar del extracto PDF el saldo inicial, el saldo final y el periodo que declara el diseño, que NO DEBEN (MUST NOT) aparecer como movimientos, y registrarlos como saldo del extracto para la reconciliación al terminar la importación. Antes de la vista previa DEBE (MUST) verificar que el saldo inicial más la suma de los movimientos leídos sea igual al saldo final y, cuando el extracto imprime totales por sección o por columna, que coincidan con la suma de sus filas; si no se cumple, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y la diferencia, sin filas, en lugar de mostrar una vista previa incompleta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto de "Banco Cumbre Demo" declara saldo inicial 155.00 y saldo final 1019.32 y sus movimientos son 0.07, 1250.00, -85.50 y -300.25
Entonces la importación registra el saldo del extracto de 155.00 a 1019.32 BOB del 2026-03-01 al 2026-03-31
  Y queda "en revisión" con 4 filas
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Playwright con PF_E2E_PROJECT; el PDF se genera en el test y se sube por el flujo de documentos.
