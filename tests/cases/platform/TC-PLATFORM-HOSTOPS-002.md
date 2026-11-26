---
id: TC-PLATFORM-HOSTOPS-002
title: "La limpieza de imágenes conserva el release actual y el anterior y borra los más viejos"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Limpieza semanal de imágenes que conserva el release actual y el anterior"
scenario: "Tres releases en el registro"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-006","NFR-REL-013","NFR-OBS-005"]
invariants: []
priority: critical
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/hostops.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","docker","image-prune","rollback","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; releases.log con los releases A, B y C (C actual), cada uno con api, web y pg"
  - "El doble de docker lista las imágenes de A, B y C, la de rclone y las de los servicios en marcha"
input: {"releases":["A","B","C"]}
steps:
  - "Ejecutar pfos-backup.sh image-prune"
  - "Leer las llamadas a docker image rm y al heartbeat"
expected_result:
  - "Se llama docker image rm, sin -f, solo para las imágenes de A"
  - "No se borran las de B, C, rclone ni las usadas por contenedores"
  - "Se ejecuta docker image prune -f para las colgantes"
  - "Hay un POST al heartbeat /pfos-image-prune con la cantidad borrada y el espacio liberado"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-002 — La limpieza de imágenes conserva el release actual y el anterior y borra los más viejos

## Intención

Requirement «Limpieza semanal de imágenes que conserva el release actual y el anterior» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un registro con los releases A, B y C
Cuando corre la limpieza semanal
Entonces borra las imágenes de A y conserva las de B y C
  Y un rollback a B arranca sin descargar sus imágenes
```

## Notas

- El rollback sin descarga se comprueba en el PoC: pfos-deploy.sh rollback tras la limpieza no hace pull de las imágenes de B.
