---
id: TC-RULES-ENGINE-044
title: "La cobertura de tres meses informa el desglose y el cociente"
spec: rules/rule-engine
related_specs: []
requirement: "Cobertura de clasificación por reglas"
scenario: "Tres meses importados"
requirement_status: provisional
fr: ["FR-RULES-010", "FR-IMPORTS-008"]
nfr: []
invariants: []
priority: critical
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
  - "Datos sintéticos 2026-07-01..2026-09-30: 200 importadas (148 RULE, 20 COUNTERPARTY_DEFAULT, 12 MANUAL, 20 SYSTEM_DEFAULT), más transferencias y conversiones importadas"
input: {"from":"2026-07-01","to":"2026-09-30"}
steps:
  - "GET W/rules/coverage"
expected_result:
  - "total 200; RULE 148; COUNTERPARTY_DEFAULT 20; MANUAL 12; SYSTEM_DEFAULT 20"
  - "ruleCoverage \"0.7400\", target \"0.7000\""
  - "Transferencias y conversiones excluidas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-044 — La cobertura de tres meses informa el desglose y el cociente

## Intención

Medida exacta del criterio de salida (design decisión 11).

## Escenario

```gherkin
Dadas 200 transacciones importadas en tres meses, 148 por reglas
Cuando consulto la cobertura
Entonces el cociente es 0.7400 y cumple la meta 0.7000
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
