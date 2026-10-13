---
id: TC-PLATFORM-PIPELINE-005
title: "Las actualizaciones de parches y menores llegan en una PR semanal por grupo, con acciones por SHA y sin tocar la protección de main"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Actualización de dependencias agrupada y semanal"
scenario: "Parches y versiones menores de la semana en un solo grupo"
requirement_status: provisional
fr: []
nfr: [NFR-MAINT-012, NFR-SEC-013]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["ci", "dependencies", "renovate"]
error_code: null
preconditions:
  - "Configuración del servicio de actualización versionada en la raíz del repositorio"
  - "Protección de main con los 17 checks requeridos, strict y enforce_admins"
input:
  - update: "parche y versión menor de dos dependencias de desarrollo del workspace, publicadas hace más de 3 días"
    expected: "una sola PR del grupo del workspace dentro de la ventana semanal, con manifiestos y lockfile"
  - update: "versión menor de una acción de CI fijada por SHA"
    expected: "PR del grupo de acciones con SHA completo y comentario con el tag en todos los workflows"
  - update: "parche de la imagen de PostgreSQL"
    expected: "una PR que actualiza tag y digest en compose y en las referencias de Testcontainers"
steps:
  - "Test de política: leer la configuración y verificar ventana semanal con zona America/La_Paz, grupos por ecosistema, pin de acciones por SHA y gestor de imágenes de Testcontainers"
  - "Primera corrida real: revisar las PR abiertas y la protección de main"
expected_result:
  - "La configuración define una ventana semanal y grupos por ecosistema; fuera de la ventana no hay PR"
  - "Las acciones quedan por SHA completo con el tag como comentario; las imágenes por tag y digest"
  - "La protección de main sigue con los mismos checks, strict y enforce_admins; ninguna regla del servicio la toca"
created: 2026-10-13
updated: 2026-10-13
---

# TC-PLATFORM-PIPELINE-005 — Las actualizaciones de parches y menores llegan en una PR semanal por grupo, con acciones por SHA y sin tocar la protección de main

## Intención

NFR-MAINT-012 pide dependencias sin parches pendientes más de 30 días sin saturar a un owner único (D224: agrupación semanal). El fijado por SHA y por digest (docs/23 §14) no debe perderse al actualizar.

## Escenario

```gherkin
Dado que durante la semana se publicaron un parche y una versión menor de dos dependencias de desarrollo
  Y ambas tienen más de 3 días
Cuando llega la ventana semanal
Entonces se abre una sola PR del grupo del workspace con manifiestos y lockfile
  Y fuera de la ventana no se abre ninguna PR por esas versiones
```

## Notas

- La parte automática es un test de política sobre la configuración (`pnpm test`, job `unit`); la primera corrida real se verifica a mano (tareas 3.2 y 3.3).
- Ventana y grupos según las preguntas 2 y 3 de design.md.
