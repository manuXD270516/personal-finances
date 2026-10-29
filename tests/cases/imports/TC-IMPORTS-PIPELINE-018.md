---
id: TC-IMPORTS-PIPELINE-018
title: "Con el formato día primero un QIF de tarjeta produce una salida de 120.00 BOB del 2026-04-03"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura de archivos QIF"
scenario: "QIF de tarjeta con formato elegido"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"QIF de tarjeta con formato elegido\" del delta de add-import-pipeline"
steps:
  - "el usuario elige el formato día primero para un QIF de tarjeta con \"D03/04'26\" y \"T-120.00\""
expected_result:
  - "la fila es una salida de 120.00 BOB con fecha 2026-04-03"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-018 — Con el formato día primero un QIF de tarjeta produce una salida de 120.00 BOB del 2026-04-03

## Intención

El lector de QIF DEBE (MUST) admitir los tipos de cuenta bancaria y de tarjeta, leer fecha, monto, beneficiario y memo de cada movimiento y verificar que sus líneas de división sumen el monto del movimiento; como QIF no declara el orden de día y mes, una fecha ambigua NO DEBE (MUST NOT) interpretarse sin un formato de fecha elegido en el perfil o en el mapeo, y mientras falte la importación DEBE (MUST) quedar esperando mapeo con `IMPORT_AMBIGUOUS_DATE`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el usuario elige el formato día primero para un QIF de tarjeta con "D03/04'26" y "T-120.00"
Entonces la fila es una salida de 120.00 BOB con fecha 2026-04-03
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
