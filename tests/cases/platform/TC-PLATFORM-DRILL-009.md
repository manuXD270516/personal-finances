---
id: TC-PLATFORM-DRILL-009
title: "La verificación semanal de repo1 y repo2 avisa el fallo si encuentra un archivo inválido"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Verificación semanal de los repositorios de respaldo"
scenario: "Archivo corrupto en el repositorio mensual"
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
tags: ["host","backup","verify","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el doble de docker hace que verify de repo2 termine con error de checksum"
input: {"subcommand":"verify","repo1":"ok","repo2":"checksum mismatch"}
steps:
  - "Ejecutar pfos-backup.sh verify"
  - "Leer las llamadas a docker y al heartbeat"
expected_result:
  - "verify corre en un contenedor efímero con --rm, techo de memoria y pgbackrest-restore.env, no por compose exec en postgres"
  - "Se verifican repo1 y repo2"
  - "Hay una llamada a /pfos-verify/fail y el log nombra repo2"
  - "Con los dos repositorios sanos, la llamada es a /pfos-verify sin /fail"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-009 — La verificación semanal de repo1 y repo2 avisa el fallo si encuentra un archivo inválido

## Intención

Requirement «Verificación semanal de los repositorios de respaldo» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un archivo del repositorio mensual con un checksum que no coincide
Cuando corre la verificación del miércoles
Entonces avisa el fallo al heartbeat pfos-verify nombrando el repositorio
```

## Notas

- Cubre también el scenario «Repositorios sanos». La verificación real se dispara en el PoC (tarea 7.2).
