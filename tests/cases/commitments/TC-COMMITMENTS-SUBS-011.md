---
id: TC-COMMITMENTS-SUBS-011
title: 'Pausar y reanudar no genera cargos de las fechas transcurridas durante la pausa'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Pausar y reanudar una suscripción'
scenario: 'Pausa de dos meses'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-009']
nfr: []
invariants: ['INV-013']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'pause']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"MusicBox" 9.99 USD el día 5 de cada mes, ACTIVE'
input:
  pausedOn: '2026-11-01'
  resumedOn: '2027-01-10'
steps:
  - 'Pausar el 2026-11-01'
  - 'Ejecutar la generación del motor'
  - 'Reanudar el 2027-01-10'
expected_result:
  - 'No hay ocurrencias pendientes 2026-11-05, 2026-12-05 ni 2027-01-05 (las generadas quedan CANCELLED por pausa)'
  - 'Próxima renovación 2027-02-05'
  - 'Estado ACTIVE tras reanudar'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-011 — Pausar y reanudar no genera cargos de las fechas transcurridas durante la pausa

## Intención

Una suscripción pausada no compromete dinero (Q4) ni aparece en próximos pagos (Q8).

## Escenario

```gherkin
Dado "MusicBox" pausada el 2026-11-01
Cuando la reanudo el 2027-01-10
Entonces no hay cargos de noviembre a enero
  Y la próxima renovación es 2027-02-05
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
