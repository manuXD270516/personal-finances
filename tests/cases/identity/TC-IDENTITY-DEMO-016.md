---
id: TC-IDENTITY-DEMO-016
title: "La demo trae una tarjeta bimoneda con cuotas, un estado de cuenta emitido, uno pagado parcialmente y uno vencido"
spec: identity/demo-data
related_specs: ["debt/credit-cards"]
requirement: "Tarjetas de crédito de demostración"
scenario: "Tarjeta bimoneda con cuotas y un estado de cuenta vencido"
requirement_status: provisional
fr: ["FR-IDENTITY-014", "FR-DEBT-012", "FR-DEBT-013", "FR-DEBT-016", "FR-DEBT-017"]
nfr: []
invariants: ["INV-020"]
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["demo-data", "credit-cards"]
error_code: null
preconditions:
  - "Workspace demo cargado con el dataset v2 y la fecha ancla 2026-09-30 (America/La_Paz), en estado READY"
  - "Reloj de la API fijado en 2026-09-30"
  - "\"Tarjeta Kantuta Demo\": BOB y USD, cierre día 18, vencimiento día 8, mínimo 5.00 % con piso 50.00 BOB y 10.00 USD; Refrigerador 4800.00 BOB del 2026-07-25 en 6 cuotas sin interés; compras de 320.50 BOB (2026-08-10), 150.00 BOB (2026-08-25) y 200.00 USD (2026-08-05); pago de 500.00 BOB el 2026-09-01"
input: {"action":"GET W/credit-cards/{id} de \"Tarjeta Kantuta Demo\" y de \"Tarjeta Andina Demo\""}
steps:
  - "Consultar los estados de cuenta cerrados el 2026-08-18 y el 2026-09-18 por moneda"
  - "Consultar el calendario de cargos futuros"
  - "Consultar \"Tarjeta Andina Demo\" y su pago administrado"
expected_result:
  - "BOB 2026-08-18: saldo al cierre 5120.50, facturado 1120.50, mínimo 56.02 BOB, PARTIALLY_PAID con 620.50 BOB pendientes"
  - "USD 2026-08-18: facturado 200.00 USD, mínimo 10.00 USD, OVERDUE con 10.00 USD pendientes del mínimo"
  - "BOB 2026-09-18: saldo anterior 5120.50, compras 150.00, pagos 500.00, saldo al cierre 4770.50, facturado 1570.50, mínimo 78.52 BOB, ISSUED, vence 2026-10-08"
  - "Cargos futuros: 800.00 BOB al 2026-11-08, 2026-12-08, 2027-01-08 y 2027-02-08; las 6 cuotas suman 4800.00 BOB"
  - "\"Tarjeta Andina Demo\" (cierre 25, vencimiento 15) tiene su estado de cuenta del 2026-09-25 ISSUED con vencimiento 2026-10-15 y una ocurrencia del pago administrado por su total facturado"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-016 — La demo trae una tarjeta bimoneda con cuotas, un estado de cuenta emitido, uno pagado parcialmente y uno vencido

## Intención

Cubre la tarea Could diferida de `add-credit-cards` (8.3, tarjeta bimoneda con compra en cuotas), con un nombre ficticio en lugar de la marca real de la tarea original.

## Escenario

```gherkin
Dado el workspace demo v2 cargado con la ancla 2026-09-30
Cuando consulto "Tarjeta Kantuta Demo" el 2026-09-30
Entonces el estado de cuenta BOB del 2026-08-18 está PARTIALLY_PAID con 620.50 BOB pendientes
  Y el USD del 2026-08-18 está OVERDUE con 10.00 USD pendientes del mínimo
  Y el BOB del 2026-09-18 está ISSUED con facturado 1570.50 BOB y mínimo 78.52 BOB
```

## Notas

- Cálculo a mano: 4800.00 + 320.50 = 5120.50; 5120.50 − 5 × 800.00 = 1120.50; 1120.50 × 5 % = 56.025 ⇒ 56.02 (HALF_EVEN); 1120.50 − 500.00 = 620.50. 5120.50 + 150.00 − 500.00 = 4770.50; 4770.50 − 4 × 800.00 = 1570.50; 1570.50 × 5 % = 78.525 ⇒ 78.52. 200.00 × 5 % = 10.00 = piso.
- Change: `add-phase-4-demo-data`.
