---
id: TC-PLATFORM-HOSTOPS-004
title: "La verificación horaria falla el heartbeat cuando un disco pasa el 80 % y nombra todas las causas"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Alerta de disco por encima del 80 %"
scenario: "Disco al 83 %"
requirement_status: confirmed
fr: []
nfr: ["NFR-OBS-005","NFR-REL-001"]
invariants: []
priority: critical
type: platform
level: unit
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","disk","check","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops con el doble de df y el de pgbackrest check"
input: {"cases":[{"root_pct":83,"archive":"ok","result":"fail"},{"root_pct":79,"archive":"ok","result":"ok"},{"root_pct":95,"archive":"fail","result":"fail"}]}
steps:
  - "Ejecutar pfos-backup.sh check con cada caso"
  - "Leer la salida de error y las llamadas al heartbeat"
expected_result:
  - "Con 83 %: /pfos-check/fail y el mensaje nombra el punto de montaje y 83 %"
  - "Con 79 % y el archivado al día: /pfos-check sin /fail"
  - "Con 95 % y el archivado caído: /pfos-check/fail y el mensaje nombra las dos causas"
  - "Si / y /var/lib/docker son el mismo dispositivo, se evalúa una sola vez"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-004 — La verificación horaria falla el heartbeat cuando un disco pasa el 80 % y nombra todas las causas

## Intención

Requirement «Alerta de disco por encima del 80 %» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el disco del host al 83 % y el archivado al día
Cuando corre la verificación horaria
Entonces avisa un fallo que nombra el punto de montaje y el 83 %
```

## Notas

- Cubre también los scenarios «Disco al 79 %» y «Disco lleno con el archivado caído».
