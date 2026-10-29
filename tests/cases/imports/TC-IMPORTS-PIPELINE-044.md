---
id: TC-IMPORTS-PIPELINE-044
title: "Una fila marcada como transferencia a la tarjeta crea una transferencia y ningún gasto"
spec: imports/import-pipeline
related_specs: ["transactions/transfers"]
requirement: "Filas como transferencia o conversión entre cuentas propias"
scenario: "Pago de tarjeta como transferencia"
requirement_status: provisional
fr: ["FR-IMPORTS-009", "FR-TRANSACTIONS-021", "FR-FX-008"]
nfr: []
invariants: ["INV-004", "INV-009"]
priority: high
type: api
level: api
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
  - "Tarjeta \"Visa\" (LIABILITY, BOB) con deuda"
input: "Datos del scenario \"Pago de tarjeta como transferencia\" del delta de add-import-pipeline"
steps:
  - "el EDITOR marca la fila \"PAGO TARJETA\" de 400.00 BOB de salida de \"Banco BOB\" del 2026-10-10 como transferencia a \"Visa\" en BOB y aprueba"
expected_result:
  - "se crea una transferencia de 400.00 BOB de \"Banco BOB\" a \"Visa\" y ningún gasto"
  - "la deuda de \"Visa\" baja 400.00 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-044 — Una fila marcada como transferencia a la tarjeta crea una transferencia y ningún gasto

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder marcar en la vista previa una fila como transferencia hacia o desde otra cuenta propia de la misma moneda, o como conversión con otra cuenta propia de otra moneda indicando el monto recibido o entregado en ella; al aprobar, la fila DEBE (MUST) crear esa transferencia o conversión en lugar de un gasto o ingreso, la conversión DEBE (MUST) quedar vinculada a la tasa de referencia vigente al instante del movimiento y la pata creada en la otra cuenta DEBE (MUST) ser candidata de duplicado cuando se importe el extracto de esa cuenta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
  Y Tarjeta "Visa" (LIABILITY, BOB) con deuda
Cuando el EDITOR marca la fila "PAGO TARJETA" de 400.00 BOB de salida de "Banco BOB" del 2026-10-10 como transferencia a "Visa" en BOB y aprueba
Entonces se crea una transferencia de 400.00 BOB de "Banco BOB" a "Visa" y ningún gasto
  Y la deuda de "Visa" baja 400.00 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
