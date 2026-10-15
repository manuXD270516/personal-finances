---
id: TC-IDENTITY-DEMO-018
title: "La demo trae préstamos francés, alemán con mora, saldado y en USD con pago extraordinario"
spec: identity/demo-data
related_specs: ["debt/loans", "debt/amortization"]
requirement: "Préstamos de demostración"
scenario: "Préstamos de la demo al 2026-09-30"
requirement_status: provisional
fr: ["FR-IDENTITY-014", "FR-DEBT-001", "FR-DEBT-003", "FR-DEBT-004", "FR-DEBT-007", "FR-DEBT-008"]
nfr: []
invariants: ["INV-017"]
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["demo-data", "loans", "amortization"]
error_code: null
preconditions:
  - "Workspace demo cargado con el dataset v2 y la fecha ancla 2026-09-30 (America/La_Paz), en estado READY"
  - "Reloj de la API fijado en 2026-09-30; préstamos 30/360, mensuales, sin ajuste de fin de semana"
input: {"action":"GET W/loans y GET W/loans/{id} del workspace demo; simulación de pago extra sobre \"Préstamo vehicular\""}
steps:
  - "Consultar cada préstamo con su cronograma vigente, pagos, principal pendiente y cuotas atrasadas"
  - "Simular un pago extra de 5000.00 BOB reduciendo el plazo en \"Préstamo vehicular\""
expected_result:
  - "Préstamo vehicular: francés 50000.00 BOB al 9.00 %, 36 cuotas de 1589.99 BOB; cuota 1 interés 375.00 y principal 1214.99; 19 cuotas pagadas; principal pendiente 25288.74 BOB igual al saldo de su cuenta; próxima cuota 20 del 2026-10-01 (interés 189.67, principal 1400.32); sin cuotas atrasadas"
  - "Préstamo de consumo: alemán 12000.00 BOB al 12.00 %, cuotas pagadas 1120.00, 1110.00, 1100.00 y 1090.00 BOB; principal pendiente 8000.00 BOB; atrasadas las cuotas 5 (1080.00 BOB, 2026-08-21) y 6 (1070.00 BOB, 2026-09-21)"
  - "Préstamo familiar: 1000.00 BOB, cuotas 340.02, 340.02 y 340.03 BOB pagadas; saldado y sin compromiso activo"
  - "Crédito educativo: cronograma versión 2 tras el pago extraordinario de 3000.00 USD del 2026-04-10 reduciendo plazo; cuotas 4 a 8 pagadas; principal pendiente 1007.15 USD; cuota 9 de 1017.22 USD (interés 10.07) el 2026-10-10; ahorro de interés 247.49 USD"
  - "La simulación sobre Préstamo vehicular pasa de 17 cuotas y 1740.99 BOB de interés restante a 14 cuotas y 1118.96 BOB (ahorro 622.03 BOB) y no persiste nada"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-018 — La demo trae préstamos francés, alemán con mora, saldado y en USD con pago extraordinario

## Intención

Cubre la tarea Could de `add-loans` (8.3, préstamo vehicular con cuotas pagadas) y da a la demo casos de los sistemas francés y alemán, mora, saldado, pago extraordinario y simulador.

## Escenario

```gherkin
Dado el workspace demo v2 cargado con la ancla 2026-09-30
Cuando consulto los préstamos el 2026-09-30
Entonces "Préstamo vehicular" tiene 19 cuotas pagadas y 25288.74 BOB de principal pendiente
  Y "Préstamo de consumo" tiene en mora las cuotas de 1080.00 BOB y 1070.00 BOB
  Y "Préstamo familiar" está saldado
  Y "Crédito educativo" tiene la versión 2 con 1007.15 USD pendientes
```

## Notas

- Cálculo a mano (Decimal, HALF_EVEN, 30/360): cuota francesa 50000.00 × 0.0075 / (1 − 1.0075^−36) = 1589.99; interés 1 = 50000.00 × 0.0075 = 375.00. Alemán: principal 12000.00 / 12 = 1000.00 por cuota; interés = saldo × 1 %. Crédito educativo: tras la cuota 3 quedan 9132.95 USD; − 3000.00 = 6132.95; cuotas 4–8 de 1066.19 dejan 1007.15; 1007.15 × 1 % = 10.07 (igual que el scenario "Prepago de 3000.00 reduciendo el plazo" de `debt/amortization`, en USD).
- La simulación supone el pago extra hoy, antes de la cuota 20; si el simulador aplica otra convención para el periodo en curso, prevalece `debt/amortization` y se corrige este TC.
- Change: `add-phase-4-demo-data`.
