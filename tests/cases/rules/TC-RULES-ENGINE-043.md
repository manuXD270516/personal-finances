---
id: TC-RULES-ENGINE-043
title: "Cambiar la prioridad se audita sin crear versión"
spec: rules/rule-engine
related_specs: []
requirement: "Versionado de reglas"
scenario: "Reordenar no versiona"
requirement_status: confirmed
fr: ["FR-RULES-006", "FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - apps/web/src/ui/rules/logic.test.ts
  - packages/contexts/rules/src/application/rules.service.test.ts
  - packages/contexts/rules/src/domain/rule.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"priority":"100 ⇒ 5"}
steps:
  - "PUT W/rules/order con la regla primero"
expected_result:
  - "La versión de definición no cambia"
  - "Auditoría con prioridad anterior y nueva"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-043 — Cambiar la prioridad se audita sin crear versión

## Intención

Solo la definición genera versión.

## Escenario

```gherkin
Cuando cambio la prioridad de 100 a 5
Entonces la regla sigue en su versión
  Y el cambio queda auditado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
