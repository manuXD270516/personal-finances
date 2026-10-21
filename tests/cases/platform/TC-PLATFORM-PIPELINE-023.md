---
id: TC-PLATFORM-PIPELINE-023
title: "Un fallo de cobertura del job mutation del nightly avisa en su propio issue sin comentar el de regresión"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Aviso por issue de los fallos de regresión y de mutación del pipeline programado"
scenario: "Falla la cobertura del núcleo compartido"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-002]
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
tags: ["nightly", "mutation", "coverage", "issues"]
error_code: null
preconditions:
  - "Workflow nightly con el paso de aviso en el job mutation (D284)"
  - "En la misma corrida el job regression pasa"
input:
  measured: {"lines":"94.10 %"}
  thresholds: {"lines":"95 %","branches":"90 %"}
steps:
  - "Test de política: el paso de aviso de mutation corre solo con failure(), usa el título \"nightly mutation: falló\", busca el abierto antes de crear y va después de los pasos de cobertura y Stryker"
  - "Test de política: los títulos de regression, mutation y perf son distintos"
  - "Verificación manual única: corrida por workflow_dispatch con la cobertura forzada bajo el umbral (rama de prueba no fusionada)"
expected_result:
  - "Se abre o se comenta el issue \"nightly mutation: falló\" con el enlace a la corrida y las métricas medidas"
  - "El issue \"nightly regression: falló\" no recibe ningún comentario de esa corrida"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-023 — Un fallo de cobertura del job mutation del nightly avisa en su propio issue sin comentar el de regresión

## Intención

Un issue por job separa las causas: se cierra uno sin tocar los otros (D284).

## Escenario

```gherkin
Dado el nightly con la suite de regresión en verde
Cuando el job mutation falla porque la cobertura del núcleo queda en 94.10 % de líneas
Entonces se abre o se comenta el issue "nightly mutation: falló" con las métricas
  Y el issue de regresión no recibe comentarios de esa corrida
```

## Notas

- Change `fix-nightly-pipeline`, grupo 8 (D284, docs/46).
- El job `mutation` también falla por el mutation score (< 80 %) o por la cobertura del dominio IDENTITY; cualquiera de esos fallos usa el mismo issue.

- 2026-10-21: parte estática automatizada (`nightly-policy.test.ts`). Pendiente de nightly (tarea 8.6b): corrida por `workflow_dispatch` con la cobertura forzada bajo el umbral; anotar aquí el número del issue y que el de regresión no recibe comentario.
