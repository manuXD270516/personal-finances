---
id: TC-IMPORTS-PDF-026
title: "Un crédito con miles con coma se lee como decimal exacto"
spec: imports/import-pipeline
related_specs: []
requirement: "Montos y fechas exactos del extracto PDF"
scenario: "Miles con coma y decimal con punto"
requirement_status: provisional
fr: ["FR-IMPORTS-006", "FR-IMPORTS-016"]
nfr: []
invariants: ["INV-001", "INV-003"]
priority: critical
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
input: "Datos del scenario \"Miles con coma y decimal con punto\" del delta de add-pdf-statement-parser"
steps:
  - "un movimiento de \"Banco Pampa Demo\" trae \"0.00\" en débito y \"10,500.75\" en crédito"
expected_result:
  - "la fila es un ingreso de 10500.75 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-026 — Un crédito con miles con coma se lee como decimal exacto

## Intención

El sistema DEBE (MUST) interpretar los montos con los separadores de miles y decimal que declara el diseño, convirtiendo el texto a decimal exacto sin pasar por un número de coma flotante y sin redondear: un monto con más decimales que la escala de la moneda o con separadores distintos de los declarados DEBE (MUST) marcar la fila inválida con `IMPORT_INVALID_AMOUNT` o `IMPORT_AMBIGUOUS_NUMBER`. El signo DEBE (MUST) salir de la columna con signo, de la diferencia entre crédito y débito o de la sección del movimiento según el diseño; una fila con débito y crédito distintos de cero DEBE (MUST) quedar inválida con `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`. Las fechas DEBEN (MUST) leerse con el formato del diseño y los meses en texto con una tabla de meses en español propia, sin depender del idioma ni de la zona del sistema; la hora sin zona DEBE (MUST) interpretarse en la zona del workspace.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un movimiento de "Banco Pampa Demo" trae "0.00" en débito y "10,500.75" en crédito
Entonces la fila es un ingreso de 10500.75 BOB
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
