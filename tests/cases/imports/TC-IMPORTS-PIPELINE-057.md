---
id: TC-IMPORTS-PIPELINE-057
title: "Un import cuyo saldo coincide con el extracto termina completado y ofrece la reconciliación"
spec: imports/import-pipeline
related_specs: ["transactions/reconciliation"]
requirement: "Reconciliación contra el saldo final del extracto"
scenario: "Extracto que cuadra"
requirement_status: provisional
fr: ["FR-IMPORTS-011", "FR-TRANSACTIONS-030"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/web/src/ui/imports/pipeline-logic.test.ts
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
  - tests/e2e/specs/import-pipeline.spec.ts
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
input: "Datos del scenario \"Extracto que cuadra\" del delta de add-import-pipeline"
steps:
  - "el OFX de \"Banco BOB\" declara un saldo final de 1019.32 BOB al 2026-03-31 y tras persistir el saldo contable de la cuenta a esa fecha es 1019.32 BOB"
expected_result:
  - "la importación termina completada y ofrece iniciar la reconciliación de \"Banco BOB\" al 2026-03-31 por 1019.32 BOB"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-057 — Un import cuyo saldo coincide con el extracto termina completado y ofrece la reconciliación

## Intención

Al terminar de persistir una importación con saldo final del extracto conocido, el sistema DEBERÍA (SHOULD) comparar el saldo contable de la cuenta a la fecha de ese saldo con el saldo del extracto: si coinciden, la importación DEBE (MUST) terminar completada y ofrecer iniciar una sesión de reconciliación con esa fecha y ese saldo; si difieren, DEBE (MUST) terminar "completada con diferencia" mostrando la diferencia.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el OFX de "Banco BOB" declara un saldo final de 1019.32 BOB al 2026-03-31 y tras persistir el saldo contable de la cuenta a esa fecha es 1019.32 BOB
Entonces la importación termina completada y ofrece iniciar la reconciliación de "Banco BOB" al 2026-03-31 por 1019.32 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
