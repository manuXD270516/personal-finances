---
id: TC-IDENTITY-EXPORT-010
title: "El manifiesto informa conteos exactos de cada sección exportada"
spec: identity/workspace-portability
related_specs: []
requirement: "Contenido completo del export"
scenario: "Conteos del export"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
nfr: [NFR-REL-014]
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests: ["apps/api/src/portability/portability-coverage.test.ts","apps/api/test/api/workspace-export.api.test.ts","apps/api/test/db/workspace-export-contract.int.test.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["export", "coverage"]
error_code: null
preconditions:
  - "\"W1\" con 3 cuentas, 25 categorías, 120 transacciones con 131 splits, 128 asientos y 2 sesiones de reconciliación"
input:
  export: "W1"
steps:
  - "Exportar"
  - "Comparar manifest.sections[].count con las filas de cada sección y con la BD"
  - "Test de arquitectura: platform.workspace_scoped_table ⊆ secciones ∪ exclusiones"
expected_result:
  - "Conteos exactos en manifiesto y archivos"
  - "Ninguna tabla acotada por workspace queda sin sección ni exclusión declarada"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-010 — El manifiesto informa conteos exactos de cada sección exportada

## Intención

Un export incompleto da falsa seguridad (RISK-009).

## Escenario

```gherkin
Dado "W1" con 3 cuentas, 25 categorías, 120 transacciones, 131 splits, 128 asientos y 2 sesiones
Cuando el OWNER lo exporta
Entonces el manifiesto informa exactamente esas cantidades
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
