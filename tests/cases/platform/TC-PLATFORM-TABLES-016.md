---
id: TC-PLATFORM-TABLES-016
title: "El procesamiento de un import se expone como progreso con nombre"
spec: platform/web-interface
related_specs: ["imports/import-pipeline"]
requirement: "Medidas y procesos con su rol propio"
scenario: "Procesamiento de un import"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-108"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pipeline.test.tsx
status: automated
regression_suite: false
phase: 9
tags: ["progress", "a11y"]
error_code: null
preconditions:
  - "import en estado PROCESSING"
input: {}
steps:
  - "el OWNER sube un CSV y mira el panel de procesamiento"
expected_result:
  - "hay un elemento con rol progressbar nativo (progress) con nombre accesible del import"
  - "el marcado estático del panel lo incluye (test unitario)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-016 — El procesamiento de un import se expone como progreso con nombre

## Intención

Verifica el requirement «Medidas y procesos con su rol propio» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado import en estado PROCESSING
Cuando el OWNER sube un CSV y mira el panel de procesamiento
Entonces hay un elemento con rol progressbar nativo (progress) con nombre accesible del import
  Y el marcado estático del panel lo incluye (test unitario)
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
