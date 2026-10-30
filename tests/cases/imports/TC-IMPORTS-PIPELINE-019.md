---
id: TC-IMPORTS-PIPELINE-019
title: "Un movimiento QIF cuyas divisiones no suman su monto queda inválido"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura de archivos QIF"
scenario: "Líneas de división que no suman"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/readers/qif-reader.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_INVALID_AMOUNT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Líneas de división que no suman\" del delta de add-import-pipeline"
steps:
  - "un movimiento QIF de -100.00 trae dos líneas de división de -60.00 y -30.00"
expected_result:
  - "la fila queda inválida con `IMPORT_INVALID_AMOUNT`"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-019 — Un movimiento QIF cuyas divisiones no suman su monto queda inválido

## Intención

El lector de QIF DEBE (MUST) admitir los tipos de cuenta bancaria y de tarjeta, leer fecha, monto, beneficiario y memo de cada movimiento y verificar que sus líneas de división sumen el monto del movimiento; como QIF no declara el orden de día y mes, una fecha ambigua NO DEBE (MUST NOT) interpretarse sin un formato de fecha elegido en el perfil o en el mapeo, y mientras falte la importación DEBE (MUST) quedar esperando mapeo con `IMPORT_AMBIGUOUS_DATE`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un movimiento QIF de -100.00 trae dos líneas de división de -60.00 y -30.00
Entonces la fila queda inválida con `IMPORT_INVALID_AMOUNT`
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
