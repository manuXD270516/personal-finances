---
id: TC-IMPORTS-PDF-021
title: "Con el monto como ancla, la fecha y la hora de otra línea se asignan a su movimiento"
spec: imports/import-pipeline
related_specs: []
requirement: "Reconstrucción de la tabla del extracto por posición"
scenario: "Fecha y hora en una línea distinta de la glosa"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
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
input: "Datos del scenario \"Fecha y hora en una línea distinta de la glosa\" del delta de add-pdf-statement-parser"
steps:
  - "en el extracto de \"Banco Altiplano Demo\" la fecha \"21/03/2026\" y la hora \"13:40\" de un retiro de 1,325.00 están una línea por encima de su glosa"
expected_result:
  - "la fila es una salida de 1325.00 BOB con fecha 2026-03-21, hora 13:40 y esa glosa completa"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-021 — Con el monto como ancla, la fecha y la hora de otra línea se asignan a su movimiento

## Intención

El sistema DEBE (MUST) reconstruir las filas de movimientos a partir de la posición de cada fragmento de texto y no del orden en que el documento los dibuja: DEBE (MUST) agrupar los fragmentos por línea, asignarlos a la columna cuyo rango, derivado de los rótulos del encabezado de la tabla, los contiene, unir las líneas de continuación de una glosa a su movimiento con un espacio y conservar el orden impreso de las filas aunque no sea cronológico. Un fragmento que cae entre dos columnas NO DEBE (MUST NOT) asignarse por aproximación: su fila DEBE (MUST) quedar inválida con `IMPORT_PDF_AMBIGUOUS_CELL` y su número de línea.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando en el extracto de "Banco Altiplano Demo" la fecha "21/03/2026" y la hora "13:40" de un retiro de 1,325.00 están una línea por encima de su glosa
Entonces la fila es una salida de 1325.00 BOB con fecha 2026-03-21, hora 13:40 y esa glosa completa
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
