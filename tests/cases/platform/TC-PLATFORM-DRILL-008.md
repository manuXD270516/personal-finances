---
id: TC-PLATFORM-DRILL-008
title: "El drill no restaura si el disco no tiene espacio para la copia con margen"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Espacio en disco antes del drill"
scenario: "Disco sin espacio para la copia"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-005","NFR-OBS-005"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/drill.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","disk","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; info del último backup con 4 GiB de base y df con 6 GiB libres en /var/lib/docker"
input: {"backup_size_bytes":4294967296,"free_bytes":6442450944}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer las llamadas a docker, drills.log y el heartbeat"
expected_result:
  - "No hay llamada al restore ni se crea el volumen"
  - "drills.log registra fail por espacio (necesario 7 GiB, libre 6 GiB)"
  - "Hay una llamada a /pfos-drill/fail"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-008 — El drill no restaura si el disco no tiene espacio para la copia con margen

## Intención

Requirement «Espacio en disco antes del drill» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un respaldo de 4 GiB y 6 GiB libres
Cuando corre el drill
Entonces no restaura porque necesita 1,25 × 4 GiB + 2 GiB = 7 GiB y avisa el fallo
```

## Notas


