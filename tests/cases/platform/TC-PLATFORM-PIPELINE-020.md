---
id: TC-PLATFORM-PIPELINE-020
title: "Una pull request que baja la cobertura del núcleo compartido bajo 95/90 deja en rojo el job unit del gate"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Cobertura del núcleo compartido también en el gate de pull request"
scenario: "Una pull request baja la cobertura del núcleo compartido"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-002, NFR-MAINT-001]
invariants: []
priority: high
type: platform
level: smoke
automation_status: automated
automated_tests:
  - scripts/delivery-policy/test/pr-policy.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["pr-gate", "coverage", "shared-kernel"]
error_code: null
preconditions:
  - "Workflow pr.yml con el paso de cobertura del shared-kernel dentro del job unit (D283)"
  - "Umbrales de packages/shared-kernel/vitest.config.ts en 95 % de líneas y 90 % de ramas"
input:
  measured: {"lines":"94.20 %","branches":"91.00 %"}
  thresholds: {"lines":"95 %","branches":"90 %"}
steps:
  - "Test de política: leer pr.yml y verificar que el job unit ejecuta pnpm --filter @pf/shared-kernel run test:coverage después de pnpm test"
  - "Verificación manual única: PR de prueba no fusionada que agrega al shared-kernel un módulo sin tests"
expected_result:
  - "El job unit falla e indica las líneas medidas (94.20 %) frente al umbral de 95 %"
  - "La pull request no puede fusionarse mientras el check unit siga en rojo"
  - "No aparece ningún check nuevo en la pull request"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-020 — Una pull request que baja la cobertura del núcleo compartido bajo 95/90 deja en rojo el job unit del gate

## Intención

La cobertura del shared-kernel cayó a 89.86 % / 84.07 % sin que ningún PR lo notara porque solo se medía en el nightly. Con D283 la caída se ve en la PR que la provoca, dentro del check requerido `unit`.

## Escenario

```gherkin
Dada una pull request que agrega al núcleo compartido un módulo sin tests propios
Cuando la cobertura del núcleo queda en 94.20 % de líneas y 91.00 % de ramas
Entonces el job unit del gate falla indicando las líneas frente a 95 %
  Y la pull request no puede fusionarse mientras siga en rojo
```

## Notas

- Change `fix-nightly-pipeline`, grupo 8 (D283, docs/46). El owner confirmó de forma explícita que el check requerido `unit` exija la cobertura.
- Solo falla la métrica de líneas en el ejemplo (91.00 % de ramas cumple 90 %): el mensaje debe nombrar la que no cumple.
- La parte automática es el test de política (`scripts/delivery-policy/test/pr-policy.test.ts`, tarea 8.2); el efecto real en GitHub se verifica una vez en la tarea 8.6.

- 2026-10-21: parte estática automatizada (`pr-policy.test.ts`; `pr.yml` con el paso en el job `unit`, `actionlint` limpio). Pendiente de CI (tarea 8.6a): una PR de prueba no fusionada que baje la cobertura del shared-kernel y deje `unit` en rojo con las líneas medidas frente a 95 %; y la duración de `unit` en el CI del PR (línea base 92–115 s en las últimas tres corridas; si pasa de 12 min en tres corridas, preguntar al owner).
