---
id: TC-REPORTING-FORECAST-025
title: "Los esenciales restan lo restante del plan sin contar dos veces lo comprometido de la misma categoría"
spec: reporting/dashboard
related_specs: []
requirement: "Esenciales presupuestados restantes descontados del disponible"
scenario: "Supermercado esencial"
requirement_status: provisional
fr: ["FR-PLANNING-024","FR-REPORTING-002"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["spendable","q5","essentials"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos del disponible de octubre: líquidas 15800.00 BOB, reservado para metas 5000.00 BOB, comprometido 3179.00 BOB (\"Internet\" 199.00 del 2026-10-22, \"Luz\" 180.00 del 2026-10-28, \"Pago Tarjeta X\" 2500.00 del 2026-10-25, pendiente \"Cena\" 300.00), pendiente planificado de \"Fondo de emergencia\" 600.00 BOB, reserva mínima 1500.00 BOB"
  - "Esenciales activados con \"Supermercado\"; plan \"2026-10\": 1200.00 planificados, 750.00 gastados"
input: {}
steps:
  - "Calcular el disponible"
  - "Agregar \"Canasta\" 200.00 BOB del 2026-10-25 de categoría \"Supermercado\" desde \"Banco BOB\""
expected_result:
  - "Esenciales 450.00 BOB; disponible 5071.00 BOB"
  - "Comprometido 3379.00 BOB; esenciales 250.00 BOB; disponible 5071.00 BOB"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-025 — Los esenciales restan lo restante del plan sin contar dos veces lo comprometido de la misma categoría

## Intención

D218 difirió las categorías esenciales; el doble conteo es el riesgo principal.

## Escenario

```gherkin
Dado Esenciales activados con "Supermercado"; plan "2026-10": 1200.00 planificados, 750.00 gastados
Cuando Calcular el disponible
Entonces Esenciales 450.00 BOB; disponible 5071.00 BOB
  Y Comprometido 3379.00 BOB; esenciales 250.00 BOB; disponible 5071.00 BOB
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Esenciales presupuestados restantes descontados del disponible" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
