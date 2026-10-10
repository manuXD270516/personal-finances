---
id: TC-COMMITMENTS-RECUR-001
title: 'Crear un gasto recurrente mensual deja la definición activa en versión 1 con ocurrencias generadas'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Definición recurrente con tipo, cuentas y plantilla'
scenario: 'Alquiler mensual creado'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-001']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'definition']
error_code: null
preconditions:
  - 'Workspace en America/La_Paz, moneda base BOB, hoy 2026-10-09 (FixedClock)'
  - 'Cuenta "Banco BOB" activa en BOB; categoría de gasto "Vivienda" activa'
  - 'Horizonte 90 días'
input:
  definition: 'Alquiler, EXPENSE, Banco BOB, FIXED 3500.00 BOB, Vivienda, MONTHLY interval 1 desde 2026-10-05, PENDING_APPROVAL'
steps:
  - 'El EDITOR crea la definición'
expected_result:
  - 'La definición queda ACTIVE con versión 1 y los datos indicados'
  - 'Existen las ocurrencias 2026-10-05, 2026-11-05, 2026-12-05 y 2027-01-05 en SCHEDULED o DUE según la fecha'
  - 'Hay un registro de auditoría y una transición CREATE en el recorrido'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-001 — Crear un gasto recurrente mensual deja la definición activa en versión 1 con ocurrencias generadas

## Intención

FR-COMMITMENTS-001: la definición recurrente es la unidad del motor; sin ella no hay Q4 ni Q8.

## Escenario

```gherkin
Dado un workspace en America/La_Paz y hoy 2026-10-09
Cuando el EDITOR crea "Alquiler" 3500.00 BOB mensual desde 2026-10-05
Entonces la definición queda activa en versión 1
  Y sus ocurrencias se generan hasta 2027-01-07
```

## Notas

- La generación síncrona en la creación evita esperar al job (design decisión 7).
