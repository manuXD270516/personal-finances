---
id: TC-COMMITMENTS-MATCH-003
title: 'Montos fuera de la tolerancia del tipo no se sugieren y los estimados dentro sí'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Criterios de compatibilidad y tolerancias'
scenario: 'Monto fuera de tolerancia'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: ['INV-001']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'tolerance']
error_code: null
preconditions:
  - 'Internet FIXED 199.00 BOB (±2 % = 3.98 BOB)'
  - 'Luz ESTIMATED 150.00 BOB vence 2026-10-25 (±25 %)'
input:
  a: 'gasto 205.00 BOB para el Internet'
  b: 'gasto 163.40 BOB el 2026-10-27 para la Luz'
  c: 'gasto 202.98 BOB (borde) para el Internet'
steps:
  - 'Evaluar cada caso'
expected_result:
  - 'a: sin sugerencia'
  - 'b: sugerencia con amountDelta 13.40 BOB y dateDeltaDays 2'
  - 'c: sugerencia (Δ = 3.98, en el borde inclusive)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-003 — Montos fuera de la tolerancia del tipo no se sugieren y los estimados dentro sí

## Intención

Tolerancias por tipo de monto (design decisión 2).

## Escenario

```gherkin
Dado el "Internet" FIXED de 199.00 BOB
Cuando se registra un gasto de 205.00 BOB
Entonces no se sugiere la coincidencia
```

## Notas

- Cubre el scenario "Luz estimada dentro de tolerancia". Depende de la pregunta abierta 1.
