---
id: TC-GOALS-SAVINGS-036
title: "Una meta en USD con fondos en BOB y USD convierte con la tasa vigente informada y nunca a 1:1"
spec: goals/savings-goals
related_specs: []
requirement: "Meta en una moneda distinta a la de sus fondos"
scenario: "Viaje en USD con fondos en BOB y USD"
requirement_status: provisional
fr: ["FR-GOALS-007", "FR-FX-006"]
nfr: []
invariants: ["INV-001"]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "fx", "multi-currency"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Meta \"Viaje a Cusco\" de 2000.00 USD con 300.00 USD reales en \"Caja USD\" y 7500.00 BOB reservados en \"Banco BOB\""
  - "Tasa PARALLEL USD/BOB 12.50 de paralelo.bo vigente"
input: {}
steps:
  - "GET la meta"
  - "Repetir sin tasas dentro de la ventana de vigencia"
  - "Calcular el ritmo de \"2026-09\" con una reserva de 1250.00 BOB del 2026-09-10 a tasa 12.50"
expected_result:
  - "progress.total 900.00 USD, percent \"45.00\", ratesUsed con 12.50, fecha y \"Fuente: paralelo.bo\""
  - "Sin tasa: total 300.00 USD, complete = false, unconverted [7500.00 BOB]"
  - "Neto de \"2026-09\" para el ritmo: 100.00 USD"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-036 — Una meta en USD con fondos en BOB y USD convierte con la tasa vigente informada y nunca a 1:1

## Intención

RISK-017: stock con la tasa de hoy y flujos con la de su fecha; nunca 1:1.

## Escenario

```gherkin
Dada "Viaje a Cusco" con 300.00 USD y 7500.00 BOB y la tasa USD/BOB 12.50
Cuando consulto la meta
Entonces acumula 900.00 USD (45.00 %) con la tasa y su fuente
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
