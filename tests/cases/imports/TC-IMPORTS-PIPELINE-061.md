---
id: TC-IMPORTS-PIPELINE-061
title: "El deshacer parcial explícito anula las transacciones no bloqueadas y deja el saldo en 12000.00 BOB"
spec: imports/import-pipeline
related_specs: []
requirement: "Deshacer un import"
scenario: "Deshacer parcial explícito"
requirement_status: provisional
fr: ["FR-IMPORTS-012", "FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-008"]
priority: medium
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
input: "Datos del scenario \"Deshacer parcial explícito\" del delta de add-import-pipeline"
steps:
  - "con el ingreso de 8000.00 BOB reconciliado la EDITOR pide el deshacer parcial"
expected_result:
  - "los 2 gastos de 18.00 BOB quedan anulados y el saldo de \"Banco BOB\" es 12000.00 BOB"
  - "la importación queda \"deshecha parcialmente\" con 1 fila bloqueada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-061 — El deshacer parcial explícito anula las transacciones no bloqueadas y deja el saldo en 12000.00 BOB

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder deshacer una importación terminada: el sistema DEBE (MUST) mostrar antes cuántas transacciones se anularán y cuáles están bloqueadas, y al confirmar DEBE (MUST) anular con su reversa cada transacción no anulada que la importación creó, sin borrar nada, con auditoría y de forma idempotente.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando con el ingreso de 8000.00 BOB reconciliado la EDITOR pide el deshacer parcial
Entonces los 2 gastos de 18.00 BOB quedan anulados y el saldo de "Banco BOB" es 12000.00 BOB
  Y la importación queda "deshecha parcialmente" con 1 fila bloqueada
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
