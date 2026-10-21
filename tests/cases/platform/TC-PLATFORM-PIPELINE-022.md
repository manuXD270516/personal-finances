---
id: TC-PLATFORM-PIPELINE-022
title: "Un fallo del job regression del nightly abre o comenta un único issue con los grupos en rojo, con el permiso solo en los jobs que avisan"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Aviso por issue de los fallos de regresión y de mutación del pipeline programado"
scenario: "Falla la suite de regresión sin aviso abierto"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-005]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: automated
automated_tests:
  - scripts/delivery-policy/test/nightly-policy.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "regression", "issues"]
error_code: null
preconditions:
  - "Workflow nightly con el paso de aviso en el job regression (D284)"
  - "Sin issue abierto titulado \"nightly regression: falló\" al empezar"
input:
  - run: "corrida 1 con el grupo packages/contexts/planning (integration) en rojo"
    expected: "se crea el issue \"nightly regression: falló\" con el enlace y el resumen de la suite"
  - run: "corrida 2, otra vez en rojo, con el issue abierto"
    expected: "se agrega un comentario al mismo issue; no se crea otro"
steps:
  - "Test de política: issues: write solo en regression, mutation, perf y fx-smoke-live; nunca a nivel de workflow"
  - "Test de política: el paso de aviso de regression corre solo con failure(), usa el título exacto, busca el abierto antes de crear y va después de traceability:regression"
  - "Verificación manual única: dos corridas por workflow_dispatch con un fallo forzado (rama de prueba no fusionada)"
expected_result:
  - "La primera corrida fallida crea un único issue con el título fijo, el enlace a la corrida y el paquete y los archivos de los grupos en rojo"
  - "La segunda corrida fallida comenta el mismo issue; sigue habiendo un solo issue abierto con ese título"
  - "El permiso issues: write no se concede a nivel de workflow"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-022 — Un fallo del job regression del nightly abre o comenta un único issue con los grupos en rojo, con el permiso solo en los jobs que avisan

## Intención

`regression` estuvo en rojo 12 noches sin aviso. D284 aplica el patrón de D270 a este job, con su propio issue.

## Escenario

```gherkin
Dado el nightly sin issue abierto "nightly regression: falló"
Cuando el job regression falla con el grupo de integración de Planning en rojo
Entonces se abre ese issue con el enlace y los grupos en rojo
  Y la corrida fallida siguiente comenta el mismo issue
```

## Notas

- Change `fix-nightly-pipeline`, grupo 8 (D284, docs/46). Cubre también el scenario "Permisos de los jobs que avisan".
- Cambia dos aserciones del test de TC-PLATFORM-PIPELINE-009 (tarea 8.4; motivo registrado en el design, decisión 8).

- 2026-10-21: parte estática automatizada (`nightly-policy.test.ts`; `nightly.yml` con `issues: write` en `regression`, `mutation`, `perf` y `fx-smoke-live`, `actionlint` limpio). Pendiente de nightly (tarea 8.6b): dos corridas por `workflow_dispatch` desde una rama de prueba con un fallo forzado; anotar aquí el número del issue.
