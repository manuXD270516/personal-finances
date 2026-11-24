---
id: TC-PLATFORM-DRILL-006
title: "El drill falla si la copia pierde más de 15 minutos de postings frente a producción"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Pérdida de datos del drill dentro del RPO"
scenario: "Copia atrasada"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-001"]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["host","backup","restore-drill","rpo","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops con el doble de psql de producción y el de la copia"
input: {"cases":[{"production_last":"2026-12-02T08:58:00Z","copy_last":"2026-12-02T08:55:00Z","result":"ok","gap_s":180},{"production_last":"2026-12-02T08:58:00Z","copy_last":"2026-12-02T08:30:00Z","result":"fail","gap_s":1680},{"production_last":null,"copy_last":null,"result":"ok","gap_s":null}]}
steps:
  - "Ejecutar pfos-backup.sh drill con cada par de instantes"
  - "Leer drills.log y el heartbeat"
expected_result:
  - "Con 3 min de pérdida, gap=180 y resultado ok"
  - "Con 28 min de pérdida, gap=1680, resultado fail por RPO y /pfos-drill/fail"
  - "Sin postings en producción, gap=n/a y el drill no falla por pérdida"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-DRILL-006 — El drill falla si la copia pierde más de 15 minutos de postings frente a producción

## Intención

Requirement «Pérdida de datos del drill dentro del RPO» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el último posting de producción a las 08:58 UTC
Cuando el de la copia es de las 08:30 UTC
Entonces el drill avisa una pérdida de 28 min, mayor que el RPO de 15 min
```

## Notas

- Cubre también los scenarios «Copia al día» y «Producción sin postings».
