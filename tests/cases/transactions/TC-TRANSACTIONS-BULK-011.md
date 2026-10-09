---
id: TC-TRANSACTIONS-BULK-011
title: "Solo EDITOR u OWNER ejecutan ediciones masivas y nunca sobre otro workspace"
spec: transactions/bulk-edit
related_specs: ["security/access-control"]
requirement: "Edición masiva restringida por rol"
scenario: "VIEWER intenta una edición masiva"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-IDENTITY-006]
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: critical
type: security
level: security
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "rbac", "rls"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "Usuario VIEWER y usuario EDITOR en \"W1\""
  - "Gasto X de \"W2\""
input:
  - "{\"role\":\"VIEWER\",\"items\":[\"T1\",\"T2\"]}"
  - "{\"role\":\"EDITOR\",\"items\":[\"T1\",\"X (W2)\"]}"
steps:
  - "VIEWER envía el lote"
  - "EDITOR envía el lote con X"
expected_result:
  - "403 INSUFFICIENT_ROLE; nada cambia"
  - "404 RESOURCE_NOT_FOUND para X, idéntico a un id inexistente; nada cambia en \"W1\" ni en \"W2\""
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-011 — Solo EDITOR u OWNER ejecutan ediciones masivas y nunca sobre otro workspace

## Intención

NFR-SEC-003: RBAC en aplicación más RLS como defensa en profundidad.

## Escenario

```gherkin
Dado un VIEWER de "W1"
Cuando envía una recategorización en lote de dos gastos de "W1"
Entonces se rechaza con "INSUFFICIENT_ROLE"
  Y ninguno cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
