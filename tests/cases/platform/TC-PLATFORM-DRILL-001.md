---
id: TC-PLATFORM-DRILL-001
title: "El drill mensual restaura repo1, verifica la copia, registra la duración y avisa éxito al heartbeat"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Drill de restore mensual en el host que avisa si falla"
scenario: "Drill exitoso"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-001","NFR-REL-002","NFR-REL-005","NFR-OBS-005"]
invariants: ["INV-004", "INV-005"]
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
  - "Harness scripts/host-ops con dobles de docker, curl, df y date (Linux)"
  - "pgbackrest-restore.env y release.env de prueba en un directorio temporal (PFOS_ETC_DIR, PFOS_STATE_DIR)"
  - "El doble de docker devuelve un backup de repo1 con etiqueta 20261201-060012F_20261202-060010D y 0 en las dos consultas de integridad"
input: {"subcommand":"drill","now":"2026-12-02T09:03:00Z"}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer las llamadas registradas por los dobles y la línea nueva de drills.log"
expected_result:
  - "El restore usa --env-file de pgbackrest-restore.env (no pgbackrest.env), --repo=1 y la imagen PFOS_POSTGRES_IMAGE del release"
  - "La base arranca con archive_mode=off, listen_addresses vacío, sin -p y en la red pfos-drill"
  - "drills.log tiene una línea ok con la etiqueta, restore=, recovery=, total=, size= y pgbackrest="
  - "Hay un POST al heartbeat /pfos-drill con esa línea como cuerpo y ningún /fail"
  - "Al final se borran el contenedor, el volumen y la red del drill"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-001 — El drill mensual restaura repo1, verifica la copia, registra la duración y avisa éxito al heartbeat

## Intención

Requirement «Drill de restore mensual en el host que avisa si falla» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el último respaldo de repo1 disponible y la clave de solo lectura
Cuando corre el drill el 2026-12-02 a las 09:00 UTC
Entonces restaura, verifica INV-004 e INV-005 sin hallazgos, registra la duración
  Y avisa éxito al heartbeat pfos-drill
```

## Notas

- La corrida real se hace en el PoC (fase 7, tarea 7.2) y en el primer drill programado; el harness prueba comandos, orden, registro y aviso.
- La línea de drills.log no lleva datos financieros: solo etiqueta, duraciones, tamaño, pérdida en segundos y versión.
