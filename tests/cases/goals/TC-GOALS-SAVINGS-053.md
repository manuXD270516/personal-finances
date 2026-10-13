---
id: TC-GOALS-SAVINGS-053
title: "La UI avisa antes de anular un aporte con retiros posteriores y la meta muestra el faltante"
spec: goals/savings-goals
related_specs: ["transactions/transaction-recording"]
requirement: "Anulación o revisión de la transacción de un movimiento"
scenario: "Aviso antes de anular un aporte con un retiro posterior"
requirement_status: confirmed
fr: ["FR-GOALS-005"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/goals/goals.test.tsx
  - tests/e2e/specs/goals.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["goals", "void", "ui", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "EDITOR autenticado; mismo escenario de TC-GOALS-SAVINGS-051"
input: {}
steps:
  - "Abrir la transferencia del 2026-10-01 y elegir Anular"
  - "Leer el diálogo de confirmación y confirmar"
  - "Abrir \"Fondo de emergencia\""
expected_result:
  - "El diálogo avisa que \"Fondo de emergencia\" quedará con −400.00 BOB en \"Ahorro BOB\" y permite confirmar"
  - "La transferencia queda anulada"
  - "La meta muestra el faltante de 400.00 BOB en \"Ahorro BOB\"; sin violaciones de axe"
created: 2026-10-13
updated: 2026-10-13
---

# TC-GOALS-SAVINGS-053 — La UI avisa antes de anular un aporte con retiros posteriores y la meta muestra el faltante

## Intención

Verifica el aviso de D222 de punta a punta en la UI (diálogo de anulación de TRANSACTIONS compuesto con la consulta de GOALS).

## Escenario

```gherkin
Dado el aporte con un retiro posterior
Cuando el EDITOR anula la transferencia desde la UI
Entonces ve el aviso de fondos negativos antes de confirmar
  Y después la meta muestra el faltante
```

## Notas

- Ejecutar con `PF_E2E_PROJECT=pfos-e2e-<nombre>`.
