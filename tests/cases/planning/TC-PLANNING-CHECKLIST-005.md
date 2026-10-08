---
id: TC-PLANNING-CHECKLIST-005
title: "El OWNER puede bajar a advertencia las cuentas sin conciliar"
spec: planning/month-closing
related_specs: []
requirement: "Severidad configurable de los ítems del checklist"
scenario: "OWNER relaja las cuentas sin conciliar"
requirement_status: confirmed
fr: [FR-PLANNING-003]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["checklist", "policy"]
error_code: "MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED"
preconditions:
  - "Periodo \"2026-10\" (del 2026-10-01 al 2026-10-31) ACTIVE y terminado; política de cierre por defecto"
  - "FixedClock 2026-11-03T12:00:00-04:00 (America/La_Paz)"
  - "\"USD Savings\" sin conciliar al 2026-10-31 (última sesión al 2026-09-30)"
  - "Sin otras observaciones"
input:
  policyUpdate: {"UNRECONCILED_ACCOUNTS": "WARNING"}
steps:
  - "PUT …/planning/closing-policy como OWNER con If-Match"
  - "POST …/periods/{id}/close como EDITOR sin acknowledgeWarnings"
  - "Repetir con acknowledgeWarnings true"
expected_result:
  - "Política auditada con valor anterior BLOCKING y nuevo WARNING"
  - "Primer cierre: 409 MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED con warningItems [UNRECONCILED_ACCOUNTS]"
  - "Segundo cierre: \"2026-10\" closed; el snapshot registra la advertencia reconocida y \"USD Savings\" con reconciliationBasis null"
created: 2026-10-08
updated: 2026-10-08
---

# TC-PLANNING-CHECKLIST-005 — El OWNER puede bajar a advertencia las cuentas sin conciliar

## Intención

Decisión del owner docs/33 D66: bloqueante por defecto pero configurable por el OWNER.

## Escenario

```gherkin
Dado que el OWNER bajó a advertencia las cuentas sin conciliar
Cuando el EDITOR cierra "2026-10" con "USD Savings" sin conciliar
Entonces el cierre exige reconocer la advertencia en lugar de impedirse
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
