---
id: TC-REPORTING-UPCOMING-022
title: La alerta de read model se dispara con consultas lentas sostenidas y no con volumen bajo
spec: reporting/cash-flow-calendar
related_specs: []
requirement: Métricas y alerta para evolucionar a un read model
scenario: Consulta lenta sostenida
requirement_status: confirmed
fr: []
nfr:
- NFR-PERF-004
- NFR-OBS-005
invariants: []
priority: medium
type: platform
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-read-model-alert.test.ts
status: automated
regression_suite: false
phase: 3
tags:
- observability
- read-model
error_code: null
preconditions:
- Métricas de la consulta de próximos pagos exportadas
input:
  metrics: 'p95 0.42 s durante 15 min; luego p95 0.08 s y 1 200 ocurrencias por consulta'
steps:
- Evaluar la regla de alerta con la serie lenta
- Evaluar la regla con la serie de volumen bajo
expected_result:
- Con la serie lenta se dispara UpcomingPaymentsReadModelRecommended con el enlace al diseño
- Con volumen bajo no se dispara
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-022 — La alerta de read model se dispara con consultas lentas sostenidas y no con volumen bajo

## Intención

Decisión del owner (docs/35 D117): lectura directa en Phase 3, con métricas y alerta que indiquen cuándo migrar al read model por eventos.
