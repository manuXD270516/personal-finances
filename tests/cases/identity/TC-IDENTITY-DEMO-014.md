---
id: TC-IDENTITY-DEMO-014
title: "Cargar la demo no altera ningún dato del workspace real"
spec: identity/demo-data
related_specs: ["ledger/balances"]
requirement: "Datos demo aislados en un workspace dedicado"
scenario: "El workspace real no cambia"
requirement_status: confirmed
fr: ["FR-IDENTITY-013"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-data.int.test.ts","tests/e2e/specs/demo-data.spec.ts"]
status: automated
regression_suite: true
phase: 1
tags: ["demo-data","isolation"]
error_code: null
preconditions:
  - "\"W1 Personal Demo\" con \"Banco Real\" en 1500.00 BOB"
input: {"action":"POST W1/demo-data"}
steps:
  - "Tomar conteos de asientos, transacciones y auditoría de W1"
  - "Cargar la demo hasta READY"
  - "Volver a contar y consultar el saldo de \"Banco Real\""
expected_result:
  - "\"Banco Real\" sigue en 1500.00 BOB"
  - "Los conteos de asientos y transacciones de W1 no cambian"
  - "La auditoría de W1 solo agrega los registros de la acción de carga"
created: 2026-10-03
updated: 2026-10-04
---

# TC-IDENTITY-DEMO-014 — Cargar la demo no altera ningún dato del workspace real

## Intención

El aislamiento es la razón de ser del workspace dedicado (ADR-0026).

## Escenario

```gherkin
Dado "Banco Real" en 1500.00 BOB en W1
Cuando cargo los datos de demostración
Entonces "Banco Real" sigue en 1500.00 BOB
  Y W1 no tiene asientos ni transacciones nuevas
```

## Notas

