---
id: TC-PLANNING-THRESHOLD-002
title: 'Los umbrales personalizados se aceptan y los inválidos se rechazan'
spec: planning/budgets
related_specs: []
requirement: 'Umbrales de alerta por línea'
scenario: 'Umbral fuera de rango rechazado'
requirement_status: provisional
fr: ['FR-PLANNING-022']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'thresholds', 'validation']
error_code: BUDGET_THRESHOLD_INVALID
preconditions:
  - '"Restaurantes" con umbrales por defecto'
input:
  valid: ['80', '110']
  invalid: ['0', '1001', '80 y 80', '11 umbrales', '75.555']
steps:
  - 'Configurar 80 y 110 %'
  - 'Configurar cada lista inválida'
expected_result:
  - 'La línea queda con exactamente 80 y 110 %'
  - 'Cada lista inválida se rechaza con BUDGET_THRESHOLD_INVALID y los umbrales no cambian'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-THRESHOLD-002 — Los umbrales personalizados se aceptan y los inválidos se rechazan

## Intención

FR-PLANNING-022: umbrales personalizados válidos (0 < t ≤ 1000, ≤ 2 decimales, sin repetidos, ≤ 10).

## Escenario

```gherkin
Cuando configuro los umbrales 80 y 110 %
Entonces la línea tiene exactamente 80 y 110 %
Cuando configuro 0 % o 1001 %
Entonces se rechaza con BUDGET_THRESHOLD_INVALID
```

## Notas

- Cubre también el scenario "Umbrales personalizados".
