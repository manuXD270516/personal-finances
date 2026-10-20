---
id: TC-PLATFORM-PIPELINE-014
title: "Rebajar el umbral de cobertura del núcleo compartido hace fallar el test de política en el gate de PR"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Cobertura del núcleo compartido sin rebajar umbrales"
scenario: "Se intenta rebajar el umbral"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-002]
invariants: []
priority: high
type: platform
level: smoke
automation_status: automated
automated_tests:
  - "scripts/delivery-policy/test/nightly-policy.test.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "coverage", "shared-kernel", "policy"]
error_code: null
preconditions:
  - "packages/shared-kernel/vitest.config.ts con thresholds lines 95 y branches 90"
input:
  change: "thresholds.lines de 95 a 89"
steps:
  - "Test de política: leer los umbrales de la config de vitest del shared-kernel y compararlos con 95 y 90"
expected_result:
  - "Con lines 95 y branches 90 (o mayores) la regla pasa"
  - "Con lines 89 la regla falla indicando el umbral modificado"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-014 — Rebajar el umbral de cobertura del núcleo compartido hace fallar el test de política en el gate de PR

## Intención

NFR-MAINT-002: los umbrales solo suben. La regla corre en pnpm test (job unit, ya requerido) sin agregar checks.

## Escenario

```gherkin
Dado el umbral de líneas del núcleo compartido en 95 %
Cuando una pull request lo cambia a 89 %
Entonces el test de política falla en el gate de PR indicando el umbral
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- Automatizado (2026-10-20): `nightly-policy.test.ts` lee los umbrales de `packages/shared-kernel/vitest.config.ts` y falla indicando el umbral rebajado (probado con 89 y 84).
