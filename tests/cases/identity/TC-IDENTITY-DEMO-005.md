---
id: TC-IDENTITY-DEMO-005
title: "La marca demo de un workspace es inmutable"
spec: identity/demo-data
related_specs: []
requirement: "Datos demo aislados en un workspace dedicado"
scenario: "La marca demo es inmutable"
requirement_status: confirmed
fr: ["FR-IDENTITY-013"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-007"]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["demo-data","database","security"]
error_code: null
preconditions:
  - "\"W1 Personal Demo\" real (is_demo = false)"
  - "Un workspace demo (is_demo = true)"
input: {"updates":["UPDATE iam.workspace SET is_demo = true WHERE id = W1","UPDATE iam.workspace SET is_demo = false WHERE id = demo"]}
steps:
  - "Intentar activar la marca demo en W1 con el rol de la app y con el rol de migraciones"
  - "Intentar quitar la marca demo al workspace demo"
expected_result:
  - "Ambas operaciones fallan con SQLSTATE PF003"
  - "W1 sigue con is_demo = false y el demo con is_demo = true"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-005 — La marca demo de un workspace es inmutable

## Intención

Si un workspace real pudiera marcarse como demo, la purga podría borrarlo: la inmutabilidad del flag es la primera barrera (ADR-0026).

## Escenario

```gherkin
Dado un workspace real y uno demo
Cuando cualquier proceso intenta cambiar su marca demo
Entonces la base de datos lo rechaza
  Y ambas marcas quedan como estaban
```

## Notas

- No existe endpoint que modifique isDemo; este TC prueba la barrera de BD.
