---
id: TC-IMPORTS-PIPELINE-047
title: "La pata de una conversión importada es candidata de duplicado al importar la otra cuenta"
spec: imports/import-pipeline
related_specs: ["transactions/duplicate-detection"]
requirement: "Filas como transferencia o conversión entre cuentas propias"
scenario: "Pata de la conversión en un import posterior"
requirement_status: provisional
fr: ["FR-IMPORTS-009", "FR-TRANSACTIONS-021", "FR-FX-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
status: ready
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
input: "Datos del scenario \"Pata de la conversión en un import posterior\" del delta de add-import-pipeline"
steps:
  - "después se importa el extracto de \"Caja USD\" con un ingreso de 100.00 USD del 2026-03-10"
expected_result:
  - "esa fila es un posible duplicado con la conversión como candidato"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-047 — La pata de una conversión importada es candidata de duplicado al importar la otra cuenta

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
Cuando después se importa el extracto de "Caja USD" con un ingreso de 100.00 USD del 2026-03-10
Entonces esa fila es un posible duplicado con la conversión como candidato
```

## Notas

- Cobertura (2026-10-30): recorrido completo por API entre dos imports (BOB → conversión hacia una cuenta USD; luego el extracto de la cuenta USD marca el ingreso como posible duplicado con la conversión como candidata); la pata como candidata también se verifica en TRANSACTIONS (TC-TRANSACTIONS-DEDUPE-006..008).
- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
