---
id: TC-REPORTING-FORECAST-027
title: "El OWNER guarda los ajustes con versión y auditoría, viajan en el export y una versión vencida se rechaza"
spec: reporting/dashboard
related_specs: []
requirement: "Ajustes del disponible del workspace"
scenario: "El OWNER activa el próximo ingreso y los esenciales"
requirement_status: confirmed
fr: ["FR-PLANNING-024","FR-AUDIT-001","FR-IDENTITY-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/cash-flow-calendar.api.test.ts
  - apps/api/test/api/spendable-settings-portability.api.test.ts
  - apps/web/src/ui/cash-flow/forecast-home.test.tsx
  - packages/contexts/reporting/src/application/spendable-settings.use-cases.test.ts
  - packages/contexts/reporting/test/integration/pg-cash-flow.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["spendable","settings","audit"]
error_code: PRECONDITION_FAILED
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Ajustes por omisión (versión 1)"
input: {"horizonMode":"NEXT_INCOME","subtractEssentials":true,"essentialCategories":["Supermercado","Transporte"]}
steps:
  - "PUT con If-Match versión 1"
  - "PUT con If-Match versión 1 otra vez"
  - "Exportar e importar el workspace"
expected_result:
  - "Versión 2 y registro de auditoría con antes y después"
  - "Segundo PUT: 412 PRECONDITION_FAILED sin cambios"
  - "Ajustes importados con las categorías remapeadas"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-027 — El OWNER guarda los ajustes con versión y auditoría, viajan en el export y una versión vencida se rechaza

## Intención

Configuración auditada (FR-AUDIT-001) y portable.

## Escenario

```gherkin
Dado Ajustes por omisión (versión 1)
Cuando PUT con If-Match versión 1
Entonces Versión 2 y registro de auditoría con antes y después
  Y Segundo PUT: 412 PRECONDITION_FAILED sin cambios
  Y Ajustes importados con las categorías remapeadas
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Ajustes del disponible del workspace" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
