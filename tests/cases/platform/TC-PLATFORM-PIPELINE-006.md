---
id: TC-PLATFORM-PIPELINE-006
title: "Una versión mayor llega en su propia PR sin auto-merge y ninguna PR de actualización se fusiona con checks en rojo o pendientes"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Sin fusión automática de versiones mayores ni con checks en rojo"
scenario: "Versión mayor en su propia pull request"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-013, NFR-MAINT-012]
invariants: []
priority: critical
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["ci", "dependencies", "renovate", "automerge"]
error_code: null
preconditions:
  - "Configuración del servicio de actualización versionada en la raíz del repositorio"
  - "Auto-merge nativo de GitHub activo; main exige los 17 checks con strict y enforce_admins"
input:
  - update: "TypeScript 6.0.3 -> 7.0.0 (catálogo)"
    expected: "PR propia, fuera del grupo semanal, sin auto-merge aunque todos los checks pasen"
  - update: "versión menor con el check integration en rojo"
    expected: "no se fusiona; queda abierta"
  - update: "parche con automerge permitido y un check pendiente"
    expected: "no se fusiona hasta que los 17 checks estén en verde con la rama al día"
steps:
  - "Test de política: ninguna regla con automerge activo aplica a actualizaciones major; platformAutomerge activo; ninguna opción que salte checks o protección"
  - "Primera ventana con una major disponible: comprobar que la PR no tiene auto-merge"
expected_result:
  - "Las majors se abren separadas y sin auto-merge"
  - "La fusión automática permitida se delega en el auto-merge nativo, que espera los checks requeridos"
  - "Ninguna PR del bot se fusiona en rojo o con checks pendientes"
created: 2026-10-13
updated: 2026-10-13
---

# TC-PLATFORM-PIPELINE-006 — Una versión mayor llega en su propia PR sin auto-merge y ninguna PR de actualización se fusiona con checks en rojo o pendientes

## Intención

D224 prohíbe el automerge de majors, y CLAUDE.md prohíbe fusionar con checks en rojo o pendientes. Una major puede traer cambios de comportamiento que los tests no cubren; un bot que fusione solo romperería `main` o metería una dependencia comprometida (RISK-024).

## Escenario

```gherkin
Dada una versión mayor nueva del compilador de TypeScript del catálogo
Cuando el servicio de actualización la detecta
Entonces abre una PR propia fuera del grupo semanal
  Y la PR no tiene el auto-merge activado aunque todos sus checks pasen
```

## Notas

- Qué clases sí se fusionan solas depende de la pregunta 4 de design.md; este caso cubre lo que no cambia con la respuesta.
