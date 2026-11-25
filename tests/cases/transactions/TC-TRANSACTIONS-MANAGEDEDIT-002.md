---
id: TC-TRANSACTIONS-MANAGEDEDIT-002
title: "Cargo de tarjeta con campos financieros de solo lectura y nota guardada"
spec: transactions/transaction-recording
related_specs: ["debt/credit-cards"]
requirement: "Edición descriptiva de transacciones administradas desde la pantalla"
scenario: "Cargo de tarjeta con campos financieros de solo lectura"
requirement_status: provisional
fr: ["FR-DEBT-013","FR-TRANSACTIONS-009"]
nfr: []
invariants: ["INV-021"]
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges","managed-transactions","ui"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB con la tarjeta \"Visa Oro BOB\" y su cargo de 4.80 BOB del 2026-10-25 (interés 4.00 BOB en \"Intereses pagados\" y seguro 0.80 BOB en \"Seguros\")"
  - "Usuario con rol EDITOR"
input: {}
steps:
  - "el EDITOR abre el formulario de edición del cargo"
  - "agrega la nota \"interés por pago parcial de septiembre\" y guarda"
expected_result:
  - "el monto 4.80 BOB, la cuenta, la fecha y las categorías de las porciones se muestran como solo lectura con el aviso de que los administra \"Visa Oro\" y su enlace"
  - "la petición enviada solo lleva los campos descriptivos"
  - "la nota queda registrada y el cargo sigue en 4.80 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-MANAGEDEDIT-002 — Cargo de tarjeta con campos financieros de solo lectura y nota guardada

## Intención

Verifica el scenario "Cargo de tarjeta con campos financieros de solo lectura" del requirement "Edición descriptiva de transacciones administradas desde la pantalla" de `transactions/transaction-recording` (FR-DEBT-013, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con la tarjeta "Visa Oro BOB" y su cargo de 4.80 BOB del 2026-10-25 (interés 4.00 BOB en "Intereses pagados" y seguro 0.80 BOB en "Seguros")
Y Usuario con rol EDITOR
Cuando el EDITOR abre el formulario de edición del cargo
Y agrega la nota "interés por pago parcial de septiembre" y guarda
Entonces el monto 4.80 BOB, la cuenta, la fecha y las categorías de las porciones se muestran como solo lectura con el aviso de que los administra "Visa Oro" y su enlace
Y la petición enviada solo lleva los campos descriptivos
Y la nota queda registrada y el cargo sigue en 4.80 BOB
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
