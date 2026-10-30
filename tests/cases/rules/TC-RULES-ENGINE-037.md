---
id: TC-RULES-ENGINE-037
title: "El detalle y la auditoría muestran la regla y versión por campo"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Trazabilidad de la regla aplicada"
scenario: "Detalle de una transacción clasificada"
requirement_status: confirmed
fr: ["FR-RULES-010"]
nfr: []
invariants: ["INV-029"]
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/rules/rules.test.tsx
  - tests/e2e/specs/rules.spec.ts
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
input: {"transaction":"HIPERMAXI SUC 12 importada"}
steps:
  - "Abrir el detalle en la UI"
  - "GET W/transactions/{id} y su historial"
expected_result:
  - "Texto \"Categoría: Supermercado, por la regla Supermercado (v1)\""
  - "ruleRefs por campo en la API y en la auditoría de creación"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-037 — El detalle y la auditoría muestran la regla y versión por campo

## Intención

FR-RULES-010 visible al usuario.

## Escenario

```gherkin
Dado el gasto importado clasificado por Supermercado
Cuando abro su detalle
Entonces veo la regla y versión por campo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
