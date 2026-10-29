---
id: TC-IMPORTS-PDF-030
title: "La fecha compacta y el mes en español se leen igual con otro idioma y zona del sistema"
spec: imports/import-pipeline
related_specs: []
requirement: "Montos y fechas exactos del extracto PDF"
scenario: "Fecha compacta y mes del periodo en texto"
requirement_status: provisional
fr: ["FR-IMPORTS-006", "FR-IMPORTS-016"]
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
input: "Datos del scenario \"Fecha compacta y mes del periodo en texto\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto de \"Banco Cumbre Demo\" trae el periodo \"Marzo 2026\" y un movimiento con fecha \"20260305\" y hora \"09:40:10\", y el sistema corre con idioma en-US y zona UTC"
expected_result:
  - "el periodo del extracto es del 2026-03-01 al 2026-03-31 y la fila tiene la fecha de negocio 2026-03-05 y la hora 09:40:10 en America/La_Paz"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-030 — La fecha compacta y el mes en español se leen igual con otro idioma y zona del sistema

## Intención

El sistema DEBE (MUST) interpretar los montos con los separadores de miles y decimal que declara el diseño, convirtiendo el texto a decimal exacto sin pasar por un número de coma flotante y sin redondear: un monto con más decimales que la escala de la moneda o con separadores distintos de los declarados DEBE (MUST) marcar la fila inválida con `IMPORT_INVALID_AMOUNT` o `IMPORT_AMBIGUOUS_NUMBER`. El signo DEBE (MUST) salir de la columna con signo, de la diferencia entre crédito y débito o de la sección del movimiento según el diseño; una fila con débito y crédito distintos de cero DEBE (MUST) quedar inválida con `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`. Las fechas DEBEN (MUST) leerse con el formato del diseño y los meses en texto con una tabla de meses en español propia, sin depender del idioma ni de la zona del sistema; la hora sin zona DEBE (MUST) interpretarse en la zona del workspace.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto de "Banco Cumbre Demo" trae el periodo "Marzo 2026" y un movimiento con fecha "20260305" y hora "09:40:10", y el sistema corre con idioma en-US y zona UTC
Entonces el periodo del extracto es del 2026-03-01 al 2026-03-31 y la fila tiene la fecha de negocio 2026-03-05 y la hora 09:40:10 en America/La_Paz
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- El test fija process.env.TZ=UTC y el locale en-US en el proceso de prueba.
