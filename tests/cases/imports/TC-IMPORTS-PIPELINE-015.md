---
id: TC-IMPORTS-PIPELINE-015
title: "El saldo contable final del OFX queda como saldo final del extracto de la importación"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura de extractos OFX"
scenario: "Saldo del extracto"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-006", "FR-IMPORTS-010", "FR-IMPORTS-011"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/readers/ofx-reader.test.ts
status: automated
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
input: "Datos del scenario \"Saldo del extracto\" del delta de add-import-pipeline"
steps:
  - "el OFX trae como saldo contable 1019.32 al 2026-03-31"
expected_result:
  - "la importación registra el saldo final del extracto 1019.32 BOB al 2026-03-31"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-015 — El saldo contable final del OFX queda como saldo final del extracto de la importación

## Intención

El lector de OFX DEBE (MUST) tomar de cada movimiento su identificador del banco como identificador externo, su monto con signo, su fecha convertida a fecha de negocio en la zona del workspace y su nombre y memo como descripción; DEBE (MUST) tomar el saldo contable final del extracto y su fecha como saldo del extracto; y si la moneda del extracto no es la de la cuenta destino, todas las filas DEBEN (MUST) quedar inválidas con `IMPORT_CURRENCY_MISMATCH`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el OFX trae como saldo contable 1019.32 al 2026-03-31
Entonces la importación registra el saldo final del extracto 1019.32 BOB al 2026-03-31
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
