---
id: TC-IDENTITY-DEMO-019
title: "Con la demo, el resumen de deudas y el disponible para gastar muestran cifras no triviales en BOB y USD"
spec: identity/demo-data
related_specs: ["debt/loans", "reporting/dashboard"]
requirement: "Resumen de deudas y disponible para gastar con la demo"
scenario: "Resumen de deudas de la demo"
requirement_status: provisional
fr: ["FR-IDENTITY-014", "FR-DEBT-018", "FR-PLANNING-024"]
nfr: []
invariants: ["INV-001", "INV-002"]
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["demo-data", "debt-summary", "spendable"]
error_code: null
preconditions:
  - "Workspace demo cargado con el dataset v2 y la fecha ancla 2026-09-30 (America/La_Paz), en estado READY y con los consumidores asíncronos drenados"
  - "Reloj de la API fijado en 2026-09-30; tasa de cierre USD/BOB PARALLEL 7.00 del 2026-09-29; sin plan de presupuesto (periodo de septiembre de 2026)"
input: {"action":"GET W/debts/summary y la consulta del disponible para gastar (Q5) del workspace demo"}
steps:
  - "Consultar el resumen de deudas"
  - "Consultar el disponible para gastar con su desglose por moneda"
expected_result:
  - "Total adeudado en USD 1207.15 USD (1007.15 Crédito educativo + 200.00 Tarjeta Kantuta Demo), consolidado en 8450.05 BOB; consolidado completo"
  - "Lista Préstamo vehicular 25288.74 BOB, Préstamo de consumo 8000.00 BOB y Tarjeta Kantuta Demo 4770.50 BOB; no lista Préstamo familiar; el total en BOB coincide con el resumen de referencia v2"
  - "Interés pagado en 2026: 2596.98 BOB y 536.67 USD, con 2166.91 BOB atribuidos a Préstamo vehicular y 420.00 BOB a Préstamo de consumo"
  - "Fecha estimada libre de deudas 2028-02-01"
  - "Q5: comprometido 2349.00 BOB (1080.00 + 1070.00 + 199.00) y 0.00 USD; reservado para metas 26500.00 BOB (18000.00 + 8000.00 + 500.00) y 550.00 USD; aportes planificados pendientes 100.00 USD; el disponible consolidado coincide con el resumen de referencia v2"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-019 — Con la demo, el resumen de deudas y el disponible para gastar muestran cifras no triviales en BOB y USD

## Intención

El resumen de deudas (FR-DEBT-018) y Q5 son los que más se apoyan en las capabilities de Phases 3 y 4; con la demo deben mostrar mora, cuotas, reservas y aportes planificados en dos monedas, derivados solo de los datos cargados.

## Escenario

```gherkin
Dado el workspace demo v2 cargado con la ancla 2026-09-30 y la tasa USD/BOB 7.00
Cuando consulto el resumen de deudas y el disponible para gastar el 2026-09-30
Entonces el total adeudado en USD es 1207.15 USD, consolidado en 8450.05 BOB
  Y la fecha libre de deudas es 2028-02-01
  Y el comprometido del disponible es 2349.00 BOB
  Y lo reservado para metas es 26500.00 BOB y 550.00 USD, con 100.00 USD de aportes planificados
```

## Notas

- Cálculo a mano: 1007.15 + 200.00 = 1207.15; 1207.15 × 7.00 = 8450.05. Interés BOB: 2166.91 (cuotas 11–19 del vehicular) + 420.00 (120.00 + 110.00 + 100.00 + 90.00) + 10.07 (6.70 + 3.37 del familiar). Interés USD: 120.00 + 110.54 + 100.98 + 61.33 + 51.28 + 41.13 + 30.88 + 20.53 = 536.67.
- La cifra de "Tarjeta Andina Demo" y los saldos líquidos dependen del generador sembrado de v1: se comparan con el resumen de referencia, no a mano.
- El scenario "Disponible para gastar de la demo" del mismo requirement se verifica en este TC (último resultado esperado).
- Change: `add-phase-4-demo-data`.
