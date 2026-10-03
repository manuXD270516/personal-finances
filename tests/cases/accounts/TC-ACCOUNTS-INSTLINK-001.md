---
id: TC-ACCOUNTS-INSTLINK-001
title: "Una cuenta puede asociarse a una institución de su workspace y nunca a una ajena"
spec: accounts/account-management
related_specs: ["accounts/institutions"]
requirement: "Institución opcional de la cuenta"
scenario: "Institución de otro workspace"
requirement_status: confirmed
fr: [FR-ACCOUNTS-002]
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "institutions", "multi-tenant"]
error_code: "REFERENCE_NOT_FOUND"
preconditions: ["Institución \"Banco Andino Demo\" en W1", "Institución \"Banco W2\" en W2", "Usuario EDITOR de W1"]
input:
  - {name: "Bank C", type: "BANK", currency: "BOB", institution: "Banco Andino Demo"}
  - {name: "Bank G", type: "BANK", currency: "BOB", institution: "Banco W2"}
  - {name: "Cash", type: "CASH", currency: "BOB", institution: null}
steps: ["Crear las tres cuentas en W1"]
expected_result:
  - "Bank C se crea mostrando la institución Banco Andino Demo"
  - "Bank G se rechaza con REFERENCE_NOT_FOUND (422) sin revelar que la institución existe en W2"
  - "Cash se crea sin institución"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-INSTLINK-001 — Una cuenta puede asociarse a una institución de su workspace y nunca a una ajena

## Intención

La FK compuesta con workspace y RLS impiden enlaces cruzados entre workspaces (docs/08 §1.3).

## Escenario

```gherkin
Cuando el usuario de "W1" crea una cuenta asociada a una institución de "W2"
Entonces se rechaza con REFERENCE_NOT_FOUND
```
