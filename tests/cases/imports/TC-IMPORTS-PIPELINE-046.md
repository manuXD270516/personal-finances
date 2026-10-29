---
id: TC-IMPORTS-PIPELINE-046
title: "Una fila marcada como conversión crea la conversión con su tasa efectiva y la referencia del instante"
spec: imports/import-pipeline
related_specs: ["transactions/conversions", "fx/conversion-pricing"]
requirement: "Filas como transferencia o conversión entre cuentas propias"
scenario: "Compra de dólares como conversión"
requirement_status: provisional
fr: ["FR-IMPORTS-009", "FR-TRANSACTIONS-021", "FR-FX-008"]
nfr: []
invariants: ["INV-004", "INV-010", "INV-011"]
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
  - "Cuenta \"Caja USD\" (ASSET, USD)"
  - "Tasa de referencia USD/BOB registrada antes de 2026-03-10T14:05:00-04:00"
input: "Datos del scenario \"Compra de dólares como conversión\" del delta de add-import-pipeline"
steps:
  - "el EDITOR marca la fila \"COMPRA DIVISAS\" de 696.00 BOB de salida de \"Banco BOB\" del 2026-03-10 a las 14:05 como conversión con \"Caja USD\" que recibe 100.00 USD y aprueba"
expected_result:
  - "se crea una conversión con \"Banco BOB\" −696.00 BOB y \"Caja USD\" +100.00 USD y tasa efectiva USD/BOB 6.96"
  - "la conversión queda vinculada a la tasa de referencia vigente el 2026-03-10 a las 14:05 en America/La_Paz"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-046 — Una fila marcada como conversión crea la conversión con su tasa efectiva y la referencia del instante

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder marcar en la vista previa una fila como transferencia hacia o desde otra cuenta propia de la misma moneda, o como conversión con otra cuenta propia de otra moneda indicando el monto recibido o entregado en ella; al aprobar, la fila DEBE (MUST) crear esa transferencia o conversión en lugar de un gasto o ingreso, la conversión DEBE (MUST) quedar vinculada a la tasa de referencia vigente al instante del movimiento y la pata creada en la otra cuenta DEBE (MUST) ser candidata de duplicado cuando se importe el extracto de esa cuenta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
  Y Cuenta "Caja USD" (ASSET, USD)
  Y Tasa de referencia USD/BOB registrada antes de 2026-03-10T14:05:00-04:00
Cuando el EDITOR marca la fila "COMPRA DIVISAS" de 696.00 BOB de salida de "Banco BOB" del 2026-03-10 a las 14:05 como conversión con "Caja USD" que recibe 100.00 USD y aprueba
Entonces se crea una conversión con "Banco BOB" −696.00 BOB y "Caja USD" +100.00 USD y tasa efectiva USD/BOB 6.96
  Y la conversión queda vinculada a la tasa de referencia vigente el 2026-03-10 a las 14:05 en America/La_Paz
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
