---
id: TC-RULES-ENGINE-053
title: "Las reglas de un workspace no se ven ni se evalúan en otro"
spec: rules/rule-engine
related_specs: []
requirement: "Permisos y auditoría de las reglas"
scenario: "Aislamiento entre workspaces"
requirement_status: confirmed
fr: ["FR-RULES-001"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: critical
type: security
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/application/evaluation.test.ts
  - packages/contexts/rules/test/integration/pg-rules.int.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "Workspace \"W2\""
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\" solo en W1"
input: {"workspace":"W2"}
steps:
  - "Evaluar HIPERMAXI SUC 12 en W2"
  - "Consultar rules.rule sin contexto de workspace"
expected_result:
  - "Fila de W2 sin categoría"
  - "Sin contexto: PF002 (fail-closed)"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-053 — Las reglas de un workspace no se ven ni se evalúan en otro

## Intención

RLS forzada en rules.*.

## Escenario

```gherkin
Dada la regla Supermercado solo en W1
Cuando W2 previsualiza HIPERMAXI SUC 12
Entonces la fila queda sin categoría
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
