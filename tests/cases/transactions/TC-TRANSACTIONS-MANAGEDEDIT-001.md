---
id: TC-TRANSACTIONS-MANAGEDEDIT-001
title: "Nota en un pago de préstamo desde la pantalla sin campos financieros"
spec: transactions/transaction-recording
related_specs: ["debt/loans"]
requirement: "Edición descriptiva de transacciones administradas desde la pantalla"
scenario: "Nota en un pago de préstamo desde la pantalla"
requirement_status: provisional
fr: ["FR-DEBT-002","FR-DEBT-007","FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-021"]
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["loans","managed-transactions","ui"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" en BOB, TZ America/La_Paz, con el préstamo \"Préstamo vehicular\" y su pago de 2342.02 BOB del 2026-11-15 desde \"Banco BOB\" (principal 1862.85 BOB, interés 479.17 BOB)"
  - "Usuario con rol EDITOR"
input: {}
steps:
  - "el EDITOR abre el detalle del pago y elige \"Editar descripción y notas\""
  - "escribe la nota \"pagado en ventanilla\" y guarda"
expected_result:
  - "el formulario muestra solo la descripción y las notas, sin monto, cuenta, fecha ni moneda"
  - "la nota queda registrada con la versión siguiente de la transacción"
  - "el asiento del pago y el saldo de \"Banco BOB\" no cambian"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-MANAGEDEDIT-001 — Nota en un pago de préstamo desde la pantalla sin campos financieros

## Intención

Verifica el scenario "Nota en un pago de préstamo desde la pantalla" del requirement "Edición descriptiva de transacciones administradas desde la pantalla" de `transactions/transaction-recording` (FR-DEBT-002, FR-DEBT-007, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" en BOB, TZ America/La_Paz, con el préstamo "Préstamo vehicular" y su pago de 2342.02 BOB del 2026-11-15 desde "Banco BOB" (principal 1862.85 BOB, interés 479.17 BOB)
Y Usuario con rol EDITOR
Cuando el EDITOR abre el detalle del pago y elige "Editar descripción y notas"
Y escribe la nota "pagado en ventanilla" y guarda
Entonces el formulario muestra solo la descripción y las notas, sin monto, cuenta, fecha ni moneda
Y la nota queda registrada con la versión siguiente de la transacción
Y el asiento del pago y el saldo de "Banco BOB" no cambian
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
