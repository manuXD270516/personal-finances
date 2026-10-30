---
id: TC-RULES-ENGINE-048
title: "El listado señala reglas activas sin aplicaciones en 90 días"
spec: rules/rule-engine
related_specs: []
requirement: "Estadísticas por regla"
scenario: "Regla sin uso"
requirement_status: confirmed
fr: ["FR-RULES-001", "FR-RULES-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/rules/rules.test.tsx
  - packages/contexts/rules/src/application/rules.service.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Regla \"Gimnasio\" activa desde 2026-06-01 sin transacciones clasificadas"
input: {}
steps:
  - "GET W/rules"
expected_result:
  - "Gimnasio con stats.classifiedTransactions = 0 y unusedFor90Days = true"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-048 — El listado señala reglas activas sin aplicaciones en 90 días

## Intención

Estadísticas por regla (Should).

## Escenario

```gherkin
Dada la regla Gimnasio sin uso desde junio
Cuando listo las reglas el 2026-10-20
Entonces aparece con 0 transacciones y la señal sin uso
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
