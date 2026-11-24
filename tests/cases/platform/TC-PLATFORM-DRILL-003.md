---
id: TC-PLATFORM-DRILL-003
title: "Un asiento descuadrado en la copia restaurada hace fallar el drill"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Drill de restore mensual en el host que avisa si falla"
scenario: "Asiento descuadrado en la copia"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-005"]
invariants: ["INV-004", "INV-005"]
priority: critical
type: platform
level: unit
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","ledger","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el doble de psql de la copia devuelve 1 en la consulta de pares asiento-moneda que no suman cero"
  - "Caso de referencia: postings de +100.00 BOB y −99.99 BOB en un mismo asiento"
input: {"unbalanced_pairs":1,"entries_with_less_than_two_postings":0}
steps:
  - "Ejecutar pfos-backup.sh drill"
  - "Leer drills.log y las llamadas al heartbeat"
expected_result:
  - "Las dos consultas de integridad se ejecutan sobre el contenedor pfos-drill-pg, nunca sobre postgres de producción"
  - "drills.log registra fail por integridad con el conteo 1"
  - "Hay una llamada a /pfos-drill/fail"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-003 — Un asiento descuadrado en la copia restaurada hace fallar el drill

## Intención

Requirement «Drill de restore mensual en el host que avisa si falla» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado una copia con un asiento de +100.00 BOB y −99.99 BOB
Cuando el drill verifica la integridad
Entonces cuenta 1 par que no suma cero y avisa el fallo
```

## Notas

- Las consultas son las de §6.4 del runbook de restore, con la de asientos reforzada a menos de dos postings (INV-005).
- Se prueba aparte la consulta SQL contra PostgreSQL real con Testcontainers si el harness la extrae a un archivo .sql.
