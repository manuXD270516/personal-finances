---
id: TC-REPORTING-SPENDABLE-006
title: "El disponible se calcula por moneda y se consolida con la tasa vigente informada, sin convertir a 1:1 lo que no tiene tasa"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Disponible por moneda y consolidado"
scenario: "BOB y USD consolidados"
requirement_status: provisional
fr: ["FR-REPORTING-001", "FR-FX-006", "FR-PLANNING-024"]
nfr: []
invariants: ["INV-001"]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "fx"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "\"Caja USD\" líquida con 50.00 USD y \"Spotify\" 5.99 USD desde \"Caja USD\" en el periodo"
  - "Tasa PARALLEL USD/BOB 12.00 de paralelo.bo vigente"
input: {}
steps:
  - "GET W/reports/spendable"
  - "Repetir sin tasas USD/BOB dentro de la ventana de vigencia"
expected_result:
  - "byCurrency: 5521.00 BOB y 44.01 USD; consolidated.total 6049.12 BOB con la tasa 12.00 y \"Fuente: paralelo.bo\""
  - "Sin tasa: consolidated 5521.00 BOB, complete false, unconverted [44.01 USD]"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-006 — El disponible se calcula por moneda y se consolida con la tasa vigente informada, sin convertir a 1:1 lo que no tiene tasa

## Intención

RISK-017: misma valoración que el Home y nunca 1:1.

## Escenario

```gherkin
Dados 5521.00 BOB y 44.01 USD disponibles y la tasa USD/BOB 12.00
Cuando consulto el disponible
Entonces el consolidado es 6049.12 BOB con la tasa y su fuente
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
