---
id: TC-PLANNING-AUTOCREATE-001
title: La creación automática asegura el periodo actual y los siguientes de forma idempotente
spec: planning/financial-periods
related_specs: []
requirement: Creación automática e idempotente con anticipación
scenario: Primera creación en un workspace nuevo
requirement_status: confirmed
fr:
  - FR-PLANNING-002
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
  - idempotency
error_code: null
preconditions:
  - Hoy es 2026-10-05 en America/La_Paz (reloj fijo)
  - Workspace con día de inicio 1, sin asientos ni periodos
  - PLANNING_PERIOD_LOOKAHEAD = 3
input:
  today: 2026-10-05
  timeZone: America/La_Paz
  startDay: 1
steps:
  - Ejecutar la creación automática
  - Ejecutarla otra vez el mismo día
  - Avanzar el reloj a 2026-11-02 y ejecutarla de nuevo
expected_result:
  - 'Tras la primera ejecución: "2026-10" active y "2026-11", "2026-12", "2027-01" draft'
  - La segunda ejecución no crea ni modifica periodos (mismos ids y versiones)
  - El 2026-11-02 se crea "2027-02" en draft y solo cambia "2026-11" (activación)
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-AUTOCREATE-001 — La creación automática asegura el periodo actual y los siguientes de forma idempotente

## Intención

FR-PLANNING-002 exige periodos con anticipación sin duplicados; los planes de presupuesto (pf-p2b) se cuelgan de periodos futuros.

## Escenario

```gherkin
Dado un workspace nuevo con día de inicio 1 y hoy 2026-10-05 en La Paz
Cuando se ejecuta la creación automática dos veces
Entonces existen "2026-10" active y "2026-11", "2026-12", "2027-01" draft
  Y no hay periodos duplicados
```

## Notas

- Cubre también el scenario "Creación repetida" (secuencial) y "Avance del calendario".
