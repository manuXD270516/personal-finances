---
id: TC-IDENTITY-EXPORT-012
title: "La ida y vuelta conserva periodos cerrados, snapshots, planes, templates y cruces de umbral"
spec: identity/workspace-portability
related_specs: ["planning/financial-periods", "planning/month-closing", "planning/budgets", "planning/budget-templates", "notifications/alerts"]
requirement: "Datos de Phase 2 en el export"
scenario: "Ida y vuelta de un mes cerrado con presupuesto"
requirement_status: confirmed
fr: [FR-IDENTITY-010, FR-IDENTITY-017, FR-PLANNING-004]
nfr: [NFR-REL-014]
invariants: [INV-015]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["export", "import", "round-trip", "planning"]
error_code: null
preconditions:
  - "Changes 13 a 22 de Phase 2 aplicados (orden de docs/03 §7)"
  - "\"W1\" con \"2026-10\" cerrado (snapshot 1), reabierto con motivo \"Faltó la comisión\" y re-cerrado (snapshot 2)"
  - "Template \"Mensual\" en versión 3, plan de \"2026-11\" creado desde esa versión, línea \"Restaurantes\" MAXIMUM 600.00 BOB con 550.00 BOB gastados (cruce de 90 % registrado)"
  - "Preferencias de notificación del OWNER con email desactivado para umbrales"
input:
  workspace: "W1"
steps:
  - "Exportar \"W1\" e importar el archivo"
  - "Comparar periodos, snapshots, reaperturas, planes, templates, cruces, avisos de cierre pendiente, bloqueos y preferencias"
  - "Registrar en el workspace nuevo un gasto de 30.00 BOB con fecha 2026-10-15"
  - "Registrar en el workspace nuevo un gasto de 10.00 BOB en \"Restaurantes\" con fecha 2026-11-20"
expected_result:
  - "Mismos periodos y estados; snapshots 1 y 2 de \"2026-10\" idénticos (contenido y hash); reapertura 1 con su motivo"
  - "Plan de \"2026-11\" con template \"Mensual\" versión 3 y el cruce de 90 % registrado; templates con sus 3 versiones"
  - "Preferencias del OWNER iguales; sin notificaciones ni entregas importadas"
  - "El gasto del 2026-10-15 se rechaza con PERIOD_CLOSED"
  - "El gasto del 2026-11-20 no emite un nuevo umbral de 90 %"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-012 — La ida y vuelta conserva periodos cerrados, snapshots, planes, templates y cruces de umbral

## Intención

El criterio de salida de Phase 2 (export→import reproduce el workspace) debe cubrir todos los datos que agregan los changes de Phase 2; sin ellos, el workspace importado perdería el cierre (y aceptaría asientos en meses cerrados) o volvería a alertar umbrales ya avisados.

## Escenario

```gherkin
Dado "W1" con octubre cerrado dos veces y un plan de noviembre con el umbral 90 % cruzado
Cuando el OWNER exporta e importa en un workspace nuevo
Entonces el workspace nuevo conserva snapshots, reapertura, plan, template y cruce
  Y un gasto de octubre se rechaza con PERIOD_CLOSED
```

## Notas

- La lista de tablas cubiertas está en design.md de `add-workspace-export` § "Datos de Phase 2 cubiertos".
- Datos ficticios; fechas fijas con `FixedClock`.
