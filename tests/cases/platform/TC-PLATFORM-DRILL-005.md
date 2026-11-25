---
id: TC-PLATFORM-DRILL-005
title: "El drill limpia contenedor, volumen y red tras un fallo y borra los restos de uno interrumpido"
spec: platform/delivery-pipeline
related_specs: []
requirement: "El drill no puede afectar la producción ni los respaldos"
scenario: "Limpieza tras un fallo"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-005"]
invariants: ["INV-004", "INV-005"]
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/drill.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el doble de docker informa que existe el volumen pfos-drill-pg de una corrida anterior"
  - "La verificación de integridad devuelve 2 asientos con menos de dos postings"
input: {"leftover_volume":true,"entries_with_less_than_two_postings":2}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer el orden de las llamadas a docker"
expected_result:
  - "Antes del restore se borra el volumen pfos-drill-pg que había quedado"
  - "Después del fallo de integridad se ejecutan rm -f del contenedor, volume rm y network rm"
  - "Si la limpieza falla, el drill avisa fail aunque el resto hubiera pasado"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-005 — El drill limpia contenedor, volumen y red tras un fallo y borra los restos de uno interrumpido

## Intención

Requirement «El drill no puede afectar la producción ni los respaldos» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un volumen de un drill interrumpido y una copia con 2 asientos incompletos
Cuando corre el drill
Entonces borra los restos antes de restaurar y limpia todo después del fallo
```

## Notas

- Cubre también el scenario «Restos de un drill interrumpido».
