---
id: TC-IMPORTS-PDF-035
title: "La fila de saldo anterior y el total del pie son saldos del extracto y no movimientos"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldos del extracto PDF y coherencia interna"
scenario: "Saldo anterior en la tabla y saldo final en el pie"
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
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Saldo anterior en la tabla y saldo final en el pie\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto de \"Banco Pampa Demo\" trae la fila \"Saldo anterior\" con saldo 2,640.00 y el pie \"TOTAL SALDO ACTUAL: 12,050.66\" con 11 movimientos que suman 9410.66"
expected_result:
  - "la importación registra el saldo del extracto de 2640.00 a 12050.66 BOB y tiene 11 filas, sin la fila \"Saldo anterior\""
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-035 — La fila de saldo anterior y el total del pie son saldos del extracto y no movimientos

## Intención

El sistema DEBE (MUST) tomar del extracto PDF el saldo inicial, el saldo final y el periodo que declara el diseño, que NO DEBEN (MUST NOT) aparecer como movimientos, y registrarlos como saldo del extracto para la reconciliación al terminar la importación. Antes de la vista previa DEBE (MUST) verificar que el saldo inicial más la suma de los movimientos leídos sea igual al saldo final y, cuando el extracto imprime totales por sección o por columna, que coincidan con la suma de sus filas; si no se cumple, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y la diferencia, sin filas, en lugar de mostrar una vista previa incompleta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto de "Banco Pampa Demo" trae la fila "Saldo anterior" con saldo 2,640.00 y el pie "TOTAL SALDO ACTUAL: 12,050.66" con 11 movimientos que suman 9410.66
Entonces la importación registra el saldo del extracto de 2640.00 a 12050.66 BOB y tiene 11 filas, sin la fila "Saldo anterior"
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
