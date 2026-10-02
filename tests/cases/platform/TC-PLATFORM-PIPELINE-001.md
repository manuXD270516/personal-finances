---
id: TC-PLATFORM-PIPELINE-001
title: "El CI falla cuando falla la validación de OpenSpec"
spec: platform/delivery-pipeline
related_specs: ["quality/test-traceability"]
requirement: "Control de validación de especificaciones"
scenario: null
requirement_status: provisional
fr: []
nfr: [NFR-MAINT-001]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 0
tags: ["ci", "openspec"]
error_code: null
preconditions:
  - "Workflow de GitHub Actions para pull requests con un paso openspec validate --strict"
input:
  - change: "Requirement sin ningún Scenario"
    expected: "fail"
  - change: "Texto de Requirement sin SHALL/MUST"
    expected: "fail"
  - change: "Cambio válido"
    expected: "pass"
steps: ["Abrir un PR con cada cambio"]
expected_result:
  - "Cambios inválidos: el job de OpenSpec falla y bloquea el merge"
  - "Cambio válido: el job pasa"
created: 2026-10-01
updated: 2026-10-01
---

# TC-PLATFORM-PIPELINE-001 — El CI falla cuando falla la validación de OpenSpec

## Intención

Las especificaciones son la fuente de verdad del comportamiento; las especificaciones inválidas nunca deben llegar a main (SPIKE-01).

## Escenario

```gherkin
Dado un pull request con un requisito que no tiene escenario
Cuando se ejecuta el pipeline de CI
Entonces el job de validación de OpenSpec falla
  Y el pull request no puede fusionarse
```

## Notas

- Se ejecuta una vez manualmente en SPIKE-01 (ramas fixture); luego queda protegido por la protección de ramas.
