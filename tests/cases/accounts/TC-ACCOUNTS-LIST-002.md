---
id: TC-ACCOUNTS-LIST-002
title: "El listado de cuentas se filtra por tipo, moneda, estado, institución y etiqueta y se agrupa"
spec: accounts/account-management
related_specs: ["accounts/institutions", "classification/tags"]
requirement: "Filtros y agrupación del listado de cuentas"
scenario: "Filtro por moneda y tipo"
requirement_status: confirmed
fr: [FR-ACCOUNTS-010]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/accounts.api.test.ts
  - packages/contexts/accounts/src/application/accounts.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "filters"]
error_code: "INVALID_FILTER"
preconditions:
  - "Bank A (bank, BOB, Banco Andino Demo, tag Sueldo), USD Savings (savings, USD, Banco Andino Demo), Credit Card (credit_card, BOB, sin institución), Old Bank (bank, BOB, archivada)"
input:
  - {query: "currency=BOB&type=BANK", expected: ["Bank A"]}
  - {query: "currency=BOB&type=BANK&status=ARCHIVED&includeArchived=true", expected: ["Old Bank"]}
  - {query: "tagId=<Sueldo>", expected: ["Bank A"]}
  - {query: "institutionId=<Banco Andino Demo>", expected: ["Bank A", "USD Savings"]}
  - {query: "groupBy=institution", expected: "grupos Banco Andino Demo [Bank A, USD Savings] y sin institución [Credit Card]"}
  - {query: "type=CHECKING", expected: "VALIDATION_FAILED o INVALID_FILTER"}
steps: ["Ejecutar cada consulta GET /accounts"]
expected_result:
  - "Cada consulta devuelve exactamente las cuentas esperadas"
  - "La agrupación por institución incluye un grupo propio para cuentas sin institución"
  - "Un valor de filtro inválido se rechaza con 400"
created: 2026-10-02
updated: 2026-10-04
---

# TC-ACCOUNTS-LIST-002 — El listado de cuentas se filtra por tipo, moneda, estado, institución y etiqueta y se agrupa

## Intención

FR-ACCOUNTS-010: con muchas cuentas (fiat, cripto, tarjetas) el usuario necesita encontrar y agrupar rápido.

## Escenario

```gherkin
Dado "Bank A" (bank, BOB), "USD Savings" (savings, USD) y "Credit Card" (credit_card, BOB)
Cuando el usuario filtra moneda BOB y tipo bank
Entonces el listado contiene solo "Bank A"
```
