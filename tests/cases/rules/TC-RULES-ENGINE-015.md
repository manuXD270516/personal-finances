---
id: TC-RULES-ENGINE-015
title: "Renombrar la descripción conserva el texto original en la importación"
spec: rules/rule-engine
related_specs: []
requirement: "Acciones de descripción, nota y exclusión del import"
scenario: "Renombrar una glosa bancaria"
requirement_status: confirmed
fr: ["FR-RULES-005"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/rule-evaluator.test.ts
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
  - "Regla \"Netflix\": descripción contiene `nflx` ⇒ descripción = \"Netflix\""
input: {"row":"DEB AUT NFLX.COM 0412"}
steps:
  - "Evaluar en la vista previa de un import"
expected_result:
  - "description propuesta = \"Netflix\""
  - "El staging conserva \"DEB AUT NFLX.COM 0412\""
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-015 — Renombrar la descripción conserva el texto original en la importación

## Intención

Acción set description (Should).

## Escenario

```gherkin
Dada la regla Netflix
Cuando la fila es DEB AUT NFLX.COM 0412
Entonces propone la descripción Netflix y conserva el original
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
