---
id: TC-ACCOUNTS-INSTITUTION-001
title: "El usuario crea instituciones configurables con tipo, país y datos de presentación"
spec: accounts/institutions
related_specs: []
requirement: "Alta de institución configurable"
scenario: "Crear un exchange"
requirement_status: confirmed
fr: [FR-ACCOUNTS-012]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["institutions"]
error_code: "VALIDATION_FAILED"
preconditions: ["Usuario EDITOR en W1", "Usuario VIEWER en W1"]
input:
  - {as: "EDITOR", body: {name: "P2P Exchange Demo", kind: "EXCHANGE", countryCode: "BO", icon: "exchange", color: "#F0B90B", website: "https://p2p.demo.pfos.test"}, expected: 201}
  - {as: "EDITOR", body: {name: "Banco X", kind: "BANK", countryCode: "Bolivia"}, expected: "VALIDATION_FAILED"}
  - {as: "EDITOR", body: {name: "Fintech Y", kind: "FINTECH"}, expected: 201}
  - {as: "VIEWER", body: {name: "Banco Z", kind: "BANK"}, expected: "INSUFFICIENT_ROLE"}
steps: ["POST /institutions con cada body"]
expected_result:
  - "P2P Exchange Demo queda activa con los datos enviados y se audita su creación"
  - "País \"Bolivia\" se rechaza con VALIDATION_FAILED"
  - "Fintech Y se crea sin país"
  - "VIEWER recibe 403 INSUFFICIENT_ROLE"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-INSTITUTION-001 — El usuario crea instituciones configurables con tipo, país y datos de presentación

## Intención

FR-ACCOUNTS-012: las instituciones son datos del usuario, no del producto.

## Escenario

```gherkin
Cuando un usuario EDITOR crea la institución "P2P Exchange Demo" de tipo exchange con país "BO"
Entonces la institución queda activa y disponible para asociarla a cuentas
```
