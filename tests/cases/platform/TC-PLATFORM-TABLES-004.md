---
id: TC-PLATFORM-TABLES-004
title: "La cabecera de la vista previa queda fija y opaca al desplazarse"
spec: platform/web-interface
related_specs: []
requirement: "Cabecera fija en tablas de mucho volumen"
scenario: "Vista previa con 200 filas"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["tables", "sticky"]
error_code: null
preconditions:
  - "un import en vista previa con 200 filas sintéticas"
input: {}
steps:
  - "el OWNER desplaza la región de la vista previa hasta la fila 150"
expected_result:
  - "los th Fecha, Descripción y Monto tienen el mismo top que la región"
  - "el left de cada th coincide con el de las celdas de su columna"
  - "el fondo calculado de los th es opaco; captura a 360 px y a 1280 px adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-004 — La cabecera de la vista previa queda fija y opaca al desplazarse

## Intención

Verifica el requirement «Cabecera fija en tablas de mucho volumen» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un import en vista previa con 200 filas sintéticas
Cuando el OWNER desplaza la región de la vista previa hasta la fila 150
Entonces los th Fecha, Descripción y Monto tienen el mismo top que la región
  Y el left de cada th coincide con el de las celdas de su columna
  Y el fondo calculado de los th es opaco; captura a 360 px y a 1280 px adjuntada
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
