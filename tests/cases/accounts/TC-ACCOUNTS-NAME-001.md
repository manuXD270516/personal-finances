---
id: TC-ACCOUNTS-NAME-001
title: "El nombre de cuenta es único entre cuentas activas sin distinguir mayúsculas"
spec: accounts/account-management
related_specs: []
requirement: "Nombre único entre cuentas activas"
scenario: "Nombre repetido"
requirement_status: confirmed
fr: [FR-ACCOUNTS-002]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["accounts", "naming"]
error_code: "ACCOUNT_NAME_TAKEN"
preconditions: ["Bank A activa en W1", "Old Bank archivada en W1", "W2 Bank activa en W2"]
input:
  - {name: "bank a", expected: "ACCOUNT_NAME_TAKEN"}
  - {name: "Old Bank", expected: "creada"}
  - {name: "W2 Bank", expected: "creada en W1"}
steps: ["Crear en W1 una cuenta con cada nombre"]
expected_result:
  - "\"bank a\" se rechaza con ACCOUNT_NAME_TAKEN (409)"
  - "\"Old Bank\" se crea porque la homónima está archivada"
  - "\"W2 Bank\" se crea en W1 porque la unicidad es por workspace"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-NAME-001 — El nombre de cuenta es único entre cuentas activas sin distinguir mayúsculas

## Intención

Evita confusiones al elegir cuenta en formularios (FR-ACCOUNTS-002) sin bloquear nombres de cuentas archivadas.

## Escenario

```gherkin
Dado la cuenta activa "Bank A"
Cuando el usuario crea otra cuenta llamada "bank a"
Entonces se rechaza con ACCOUNT_NAME_TAKEN
```
