---
id: TC-PLATFORM-PIPELINE-003
title: La promoción de staging a producción despliega el mismo digest de imagen sin reconstruir
spec: platform/delivery-pipeline
related_specs: []
requirement: Construir una vez, promover por digest
scenario: Staging y producción ejecutan el mismo artefacto
requirement_status: confirmed
fr: []
nfr:
- NFR-PORT-006
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- ci
- cd
- build-once
error_code: null
preconditions:
- Workflow de build que etiqueta la imagen con el SHA del commit
- Workflow de promoción que despliega por digest
input:
  commit: SHA fijo de un commit de prueba
  environments:
  - staging
  - production
steps:
- Construir y publicar la imagen del commit
- Desplegar en staging y ejecutar los smoke tests
- Promover el commit a producción
- Comparar digests y revisar los jobs ejecutados en la promoción
expected_result:
- La imagen se etiqueta con el SHA del commit y se construye una sola vez
- El despliegue de producción referencia el mismo digest que pasó los smoke tests de staging
- El workflow de promoción no contiene ni ejecuta pasos de build de imagen
- Las diferencias entre entornos provienen solo de configuración y secretos
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-PIPELINE-003 — La promoción de staging a producción despliega el mismo digest de imagen sin reconstruir

## Intención

Build once garantiza que lo probado en staging es exactamente lo que corre en producción (NFR-PORT-006).

## Escenario

```gherkin
Dado un commit cuya imagen pasó los smoke tests de staging
Cuando se promueve a producción
Entonces el despliegue de producción referencia el mismo digest de imagen
  Y no ocurre ninguna reconstrucción durante la promoción
```

## Notas

- Hasta aceptar el ADR de cloud, se verifica sobre los manifiestos de despliegue generados (dry-run).
