---
id: TC-FX-PROVIDER-025
title: "Un par configurado que ningún provider publica se informa cubierto solo por tasas manuales"
spec: fx/market-rate-providers
related_specs: []
requirement: "Registro automático solo para los pares configurados"
scenario: "Par sin provider"
requirement_status: provisional
fr: ["FR-FX-009", "FR-FX-016"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "coverage"]
error_code: null
preconditions:
  - "W1 con EUR habilitada y EUR/BOB en su lista"
input: {"pair": "EUR/BOB"}
steps:
  - "GET W/fx-rate-pairs"
  - "Ejecutar un ciclo de polling"
expected_result:
  - "EUR/BOB figura con coverage MANUAL_ONLY y sin providers"
  - "El ciclo registra con normalidad los demás pares"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-025 — Un par configurado que ningún provider publica se informa cubierto solo por tasas manuales

## Intención

El owner debe saber qué pares no cumplirán el criterio de 30 días sin intervención.

## Escenario

```gherkin
Dado EUR/BOB configurado
Cuando se consulta la lista
Entonces EUR/BOB figura solo manual
```

## Notas

