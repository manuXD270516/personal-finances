---
id: TC-DEBT-CARD-039
title: "Un estado de cuenta vencido con saldo pendiente se informa como atrasado y el próximo vencimiento pasa al ciclo abierto"
spec: debt/credit-cards
related_specs: []
requirement: "Próximo vencimiento de la tarjeta"
scenario: "Estado de cuenta vencido con saldo pendiente"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/next-due-resolver.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["credit-cards", "due-date", "overdue", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "\"Visa Oro\" cierra el día 25 y vence el día 15; estado de cuenta de \"Visa Oro BOB\" cerrado el 2026-10-25 con saldo facturado 1120.50 BOB y mínimo 56.02 BOB"
  - "Pago de 500.00 BOB desde \"Banco BOB\" el 2026-11-01"
input: {"today": "2026-11-20", "remainingNoInterest": "620.50", "currency": "BOB"}
steps:
  - "Con hoy 2026-10-28, consultar `GET W/credit-cards/{id}`"
  - "Con hoy 2026-11-20, consultar `GET W/credit-cards/{id}`"
expected_result:
  - "El 2026-10-28 el próximo vencimiento es 2026-11-15 y no hay estados atrasados"
  - "El 2026-11-20 el próximo vencimiento es 2026-12-15"
  - "El 2026-11-20 `overdueStatements` contiene el estado cerrado el 2026-10-25, `PARTIALLY_PAID`, con 620.50 BOB pendientes"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-CARD-039 — Un estado de cuenta vencido con saldo pendiente se informa como atrasado y el próximo vencimiento pasa al ciclo abierto

## Intención

Cubre los dos scenarios restantes del requirement: un estado emitido no vencido sigue siendo el próximo vencimiento y uno vencido sale de "próximo" y aparece como atrasado, sin fechas pasadas en el campo de próximo vencimiento.

## Escenario

```gherkin
Dado el estado de cuenta de "Visa Oro BOB" cerrado el 2026-10-25 con 1120.50 BOB
  Y un pago de 500.00 BOB el 2026-11-01
Cuando se consulta la tarjeta el 2026-11-20
Entonces el próximo vencimiento es 2026-12-15
  Y el estado cerrado el 2026-10-25 figura atrasado con 620.50 BOB pendientes
```

## Notas

- Incluye el scenario "Estado de cuenta emitido aún no vencido" (2026-10-28).
