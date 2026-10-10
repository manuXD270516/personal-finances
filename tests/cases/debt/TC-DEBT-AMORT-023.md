---
id: TC-DEBT-AMORT-023
title: 'PBT: alemán y capital fijo suman el principal y respetan su forma'
spec: debt/amortization
related_specs: []
requirement: 'Sistema alemán de capital constante'
scenario: null
requirement_status: provisional
fr: ['FR-DEBT-004', 'FR-DEBT-006']
nfr: []
invariants: ['INV-017']
priority: high
type: property
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'pbt']
error_code: null
preconditions:
  - 'Generadores de principal, tasa (0 % a 100 %), plazo (1 a 600) y principal fijo válidos'
input: {}
steps:
  - 'Se calcula el cronograma alemán y el de capital fijo para cada caso generado'
expected_result:
  - 'La suma del principal es exactamente el principal'
  - 'Ningún componente es negativo y cada total es la suma de sus componentes'
  - 'La cuota alemana no crece con tasa constante y 30/360 regular'
  - 'El principal de las cuotas 1 a n−1 del capital fijo es el principal fijo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-023 — PBT: alemán y capital fijo suman el principal y respetan su forma

## Intención

RISK-001 para los sistemas nuevos: Σ principal = P, cuota alemana no creciente a tasa constante y principal fijo en las cuotas 1..n−1.

## Escenario

```gherkin
Dado generadores de principal, tasa (0 % a 100 %), plazo (1 a 600) y principal fijo válidos
Cuando se calcula el cronograma alemán y el de capital fijo para cada caso generado
Entonces la suma del principal es exactamente el principal
  Y ningún componente es negativo y cada total es la suma de sus componentes
  Y la cuota alemana no crece con tasa constante y 30/360 regular
  Y el principal de las cuotas 1 a n−1 del capital fijo es el principal fijo
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
- Cubre también el requirement "Sistema de capital fijo con cuota final balloon".
