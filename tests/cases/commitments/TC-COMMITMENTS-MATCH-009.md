---
id: TC-COMMITMENTS-MATCH-009
title: 'Con dos ocurrencias candidatas la más cercana va primero y el empate se marca ambiguo'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Ranking de candidatas'
scenario: 'Dos internet en la misma cuenta'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'ranking']
error_code: null
preconditions:
  - 'Internet casa 199.00 BOB vence 2026-10-20; Internet oficina 199.00 BOB vence 2026-10-22; ambas en Banco BOB sin contraparte'
input:
  a: 'gasto 199.00 BOB el 2026-10-20'
  b: 'gasto 199.00 BOB el 2026-10-21'
steps:
  - 'OccurrenceMatcher.candidates para cada gasto'
expected_result:
  - 'a: casa 90.00, oficina 80.00, sin ambigüedad'
  - 'b: ambas 85.00, ambiguous true'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-009 — Con dos ocurrencias candidatas la más cercana va primero y el empate se marca ambiguo

## Intención

Ranking explicable (design decisión 3).

## Escenario

```gherkin
Dado "Internet casa" del 2026-10-20 e "Internet oficina" del 2026-10-22
Cuando se registra un gasto de 199.00 BOB el 2026-10-20
Entonces la primera sugerencia es "Internet casa"
```

## Notas

- Cubre el scenario "Empate marcado como ambiguo".
