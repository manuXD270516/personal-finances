---
id: TC-PLATFORM-TABLES-006
title: "La fecha de la vista previa queda fija al desplazar a lo ancho y es encabezado de fila"
spec: platform/web-interface
related_specs: []
requirement: "Columna de identificación fija en tablas anchas"
scenario: "Desplazar la vista previa a lo ancho"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-108"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "sticky"]
error_code: null
preconditions:
  - "un import en vista previa con 20 filas"
input: {}
steps:
  - "a 360 px el OWNER desplaza la vista previa hasta la última columna"
expected_result:
  - "la celda de fecha de la primera fila sigue dentro del área visible de la región"
  - "la celda de fecha es th scope=\"row\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-006 — La fecha de la vista previa queda fija al desplazar a lo ancho y es encabezado de fila

## Intención

Verifica el requirement «Columna de identificación fija en tablas anchas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un import en vista previa con 20 filas
Cuando a 360 px el OWNER desplaza la vista previa hasta la última columna
Entonces la celda de fecha de la primera fila sigue dentro del área visible de la región
  Y la celda de fecha es th scope="row"
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
