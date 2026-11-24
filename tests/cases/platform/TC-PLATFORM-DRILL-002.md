---
id: TC-PLATFORM-DRILL-002
title: "Un restore que falla en el drill avisa al heartbeat con el motivo y deja el resultado fail"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Drill de restore mensual en el host que avisa si falla"
scenario: "El restore falla"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-005","NFR-OBS-005"]
invariants: []
priority: critical
type: platform
level: unit
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el doble de docker hace fallar el comando restore con salida 1"
input: {"subcommand":"drill","restore_exit":1}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer drills.log y las llamadas al heartbeat"
expected_result:
  - "El script termina con error"
  - "drills.log tiene una línea fail con el motivo (restore)"
  - "Hay una llamada a /pfos-drill/fail y ninguna de éxito"
  - "Se borran el contenedor, el volumen y la red aunque falló"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-002 — Un restore que falla en el drill avisa al heartbeat con el motivo y deja el resultado fail

## Intención

Requirement «Drill de restore mensual en el host que avisa si falla» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un repositorio que no responde
Cuando corre el drill
Entonces registra fail con el motivo y avisa /fail al heartbeat pfos-drill
```

## Notas

- Cubre también el caso de un respaldo que no se puede descifrar: misma salida del restore.
