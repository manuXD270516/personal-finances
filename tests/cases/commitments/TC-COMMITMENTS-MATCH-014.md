---
id: TC-COMMITMENTS-MATCH-014
title: 'Propiedad: ninguna secuencia de hechos hace que el matcher resuelva ocurrencias o reviva pares descartados'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'El matching nunca vincula sin confirmación'
scenario: 'Coincidencia exacta no se vincula sola'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/matching.property.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'pbt', 'safety']
error_code: null
preconditions:
  - 'Generadores fast-check de transacciones, ocurrencias y secuencias Created/Updated/Voided con reentregas'
input:
  runs: '100 en PR, 10000 nightly'
steps:
  - 'Aplicar la secuencia al consumidor con dobles en memoria'
expected_result:
  - 'Ninguna ocurrencia cambia de estado por el matcher'
  - 'Ningún par DISMISSED vuelve a PROPOSED'
  - 'A lo sumo una sugerencia por par'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-014 — Propiedad: ninguna secuencia de hechos hace que el matcher resuelva ocurrencias o reviva pares descartados

## Intención

Garantía Must verificada como propiedad.

## Escenario

```gherkin
Dado cualquier secuencia de hechos de transacciones
Cuando el matcher los procesa
Entonces ninguna ocurrencia se resuelve sin confirmación
```

## Notas

