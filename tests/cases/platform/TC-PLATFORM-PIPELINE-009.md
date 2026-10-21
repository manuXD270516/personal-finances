---
id: TC-PLATFORM-PIPELINE-009
title: "Un fallo del nightly de rendimiento abre o comenta un único issue de aviso, con el permiso de issues solo en el job perf"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Nightly de rendimiento con el Large Seed"
scenario: "Fallo del nightly de rendimiento abre o comenta un aviso"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-002]
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
tags: ["nightly", "perf", "ci", "issues"]
error_code: null
preconditions:
  - "Workflow nightly con el job perf (Large Seed + NFR-PERF) y el paso de aviso por issue"
  - "Sin issue abierto titulado \"nightly perf: umbral superado\" al empezar"
input:
  - run: "corrida 1 del job perf con p95 de NFR-PERF-002 = 450 ms (umbral 400 ms)"
    expected: "se crea el issue \"nightly perf: umbral superado\" con el enlace a la corrida y el resumen"
  - run: "corrida 2 del job perf, otra vez en rojo, con el issue abierto"
    expected: "se agrega un comentario al mismo issue; no se crea otro"
steps:
  - "Test de política: leer nightly.yml y verificar que issues: write está declarado solo en los jobs que avisan (regression, mutation, perf y fx-smoke-live), nunca a nivel de workflow"
  - "Test de política: verificar que el paso de aviso del job perf corre solo con failure(), usa el título exacto y busca el issue abierto antes de crear uno"
  - "Verificación manual única: corrida por workflow_dispatch con un umbral forzado (cambio no fusionado) dos veces seguidas"
expected_result:
  - "La primera corrida fallida crea un único issue con el título fijo, el enlace a la corrida y el resumen del reporte con el benchmark y el valor medido"
  - "La segunda corrida fallida comenta el mismo issue; sigue habiendo un solo issue abierto con ese título"
  - "El permiso issues: write no se concede a nivel de workflow; ningún otro job lo tiene"
  - "El fallo no bloquea pull requests: el job perf no es check requerido"
created: 2026-10-16
updated: 2026-10-16
---

# TC-PLATFORM-PIPELINE-009 — Un fallo del nightly de rendimiento abre o comenta un único issue de aviso, con el permiso de issues solo en el job perf

## Intención

El owner adoptó el 2026-10-16 la opción (a) de la pregunta 10 del change `add-dependency-updates` (docs/43, D270): cuando falla el job `perf` del nightly, se abre o comenta el issue "nightly perf: umbral superado", como ya hace `fx-smoke-live`. Sin aviso, un rojo del nightly (que no es check requerido) pasa desapercibido. El permiso de escritura de issues se limita al job que lo necesita.

## Escenario

```gherkin
Dado que no hay un issue abierto titulado "nightly perf: umbral superado"
Cuando el job perf falla porque el p95 de la búsqueda de texto es 450 ms frente a 400 ms
Entonces se abre ese issue con el enlace a la corrida y el resumen del reporte
  Y si la corrida siguiente vuelve a fallar, se comenta el mismo issue sin abrir otro
  Y el permiso de escritura de issues está en el job perf y no a nivel de workflow
```

## Notas

- La parte estática (permisos y paso de aviso) la cubre un test de política ejecutado por `pnpm test`; la creación y el comentario reales se verifican una vez por `workflow_dispatch` (tarea 4.3) y se anotan aquí.
- No toca la protección de `main` ni los checks requeridos (D224).

- 2026-10-16: la parte estática está automatizada (`scripts/delivery-policy/test/nightly-policy.test.ts`). Pendiente (tarea 4.3): una verificación manual por `workflow_dispatch` con un umbral forzado, dos veces seguidas, y anotar aquí el número del issue.

- 2026-10-21 (D284, `fix-nightly-pipeline` 8.4): `regression` y `mutation` avisan ahora por issue (TC-PLATFORM-PIPELINE-022 y 023), así que se cambiaron dos aserciones de `nightly-policy.test.ts`: la que exigía que solo `perf` y `fx-smoke-live` tuvieran `issues: write` y la que exigía que `regression` y `mutation` no tuvieran permisos. La regla sigue rechazando el permiso a nivel de workflow y en cualquier otro job.
