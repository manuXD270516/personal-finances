---
id: TC-TRANSACTIONS-QUICK-015
title: "El VIEWER no ve el acceso Registrar en la barra superior"
spec: transactions/transaction-recording
related_specs: ["security/access-control"]
requirement: "Acceso directo para registrar"
scenario: "Sin acceso para el VIEWER"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-001"]
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/shell/nav.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","rbac"]
error_code: null
preconditions:
  - "un VIEWER con sesión en \"Transacciones\""
input: {}
steps:
  - "el usuario mira la barra superior"
expected_result:
  - "no existe el enlace \"Registrar\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-015 — El VIEWER no ve el acceso Registrar en la barra superior

## Intención

No ofrece una acción que el rol no puede completar (la API la rechazaría con 403).

## Escenario

```gherkin
Dado un VIEWER con sesión en "Transacciones"
Cuando el usuario mira la barra superior
Entonces no existe el enlace "Registrar"
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
