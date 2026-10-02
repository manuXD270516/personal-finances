---
id: TC-TRANSACTIONS-TRANSFER-002
title: "La transferencia en la misma moneda nunca cuenta como ingreso ni gasto y preserva el patrimonio"
spec: transactions/transfers
related_specs: ["ledger/journal-posting", "reporting/dashboard"]
requirement: "Transferencia entre cuentas propias"
scenario: "La transferencia preserva el patrimonio neto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-018, FR-LEDGER-001]
nfr: []
invariants: [INV-009, INV-004]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["transfer", "net-worth", "pbt"]
error_code: null
preconditions:
  - "Cuenta A (ASSET, BOB) 1000.00 BOB; cuenta B (ASSET, BOB) 0.00 BOB"
  - "Ingresos y gastos de marzo de 2026 conocidos"
input:
  canonical:
    from: "A"
    to: "B"
    amount: "300.00 BOB"
    date: "2026-03-15"
  generator: "montos aleatorios en (0, saldo de A] a escala 2"
steps: ["Registrar la transferencia canónica", "Ejecutar la propiedad con fast-check"]
expected_result:
  - "Canónico: A 700.00 BOB, B 300.00 BOB, patrimonio 1000.00 BOB; asiento B +300.00 / A -300.00"
  - "Ningún posting a INCOME ni EXPENSE; ingresos y gastos de marzo sin cambios"
  - "Propiedad: para todo monto, Δpatrimonio(BOB) = 0.00 y el asiento suma 0.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-TRANSFER-002 — La transferencia en la misma moneda nunca cuenta como ingreso ni gasto y preserva el patrimonio

## Intención

Complementa TC-LEDGER-TRANSFER-001 (ejemplo canónico) con la variante por propiedades y la exclusión de ingresos/gastos (INV-009).

## Escenario

```gherkin
Dado que la cuenta "A" tiene 1000.00 BOB y la cuenta "B" 0.00 BOB
Cuando el usuario transfiere 300.00 BOB de "A" a "B"
Entonces "A" tiene 700.00 BOB y "B" 300.00 BOB
  Y el patrimonio neto sigue siendo 1000.00 BOB
  Y los ingresos y gastos del mes no cambian
```
