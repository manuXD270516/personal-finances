---
id: TC-IMPORTS-PIPELINE-071
title: "Aprobar una importación deshecha se rechaza con INVALID_STATUS_TRANSITION sin registrar transición"
spec: audit/lifecycle-timeline
related_specs: ["imports/import-pipeline"]
requirement: "Recorrido de una importación"
scenario: "Transición no declarada de una importación"
requirement_status: provisional
fr: ["FR-AUDIT-009", "FR-AUDIT-010", "FR-IMPORTS-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: INVALID_STATUS_TRANSITION
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Transición no declarada de una importación\" del delta de add-import-pipeline"
steps:
  - "el usuario intenta aprobar una importación deshecha"
expected_result:
  - "se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-071 — Aprobar una importación deshecha se rechaza con INVALID_STATUS_TRANSITION sin registrar transición

## Intención

La importación DEBE (MUST) declarar su máquina de estados —subida, procesando, esperando mapeo, en revisión, aprobada, persistiendo, parcialmente fallida, completada, completada con diferencia, completada con errores, deshaciendo, deshecha, deshecha parcialmente, falló la lectura y cancelada— con sus transiciones, y su recorrido DEBE (MUST) mostrar cada transición con actor (el usuario, o el sistema para las etapas del worker y la expiración), instante y motivo si lo hay; la aplicación de un perfil y su versión, la reevaluación de reglas y la aceptación de errores DEBEN (MUST) aparecer como anotaciones.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el usuario intenta aprobar una importación deshecha
Entonces se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
