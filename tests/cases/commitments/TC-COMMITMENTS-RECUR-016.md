---
id: TC-COMMITMENTS-RECUR-016
title: 'El worker desliza la ventana hasta hoy más 90 días y no genera para definiciones pausadas'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Horizonte de generación por el worker'
scenario: 'Ventana deslizante diaria'
requirement_status: provisional
fr: ['FR-COMMITMENTS-006']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'worker']
error_code: null
preconditions:
  - 'Internet MONTHLY día 20 generado hasta 2026-12-20 (hoy 2026-10-09)'
  - 'Gimnasio PAUSED'
input:
  today: '2026-11-09'
  horizon: '90'
steps:
  - 'Ejecutar el job con FixedClock en 2026-11-09'
expected_result:
  - 'Se genera la ocurrencia 2027-01-20 del Internet'
  - 'Ninguna fecha posterior a 2027-02-07'
  - 'Ninguna ocurrencia nueva del Gimnasio'
  - 'generated_through avanza a 2027-02-07'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-016 — El worker desliza la ventana hasta hoy más 90 días y no genera para definiciones pausadas

## Intención

FR-COMMITMENTS-006: horizonte configurable con high-water mark.

## Escenario

```gherkin
Dado hoy 2026-11-09 y horizonte 90 días
Cuando el worker se ejecuta
Entonces genera el "Internet" del 2027-01-20
  Y no genera nada para el "Gimnasio" pausado
```

## Notas

- Cubre el scenario "Definición pausada no genera".
