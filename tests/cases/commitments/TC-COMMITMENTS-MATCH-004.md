---
id: TC-COMMITMENTS-MATCH-004
title: 'Contraparte contradictoria excluye la coincidencia y la tolerancia configurada se respeta'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Criterios de compatibilidad y tolerancias'
scenario: 'Contraparte distinta'
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
tags: ['matching', 'counterparty']
error_code: null
preconditions:
  - 'Internet con contraparte Tigo, vence 2026-10-20'
  - 'Compra mayorista VARIABLE con contraparte "Mayorista Sur"'
input:
  a: 'gasto 199.00 BOB contraparte Entel'
  b: 'tolerancia 5 % y ventana 2 días; gastos de 205.00 BOB el 2026-10-23 y el 2026-10-21'
  c: 'gasto 812.30 BOB sin contraparte en la cuenta de la Compra mayorista'
steps:
  - 'Evaluar cada caso'
expected_result:
  - 'a: sin sugerencia'
  - 'b: 2026-10-23 sin sugerencia; 2026-10-21 con sugerencia'
  - 'c: sin sugerencia (VARIABLE exige contraparte igual)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-004 — Contraparte contradictoria excluye la coincidencia y la tolerancia configurada se respeta

## Intención

Filtros de contraparte y tolerancias por definición.

## Escenario

```gherkin
Dado la ocurrencia del "Internet" con contraparte "Tigo"
Cuando se registra un gasto de 199.00 BOB con contraparte "Entel"
Entonces no se sugiere la coincidencia
```

## Notas

- Cubre el scenario "Tolerancia configurada en la definición".
