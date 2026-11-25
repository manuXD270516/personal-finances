---
id: TC-IMPORTS-PDF-050
title: "El comando local escribe en disco el extracto PDF sintético de Ganadero y el lector lo reconoce completo"
spec: imports/import-pipeline
related_specs: []
requirement: "Diagnóstico local de un extracto PDF sin revelar datos"
scenario: "Diagnóstico de un extracto"
requirement_status: provisional
fr: ["FR-IMPORTS-016"]
nfr: []
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/pdf/pdf-sample.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados"
input: "Decisión D461 del despliegue N1 (docs/75): un comando que escriba en disco el PDF sintético de Ganadero"
steps:
  - "el owner ejecuta `pnpm imports:pdf:sample <ruta>` con una ruta fuera del repositorio"
expected_result:
  - "se escribe un PDF válido (cabecera `%PDF-`) con el extracto sintético de \"Banco Pampa Demo\" (diseño `bo.ganadero.cuenta` versión 1, 2 páginas, 11 filas)"
  - "el diagnóstico local de ese archivo informa la coherencia correcta (`resultado: OK`)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-IMPORTS-PDF-050 — El comando local escribe en disco el extracto PDF sintético de Ganadero

## Intención

El repositorio DEBE (MUST) ofrecer un comando local que escriba en disco, sin versionarlo, el mismo extracto PDF sintético que usan los E2E (diseño Ganadero, 11 filas en 2 páginas), para probar en un despliegue la lectura exitosa antes de usar extractos reales.

## Escenario

```gherkin
Cuando el owner ejecuta `pnpm imports:pdf:sample <ruta>` con una ruta fuera del repositorio
Entonces se escribe un PDF válido con el extracto sintético de "Banco Pampa Demo" (diseño `bo.ganadero.cuenta` versión 1, 2 páginas, 11 filas)
  Y el diagnóstico local de ese archivo informa la coherencia correcta
```

## Notas

- Seguimiento del despliegue N1 (D461, [docs/75](../../../docs/75-despliegue-n1-pendientes-decisions.md)); sin change propio: herramienta de pruebas, sin cambio de comportamiento del producto. Datos ficticios; ningún PDF versionado (D255, D281, D282).
