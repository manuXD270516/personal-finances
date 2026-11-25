---
id: TC-DEBT-CARD-041
title: "El listado de tarjetas informa todos los estados vencidos con faltante, igual que el detalle"
spec: debt/credit-cards
related_specs: []
requirement: "Próximo vencimiento de la tarjeta"
scenario: "Estado de cuenta vencido con saldo pendiente"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: medium
type: integration
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/application/cards.service.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["credit-cards","overdue","list","fix-debt-cards-loans-gaps"]
error_code: null
preconditions:
  - "Estado de cuenta de \"Visa Oro BOB\" cerrado el 2026-10-25 con 1120.50 BOB, sin pagos"
  - "Hoy es 2026-12-20: ya cerraron dos ciclos desde ese estado"
input: {"today": "2026-12-20", "currency": "BOB"}
steps:
  - "Consultar `GET W/credit-cards` y `GET W/credit-cards/{id}`"
expected_result:
  - "Ambas respuestas informan el estado cerrado el 2026-10-25 en `overdueStatements`"
  - "El listado y el detalle coinciden en `overdueStatements` y `nextDueDate`"
created: 2026-11-25
updated: 2026-11-25
---

# TC-DEBT-CARD-041 — El listado de tarjetas informa todos los estados vencidos con faltante, igual que el detalle

## Intención

El listado calculaba un solo ciclo cerrado y omitía los estados vencidos más antiguos (docs/38 §4). Ahora usa la misma ventana de ciclos que el detalle.

## Escenario

```gherkin
Dado el estado de cuenta de "Visa Oro BOB" cerrado el 2026-10-25, sin pagos
Cuando se lista y se consulta la tarjeta el 2026-12-20
Entonces el listado y el detalle informan ese estado como atrasado
```
