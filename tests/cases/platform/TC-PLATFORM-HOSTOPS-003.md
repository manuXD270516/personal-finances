---
id: TC-PLATFORM-HOSTOPS-003
title: "Sin registro de releases la limpieza borra solo las imágenes colgantes"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Limpieza semanal de imágenes que conserva el release actual y el anterior"
scenario: "Registro de releases ausente"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-013"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/hostops.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","docker","image-prune","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops sin releases.log"
input: {"releases_log":null}
steps:
  - "Ejecutar pfos-backup.sh image-prune"
expected_result:
  - "No hay llamadas a docker image rm"
  - "Se ejecuta docker image prune -f y el log dice que falta releases.log"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-003 — Sin registro de releases la limpieza borra solo las imágenes colgantes

## Intención

Requirement «Limpieza semanal de imágenes que conserva el release actual y el anterior» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un host sin registro de releases
Cuando corre la limpieza
Entonces borra solo las imágenes sin referencia y lo registra
```

## Notas


