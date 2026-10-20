---
id: TC-PLATFORM-PIPELINE-013
title: "La cobertura del núcleo compartido bajo 95 % de líneas o 90 % de ramas hace fallar el job mutation del nightly"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Cobertura del núcleo compartido sin rebajar umbrales"
scenario: "Un módulo sin tests propios baja la cobertura"
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
tags: ["nightly", "coverage", "shared-kernel"]
error_code: null
preconditions:
  - "Workflow nightly con el job mutation y su paso de cobertura"
input:
  measured: {"lines":"89.86 %","branches":"84.07 %"}
  thresholds: {"lines":"95 %","branches":"90 %"}
steps:
  - "Test de política: leer nightly.yml y verificar que el paso de cobertura ejecuta test:coverage de @pf/shared-kernel sin continue-on-error ni condición que lo vuelva no bloqueante"
  - "Verificación en GitHub: corrida por workflow_dispatch tras el change con la cobertura recuperada"
expected_result:
  - "El paso de cobertura es bloqueante para el job mutation"
  - "Con 89.86 % / 84.07 % el job falla y el resumen publica ambas métricas"
  - "Con los tests nuevos el paso pasa (≥ 96 % / ≥ 91 % como meta)"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-013 — La cobertura del núcleo compartido bajo 95 % de líneas o 90 % de ramas hace fallar el job mutation del nightly

## Intención

La cobertura del shared-kernel cayó en silencio a 89.86 % / 84.07 % porque los módulos nuevos se probaban desde otros paquetes. El paso debe seguir bloqueante y la corrección es agregar tests, no relajar el paso.

## Escenario

```gherkin
Dado el núcleo compartido con un módulo sin tests propios
Cuando la cobertura queda en 89.86 % de líneas y 84.07 % de ramas
Entonces el paso de cobertura del nightly falla frente a 95 % y 90 %
  Y el resumen publica las métricas
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- Automatizado (2026-10-20): `scripts/delivery-policy/test/nightly-policy.test.ts` (paso de cobertura sin `continue-on-error` ni `if`, antes de Stryker). Cobertura medida del shared-kernel tras los tests nuevos: 99.86 % líneas y 94.69 % ramas (antes 89.86 % / 84.07 %). Verificación en GitHub: corrida de `nightly` por `workflow_dispatch` (tarea 7.3).
