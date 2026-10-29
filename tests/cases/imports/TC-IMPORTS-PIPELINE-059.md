---
id: TC-IMPORTS-PIPELINE-059
title: "Deshacer un import anula sus 3 transacciones con reversa y devuelve el saldo a 4000.00 BOB"
spec: imports/import-pipeline
related_specs: []
requirement: "Deshacer un import"
scenario: "Deshacer un import de 3 transacciones"
requirement_status: provisional
fr: ["FR-IMPORTS-012", "FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-007", "INV-008", "INV-029"]
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
  - "\"Banco BOB\" con saldo contable 4000.00 BOB antes del import"
input: "Datos del scenario \"Deshacer un import de 3 transacciones\" del delta de add-import-pipeline"
steps:
  - "\"Banco BOB\" tenía 4000.00 BOB, una importación creó 2 gastos de 18.00 BOB y un ingreso de 8000.00 BOB (saldo 11964.00 BOB) y la EDITOR \"Ana\" la deshace"
expected_result:
  - "las 3 transacciones quedan anuladas con su reversa y el saldo de \"Banco BOB\" vuelve a 4000.00 BOB"
  - "la importación queda \"deshecha\" con un registro de auditoría con \"Ana\" como actor"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-059 — Deshacer un import anula sus 3 transacciones con reversa y devuelve el saldo a 4000.00 BOB

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder deshacer una importación terminada: el sistema DEBE (MUST) mostrar antes cuántas transacciones se anularán y cuáles están bloqueadas, y al confirmar DEBE (MUST) anular con su reversa cada transacción no anulada que la importación creó, sin borrar nada, con auditoría y de forma idempotente.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
  Y "Banco BOB" con saldo contable 4000.00 BOB antes del import
Cuando "Banco BOB" tenía 4000.00 BOB, una importación creó 2 gastos de 18.00 BOB y un ingreso de 8000.00 BOB (saldo 11964.00 BOB) y la EDITOR "Ana" la deshace
Entonces las 3 transacciones quedan anuladas con su reversa y el saldo de "Banco BOB" vuelve a 4000.00 BOB
  Y la importación queda "deshecha" con un registro de auditoría con "Ana" como actor
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
