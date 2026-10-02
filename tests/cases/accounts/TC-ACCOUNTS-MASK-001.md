---
id: TC-ACCOUNTS-MASK-001
title: "El identificador de la cuenta se conserva y muestra solo con sus últimos 4 caracteres"
spec: accounts/account-management
related_specs: ["audit/audit-trail"]
requirement: "Identificador de cuenta enmascarado"
scenario: "Identificador ingresado completo"
requirement_status: confirmed
fr: [FR-ACCOUNTS-002]
nfr: [NFR-SEC-015]
invariants: []
priority: high
type: security
level: e2e
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["accounts", "privacy"]
error_code: "VALIDATION_FAILED"
preconditions: ["Bank A en W1", "Compose core con Minimal Seed"]
input:
  ui_value: "DEMO-000123456789"
  api_value_too_long: "123456789"
steps:
  - "En la UI, ingresar el identificador completo en Bank A y guardar"
  - "Inspeccionar la request enviada, la fila de la cuenta, la auditoría, el outbox y los logs"
  - "Enviar por API accountNumberLast4 = \"123456789\""
expected_result:
  - "La UI muestra \"•••• 6789\" y la request solo contiene \"6789\""
  - "Ni la base de datos, ni la auditoría, ni los eventos, ni los logs contienen \"DEMO-000123456789\""
  - "El valor de 9 caracteres por API se rechaza con VALIDATION_FAILED"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-MASK-001 — El identificador de la cuenta se conserva y muestra solo con sus últimos 4 caracteres

## Intención

Minimización de datos (docs/12 §13): un número de cuenta completo no aporta valor y aumenta el riesgo.

## Escenario

```gherkin
Cuando el usuario ingresa "DEMO-000123456789" como identificador de "Bank A"
Entonces la cuenta muestra "•••• 6789"
  Y el identificador completo no se almacena en ningún lugar
```
