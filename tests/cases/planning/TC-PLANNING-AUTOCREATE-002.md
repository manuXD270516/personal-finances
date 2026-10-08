---
id: TC-PLANNING-AUTOCREATE-002
title: Dos creaciones automáticas concurrentes no duplican periodos
spec: planning/financial-periods
related_specs: []
requirement: Creación automática e idempotente con anticipación
scenario: Creación repetida
requirement_status: confirmed
fr:
  - FR-PLANNING-002
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
  - concurrency
error_code: null
preconditions:
  - PostgreSQL real (Testcontainers) con rol pf_app
  - Workspace sin periodos, hoy 2026-10-05
input:
  concurrentRuns: 2
  today: 2026-10-05
steps:
  - Lanzar dos ejecuciones de la creación automática en conexiones distintas al mismo tiempo
expected_result:
  - Existen exactamente cuatro periodos ("2026-10" a "2027-01")
  - Ninguna ejecución falla con error no controlado
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-AUTOCREATE-002 — Dos creaciones automáticas concurrentes no duplican periodos

## Intención

El job, los consumidores y el comando pueden coincidir; el candado por workspace y los uniques evitan duplicados.

## Escenario

```gherkin
Dado un workspace sin periodos
Cuando dos procesos crean periodos al mismo tiempo
Entonces existen exactamente los cuatro periodos esperados
```

## Notas

- Verifica el candado consultivo por workspace y ON CONFLICT DO NOTHING (design.md decisión 5).
