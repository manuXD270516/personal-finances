---
id: TC-CLASSIFICATION-MERGE-026
title: "Suscripción, préstamo y regla pasan a la contraparte destino"
spec: classification/counterparties
related_specs: ["commitments/subscriptions","debt/loans","rules/rule-engine"]
requirement: "Referencias a la contraparte fusionada en otros contextos"
scenario: "Suscripción, préstamo y regla"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-013","FR-COMMITMENTS-012","FR-DEBT-001","FR-RULES-001"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","counterparties","subscriptions","loans","rules"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; suscripción \"Seguro de desgravamen\" de 25.00 BOB de \"BANCO UNO S.A.\"; préstamo \"Préstamo vehicular\" con prestamista \"BANCO UNO S.A.\"; regla \"BANCO UNO\" con SET_COUNTERPARTY \"BANCO UNO S.A.\""
input: {}
steps:
  - "se fusiona \"BANCO UNO S.A.\" en \"Banco Uno\""
expected_result:
  - "\"Seguro de desgravamen\" es de \"Banco Uno\" con precio 25.00 BOB y su historial de precios sin cambios"
  - "\"Préstamo vehicular\" tiene como prestamista a \"Banco Uno\""
  - "\"BANCO UNO\" tiene una versión nueva con SET_COUNTERPARTY \"Banco Uno\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-026 — Suscripción, préstamo y regla pasan a la contraparte destino

## Intención

Verifica el scenario "Suscripción, préstamo y regla" del requirement "Referencias a la contraparte fusionada en otros contextos" de `classification/counterparties` (FR-CLASSIFICATION-013, FR-COMMITMENTS-012, FR-DEBT-001, FR-RULES-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; suscripción "Seguro de desgravamen" de 25.00 BOB de "BANCO UNO S.A."; préstamo "Préstamo vehicular" con prestamista "BANCO UNO S.A."; regla "BANCO UNO" con SET_COUNTERPARTY "BANCO UNO S.A."
Cuando se fusiona "BANCO UNO S.A." en "Banco Uno"
Entonces "Seguro de desgravamen" es de "Banco Uno" con precio 25.00 BOB y su historial de precios sin cambios
Y "Préstamo vehicular" tiene como prestamista a "Banco Uno"
Y "BANCO UNO" tiene una versión nueva con SET_COUNTERPARTY "Banco Uno"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
