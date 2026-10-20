---
id: TC-PLATFORM-PIPELINE-012
title: "El comando de cada grupo de la suite nombra sus archivos y no incluye ningún filtro por nombre de test"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Financial Regression Suite con el contexto de ejecución del gate"
scenario: "El comando de un grupo no filtra por nombre"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-005]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/traceability/test/regression.test.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "regression-suite", "traceability"]
error_code: null
preconditions:
  - "Grupos unit e integration de la suite con sus archivos"
input:
  groups: ["unit: test/regression.test.ts","integration: test/integration/pg-planning.int.test.ts"]
steps:
  - "Armar el comando de un grupo unit y de un grupo integration"
expected_result:
  - "El comando contiene run, la config de integración solo para integration y los archivos del grupo"
  - "El comando no contiene -t, --testNamePattern ni ningún patrón de nombre"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-012 — El comando de cada grupo de la suite nombra sus archivos y no incluye ningún filtro por nombre de test

## Intención

Guarda estática contra la reintroducción del filtro por nombre.

## Escenario

```gherkin
Dado un grupo de la suite
Cuando el ejecutor arma su comando
Entonces nombra los archivos del grupo
  Y no incluye ningún patrón de filtro por nombre
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- Automatizado (2026-10-20): `regression.test.ts` verifica el comando de un grupo unit y de uno integration (sin `-t`, `--testNamePattern` ni TC-ID; `testNamePattern` se eliminó de `regression.ts`).
