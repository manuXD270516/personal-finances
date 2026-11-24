---
id: TC-PLATFORM-DRILL-004
title: "La copia del drill no puede escribir en el repositorio de respaldos"
spec: platform/delivery-pipeline
related_specs: []
requirement: "El drill no puede afectar la producción ni los respaldos"
scenario: "La copia no escribe en el repositorio"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-005","NFR-SEC-007"]
invariants: []
priority: critical
type: platform
level: smoke
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","b2","add-host-restore-drill"]
error_code: null
preconditions:
  - "Host del PoC (fase 7) con /etc/pfos/pgbackrest-restore.env cargado con la clave de solo lectura de tofu output"
  - "Prefijo del PoC (C4) activo"
input: {"command":"systemctl start pfos-backup@drill.service"}
steps:
  - "Disparar el drill y, mientras la copia está arriba, leer archive_mode dentro de pfos-drill-pg"
  - "Con la clave de solo lectura, intentar subir un objeto de prueba al bucket (rclone o aws s3 cp en un contenedor efímero)"
  - "Listar los WAL de la stanza antes y después del drill"
expected_result:
  - "archive_mode es off en la copia"
  - "La subida con la clave de solo lectura falla con acceso denegado"
  - "La stanza no tiene WAL de un timeline nuevo después del drill"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-004 — La copia del drill no puede escribir en el repositorio de respaldos

## Intención

Requirement «El drill no puede afectar la producción ni los respaldos» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el drill corriendo en el host del PoC
Cuando la copia promueve
Entonces no envía WAL al repositorio y la credencial no permite escribir
```

## Notas

- Prueba en el host, no automatizada en CI. El harness comprueba además que el drill nunca pasa pgbackrest.env al contenedor.
