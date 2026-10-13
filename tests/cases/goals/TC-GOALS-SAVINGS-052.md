---
id: TC-GOALS-SAVINGS-052
title: "La vista previa de anulación informa por meta y cuenta los fondos que quedarán antes de confirmar"
spec: goals/savings-goals
related_specs: []
requirement: "Anulación o revisión de la transacción de un movimiento"
scenario: "Aviso antes de anular un aporte con un retiro posterior"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["goals", "void", "preview", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "Mismo escenario de TC-GOALS-SAVINGS-051"
  - "Otro workspace con una transacción de id distinto"
input: {"transactionId": "<transferencia del 2026-10-01>"}
steps:
  - "`GET W/goals/void-impact?transactionId=<id>` como VIEWER"
  - "Repetir con una transacción sin movimientos de meta"
  - "Repetir con el id de una transacción de otro workspace"
expected_result:
  - "200 con una entrada: \"Fondo de emergencia\", \"Ahorro BOB\", `currentFunds` 600.00 BOB, `fundsAfterVoid` −400.00 BOB, `negative = true`"
  - "Para una transacción sin movimientos de meta, 200 con la lista vacía"
  - "Para la transacción de otro workspace, 404 (aislamiento)"
  - "La consulta no modifica ninguna meta ni transacción"
created: 2026-10-13
updated: 2026-10-13
---

# TC-GOALS-SAVINGS-052 — La vista previa de anulación informa por meta y cuenta los fondos que quedarán antes de confirmar

## Intención

El aviso de D222 lo muestra la UI antes de confirmar la anulación; esta consulta es su fuente y no debe tener efectos ni filtrar datos de otro workspace.

## Escenario

```gherkin
Dado el aporte de 1000.00 BOB con un retiro posterior de 400.00 BOB
Cuando se pide la vista previa de anular su transferencia
Entonces la respuesta informa −400.00 BOB en "Ahorro BOB" como negativo
  Y no cambia ningún dato
```

## Notas

