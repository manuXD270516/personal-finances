---
id: TC-IMPORTS-CSV-029
title: "Un import de 5 000 filas cumple los tiempos de vista previa y persistencia y cada consumidor drena sus eventos en 120 s"
spec: imports/import-pipeline
related_specs: ["platform/event-delivery"]
requirement: "Volumen de eventos de un import grande"
scenario: "Extracto de 5 000 filas"
requirement_status: provisional
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-PERF-007","NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
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
updated: 2026-10-09
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
