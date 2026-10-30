---
id: TC-IMPORTS-PIPELINE-069
title: "El resumen de un import con 41 de 57 transacciones clasificadas por reglas muestra 0.7193"
spec: imports/import-pipeline
related_specs: ["rules/rule-engine"]
requirement: "Resumen final con la cobertura de reglas"
scenario: "Resumen de un import clasificado"
requirement_status: provisional
fr: ["FR-IMPORTS-008", "FR-RULES-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pipeline-logic.test.ts
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/testing/import-pipeline.lifecycle.test.ts
  - packages/contexts/imports/test/integration/pg-pipeline.int.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Resumen de un import clasificado\" del delta de add-import-pipeline"
steps:
  - "una importación creó 57 transacciones de ingreso y gasto, 41 con la categoría fijada por una regla"
expected_result:
  - "su resumen muestra 57 creadas y una cobertura por reglas de 0.7193"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-069 — El resumen de un import con 41 de 57 transacciones clasificadas por reglas muestra 0.7193

## Intención

Al terminar una importación, su resumen DEBE (MUST) mostrar, además de los conteos, la cobertura de clasificación por reglas de las transacciones que creó, calculada como la define la capability de reglas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando una importación creó 57 transacciones de ingreso y gasto, 41 con la categoría fijada por una regla
Entonces su resumen muestra 57 creadas y una cobertura por reglas de 0.7193
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
