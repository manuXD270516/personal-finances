---
id: TC-PLATFORM-PIPELINE-021
title: "El test de política rechaza quitar o volver no bloqueante la cobertura del shared-kernel en el job unit sin cambiar el check"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Cobertura del núcleo compartido también en el gate de pull request"
scenario: "Se quita la verificación de cobertura del job de tests unitarios"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-002, NFR-MAINT-001]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["pr-gate", "coverage", "policy"]
error_code: null
preconditions:
  - "Workflow pr.yml real y tres workflows de fixture derivados de él"
input:
  - fixture: "job unit sin el paso de cobertura"
    expected: "falla indicando el job unit y el paso faltante"
  - fixture: "paso de cobertura con continue-on-error: true"
    expected: "falla indicando el job unit y el paso no bloqueante"
  - fixture: "paso de cobertura con if: false"
    expected: "falla indicando el job unit y la condición"
steps:
  - "Evaluar la regla sobre pr.yml real"
  - "Evaluar la regla sobre cada fixture"
expected_result:
  - "Con pr.yml real la regla pasa: el job unit conserva el id unit, su nombre de check y timeout-minutes 15"
  - "El paso de cobertura va después de pnpm test y es un paso del job unit, no un job nuevo"
  - "Cada fixture hace fallar la regla con el job y el paso en el mensaje"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-021 — El test de política rechaza quitar o volver no bloqueante la cobertura del shared-kernel en el job unit sin cambiar el check

## Intención

D283 cambia lo que exige un check requerido, no la lista de checks. El test de política impide que la verificación desaparezca en silencio y que, al agregarla, cambie el nombre, el tiempo máximo o la cantidad de checks.

## Escenario

```gherkin
Dado el workflow del gate de pull request con la cobertura del núcleo dentro del job unit
Cuando una pull request quita ese paso o lo vuelve no bloqueante
Entonces el test de política falla indicando el job y el paso
  Y con el workflow real el job unit conserva su id, su nombre y sus 15 minutos
```

## Notas

- Change `fix-nightly-pipeline`, grupo 8 (D283, docs/46). Cubre también el scenario "La verificación no cambia los checks requeridos".
- Archivo previsto: `scripts/delivery-policy/test/pr-policy.test.ts` (tarea 8.2).
