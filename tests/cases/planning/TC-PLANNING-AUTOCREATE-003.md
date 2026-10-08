---
id: TC-PLANNING-AUTOCREATE-003
title: El EDITOR puede pedir periodos hasta una fecha dentro de 24 meses
spec: planning/financial-periods
related_specs: []
requirement: Creación anticipada a pedido
scenario: Planificar el año siguiente
requirement_status: confirmed
fr:
  - FR-PLANNING-002
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
error_code: VALIDATION_FAILED
preconditions:
  - Hoy es 2026-10-05
  - Existen periodos hasta "2027-01" con día de inicio 1
  - Usuario EDITOR
input:
  - through: 2027-12-31
  - through: 2029-01-01
steps:
  - POST /periods con through 2027-12-31
  - Repetir el mismo pedido
  - POST /periods con through 2029-01-01
expected_result:
  - Existen en draft todos los periodos de "2027-02" a "2027-12"
  - La repetición no crea periodos nuevos
  - El pedido hasta 2029-01-01 responde 400 VALIDATION_FAILED sin crear periodos
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-AUTOCREATE-003 — El EDITOR puede pedir periodos hasta una fecha dentro de 24 meses

## Intención

Permite planificar el año siguiente sin esperar al job, con un tope que evita crear cientos de periodos por error.

## Escenario

```gherkin
Dado que existen periodos hasta "2027-01"
Cuando el EDITOR pide periodos hasta 2027-12-31
Entonces existen en draft los periodos de "2027-02" a "2027-12"
Cuando pide periodos hasta 2029-01-01
Entonces se rechaza con "VALIDATION_FAILED"
```

## Notas

- Requirement Should. Cubre también "Fecha fuera del límite".
