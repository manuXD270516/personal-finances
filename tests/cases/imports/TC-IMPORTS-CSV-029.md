---
id: TC-IMPORTS-CSV-029
title: "Un import de 5 000 filas cumple los tiempos de vista previa y persistencia y cada consumidor drena sus eventos en 120 s"
spec: imports/import-pipeline
related_specs: ["platform/event-delivery"]
requirement: "Volumen de eventos de un import grande"
scenario: "Extracto de 5 000 filas"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-PERF-007","NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - apps/api/test/perf/imports.perf.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import","performance","D112"]
error_code: null
preconditions:
  - "Entorno de referencia local/CI con el worker por defecto (lotes de 10, concurrencia 4)"
  - "Workspace con plan del periodo y umbrales (consumidor planning.budget-thresholds activo)"
input: {"rows":5000}
steps:
  - "Subir y mapear un CSV generado de 5 000 filas nuevas"
  - "Aprobar"
  - "Medir hasta la vista previa, hasta la última transacción creada y el backlog de cada consumidor"
expected_result:
  - "Vista previa ≤ 30 s desde la subida"
  - "5 000 transacciones ≤ 20 s desde la aprobación"
  - "Backlog de cada consumidor (reporting.data-version, planning.budget-thresholds, planning.journal-entry-posted y los de Phase 3) en 0 en ≤ 120 s"
  - "Eventos propios de imports: exactamente 2 (ImportApproved, ImportCompleted)"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-029 — Un import de 5 000 filas cumple los tiempos de vista previa y persistencia y cada consumidor drena sus eventos en 120 s

## Intención

docs/33 D112: los imports multiplican el volumen de eventos; el import no debe degradar la entrega para nadie.

## Escenario

```gherkin
Dado un CSV de 5 000 filas nuevas
Cuando lo importo y apruebo
Entonces la vista previa y la persistencia cumplen sus tiempos
  Y cada consumidor procesa los eventos resultantes en 120 s o menos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- 2026-10-28 (change 48b `fix-imports-perf-connection-budget`, D299): los dos rojos del benchmark nocturno se midieron en 23 corridas por `workflow_dispatch` ([docs/53](../../../docs/53-imports-perf-findings.md)). Conexiones (`timeout exceeded when trying to connect`, E10): no se reprodujo; el defecto era el presupuesto declarado del benchmark (115 conexiones de pools frente a 97 útiles del contenedor) y se corrigió con el pool de la API de la plantilla del host (22), la precondición de presupuesto y el veredicto `conexiones` (TC-PLATFORM-PIPELINE-029 y 030). Drenado marginal (123,5 s frente a 120 s): sin causa medida (1,3–35,8 s en 23 corridas); el reporte publica ahora el drenado por consumidor (TC-PLATFORM-PIPELINE-031 y 032) y queda como pregunta al owner ([docs/54](../../../docs/54-imports-perf-questions.md)). Los umbrales (30 s, 300 s de techo de persistencia y 120 s) no cambiaron.
