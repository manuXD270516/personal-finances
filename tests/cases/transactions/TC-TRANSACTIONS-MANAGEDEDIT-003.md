---
id: TC-TRANSACTIONS-MANAGEDEDIT-003
title: "VIEWER no ve la edición de un pago de préstamo"
spec: transactions/transaction-recording
related_specs: ["debt/loans"]
requirement: "Edición descriptiva de transacciones administradas desde la pantalla"
scenario: "VIEWER sin edición"
requirement_status: provisional
fr: ["FR-DEBT-002","FR-TRANSACTIONS-009"]
nfr: []
invariants: []
priority: low
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["loans","managed-transactions","ui","roles"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB con el pago de 2342.02 BOB del \"Préstamo vehicular\""
  - "Usuario con rol VIEWER"
input: {}
steps:
  - "el VIEWER abre el detalle del pago"
expected_result:
  - "ve el desglose y el enlace al préstamo de origen"
  - "no se le ofrece editar la descripción ni las notas"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-MANAGEDEDIT-003 — VIEWER no ve la edición de un pago de préstamo

## Intención

Verifica el scenario "VIEWER sin edición" del requirement "Edición descriptiva de transacciones administradas desde la pantalla" de `transactions/transaction-recording` (FR-DEBT-002, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con el pago de 2342.02 BOB del "Préstamo vehicular"
Y Usuario con rol VIEWER
Cuando el VIEWER abre el detalle del pago
Entonces ve el desglose y el enlace al préstamo de origen
Y no se le ofrece editar la descripción ni las notas
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
