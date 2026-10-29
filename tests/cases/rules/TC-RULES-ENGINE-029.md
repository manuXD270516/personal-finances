---
id: TC-RULES-ENGINE-029
title: "Aplicar el dry-run es atómico y auditado con un identificador común"
spec: rules/rule-engine
related_specs: []
requirement: "Aplicación del dry-run como edición masiva auditada"
scenario: "Aplicar el dry-run de septiembre"
requirement_status: provisional
fr: ["FR-RULES-008", "FR-RULES-010", "FR-TRANSACTIONS-033"]
nfr: []
invariants: ["INV-029"]
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
  - "Dry-run de TC-RULES-ENGINE-027 con su token"
  - "Uno de los 4 gastos en un periodo cerrado en una variante"
input: {"token":"<del dry-run>","transactionIds":4}
steps:
  - "POST W/rules/dry-run/apply con Idempotency-Key"
  - "Variante: uno de los 4 en periodo cerrado"
expected_result:
  - "applied = 4 en Supermercado con origen RULE v1"
  - "4 auditorías con el mismo bulkOperationId"
  - "Variante: 3 aplicados y 1 en notApplicable con PERIOD_CLOSED"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-029 — Aplicar el dry-run es atómico y auditado con un identificador común

## Intención

Reutiliza la semántica de la edición masiva.

## Escenario

```gherkin
Dado el dry-run de septiembre
Cuando lo aplico
Entonces los 4 gastos quedan en Supermercado
  Y hay 4 auditorías con el mismo identificador
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
