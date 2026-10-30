---
id: TC-RULES-ENGINE-016
title: "Excluir del import solo actúa con el disparador de importación"
spec: rules/rule-engine
related_specs: []
requirement: "Acciones de descripción, nota y exclusión del import"
scenario: "Excluir transferencias propias del import"
requirement_status: confirmed
fr: ["FR-RULES-005", "FR-RULES-009"]
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
  - "Regla \"Traspasos propios\": descripción contiene `traspaso entre mis cuentas` ⇒ excluir del import, disparadores IMPORT y RETROACTIVE"
input: {"triggers":["IMPORT","RETROACTIVE"]}
steps:
  - "Evaluar una fila importada con IMPORT"
  - "Evaluar una transacción existente con RETROACTIVE"
expected_result:
  - "La fila queda propuesta como excluida"
  - "El dry-run no propone cambios"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-016 — Excluir del import solo actúa con el disparador de importación

## Intención

La exclusión no tiene sentido fuera del import.

## Escenario

```gherkin
Dada la regla de traspasos propios
Cuando coincide con una fila importada y con una transacción en un dry-run
Entonces solo la fila queda excluida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
