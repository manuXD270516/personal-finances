---
id: TC-PLATFORM-DRILL-007
title: "El drill falla cuando la duración total pasa los 60 minutos aunque la copia sea íntegra"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Duración del drill dentro del objetivo de RTO"
scenario: "Drill lento"
requirement_status: provisional
fr: []
nfr: ["NFR-REL-002"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","rto","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el doble de date avanza 72 min entre el inicio del restore y el fin de las verificaciones"
  - "Pregunta 3 de docs/73 resuelta"
input: {"total_minutes":72}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer drills.log y el heartbeat"
expected_result:
  - "drills.log registra total=4320 y resultado fail por duración"
  - "Hay una llamada a /pfos-drill/fail"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-007 — El drill falla cuando la duración total pasa los 60 minutos aunque la copia sea íntegra

## Intención

Requirement «Duración del drill dentro del objetivo de RTO» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un restore íntegro que tarda 72 min en total
Cuando termina el drill
Entonces registra la duración y avisa un fallo por superar 60 min
```

## Notas

- Provisional hasta la pregunta 3 de docs/73: si el owner elige solo registrar, el resultado pasa a ok con aviso en el log.
