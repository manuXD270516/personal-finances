---
id: TC-RULES-ENGINE-058
title: "Export e import conservan reglas, versiones, origen y cobertura"
spec: identity/workspace-portability
related_specs: ["rules/rule-engine"]
requirement: "Reglas y origen de la clasificación en el export"
scenario: "Ida y vuelta con reglas versionadas"
requirement_status: confirmed
fr: ["FR-IDENTITY-010", "FR-IDENTITY-017", "FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules-portability.api.test.ts
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
  - "12 reglas (una archivada, Supermercado en v3), 148 de 200 importadas por reglas, 3 marcas de revisión"
input: {}
steps:
  - "Exportar W1 e importar en un workspace nuevo"
  - "GET W/rules, versiones y cobertura del rango"
expected_result:
  - "12 reglas con versiones, prioridades y estados"
  - "Cobertura 0.7400 y 3 marcas pendientes"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-058 — Export e import conservan reglas, versiones, origen y cobertura

## Intención

Portabilidad de RULES.

## Escenario

```gherkin
Dado W1 con 12 reglas y cobertura 0.7400
Cuando lo exporto e importo
Entonces el workspace nuevo tiene las mismas reglas y la misma cobertura
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
