---
id: TC-IMPORTS-PIPELINE-052
title: "Un movimiento con el mismo identificador del banco y otra descripción se clasifica como ya importado"
spec: imports/import-pipeline
related_specs: []
requirement: "Idempotencia por identificador externo"
scenario: "Mismo identificador con descripción cambiada"
requirement_status: provisional
fr: ["FR-IMPORTS-010", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
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
input: "Datos del scenario \"Mismo identificador con descripción cambiada\" del delta de add-import-pipeline"
steps:
  - "el movimiento con identificador \"2026030100017\" de \"Banco BOB\" ya se importó y un OFX posterior lo trae con la descripción \"COMPRA SUPERMERCADO SUC 12\""
expected_result:
  - "la fila se clasifica como ya importada y no se crea otra transacción"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-052 — Un movimiento con el mismo identificador del banco y otra descripción se clasifica como ya importado

## Intención

Cuando la fila trae un identificador externo estable —el del movimiento OFX o el de una columna de referencia declarada única en el perfil—, el sistema DEBE (MUST) usarlo, junto con la institución y el formato, como referencia de la transacción en la cuenta: una fila cuyo identificador ya tiene una transacción no anulada en la cuenta DEBE (MUST) clasificarse como ya importada aunque cambien su descripción o su fecha.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el movimiento con identificador "2026030100017" de "Banco BOB" ya se importó y un OFX posterior lo trae con la descripción "COMPRA SUPERMERCADO SUC 12"
Entonces la fila se clasifica como ya importada y no se crea otra transacción
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
