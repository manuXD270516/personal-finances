---
id: TC-IMPORTS-PIPELINE-070
title: "El recorrido de una importación deshecha muestra sus transiciones en orden con actor y la anotación del perfil"
spec: audit/lifecycle-timeline
related_specs: ["imports/import-pipeline"]
requirement: "Recorrido de una importación"
scenario: "Recorrido de una importación deshecha"
requirement_status: provisional
fr: ["FR-AUDIT-009", "FR-AUDIT-010", "FR-IMPORTS-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/src/identity/import-job-lifecycle-registry.test.ts
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/audit/src/application/lifecycle-import-job.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.lifecycle.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Recorrido de una importación deshecha\" del delta de add-import-pipeline"
steps:
  - "la EDITOR \"Ana\" crea una importación desde un documento, el sistema la procesa aplicando el perfil \"Cumbre caja de ahorro CSV\" versión 2, \"Ana\" la aprueba, el sistema la persiste y la completa, y luego \"Ana\" la deshace"
expected_result:
  - "el recorrido muestra en orden subida, procesando, en revisión, aprobada, persistiendo, completada, deshaciendo y deshecha, con \"Ana\" o el sistema como actor de cada transición"
  - "muestra la aplicación del perfil versión 2 como anotación"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-070 — El recorrido de una importación deshecha muestra sus transiciones en orden con actor y la anotación del perfil

## Intención

La importación DEBE (MUST) declarar su máquina de estados —subida, procesando, esperando mapeo, en revisión, aprobada, persistiendo, parcialmente fallida, completada, completada con diferencia, completada con errores, deshaciendo, deshecha, deshecha parcialmente, falló la lectura y cancelada— con sus transiciones, y su recorrido DEBE (MUST) mostrar cada transición con actor (el usuario, o el sistema para las etapas del worker y la expiración), instante y motivo si lo hay; la aplicación de un perfil y su versión, la reevaluación de reglas y la aceptación de errores DEBEN (MUST) aparecer como anotaciones.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la EDITOR "Ana" crea una importación desde un documento, el sistema la procesa aplicando el perfil "Cumbre caja de ahorro CSV" versión 2, "Ana" la aprueba, el sistema la persiste y la completa, y luego "Ana" la deshace
Entonces el recorrido muestra en orden subida, procesando, en revisión, aprobada, persistiendo, completada, deshaciendo y deshecha, con "Ana" o el sistema como actor de cada transición
  Y muestra la aplicación del perfil versión 2 como anotación
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
