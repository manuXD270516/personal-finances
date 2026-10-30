---
id: TC-RULES-ENGINE-003
title: "El nombre de regla es único sin distinguir mayúsculas"
spec: rules/rule-engine
related_specs: []
requirement: "Definición de reglas WHEN/THEN"
scenario: "Nombre repetido"
requirement_status: confirmed
fr: ["FR-RULES-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/application/rules.service.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "NAME_TAKEN"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
input: {"name":"SUPERMERCADO"}
steps:
  - "POST W/rules con nombre \"SUPERMERCADO\""
expected_result:
  - "409 NAME_TAKEN"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-003 — El nombre de regla es único sin distinguir mayúsculas

## Intención

Unicidad `(workspace_id, lower(name)) WHERE archived_at IS NULL`.

## Escenario

```gherkin
Dada la regla activa "Supermercado"
Cuando creo otra llamada "SUPERMERCADO"
Entonces se rechaza con NAME_TAKEN
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
