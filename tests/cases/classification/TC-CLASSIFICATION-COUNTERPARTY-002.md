---
id: TC-CLASSIFICATION-COUNTERPARTY-002
title: Crear una counterparty inline desde el formulario y usarla en el mismo gasto
spec: classification/counterparties
related_specs: [transactions/transaction-recording]
requirement: Creación inline de counterparties
scenario: Counterparty nueva desde el formulario
requirement_status: confirmed
fr: [FR-CLASSIFICATION-012]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [counterparties, ui]
error_code: null
preconditions:
- Counterparty activa "Hipermaxi"
- Cuenta "Efectivo BOB" activa
input:
- inline_create:
    name: Panadería Don Pepe
  record:
    amount: '35.00'
    currency: BOB
- inline_create:
    name: hipermaxi
steps:
- En el formulario de gasto escribir "Panadería Don Pepe" y elegir crear
- Guardar el gasto de 35.00 BOB
- En otro gasto escribir "hipermaxi" y elegir crear
expected_result:
- '"Panadería Don Pepe" queda activa con kind OTHER y el gasto de 35.00 BOB la referencia'
- La segunda creación responde 409 NAME_TAKEN con existingId de "Hipermaxi" y la UI la selecciona
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-COUNTERPARTY-002 — Crear una counterparty inline desde el formulario y usarla en el mismo gasto

## Intención

FR-CLASSIFICATION-012: creación inline sin salir del formulario y sin duplicados.

## Escenario

```gherkin
Dado el formulario de un gasto de 35.00 BOB
Cuando el usuario crea inline "Panadería Don Pepe"
Entonces la counterparty queda activa con tipo "otro"
  Y el gasto se registra con ella
```
