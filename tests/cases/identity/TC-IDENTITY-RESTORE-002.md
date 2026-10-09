---
id: TC-IDENTITY-RESTORE-002
title: "La ida y vuelta export e import reproduce saldos, balance y patrimonio"
spec: identity/workspace-portability
related_specs: ["ledger/balances", "reporting/net-worth"]
requirement: "La ida y vuelta reproduce saldos e historia"
scenario: "Saldos idénticos tras la ida y vuelta"
requirement_status: confirmed
fr: [FR-IDENTITY-017, FR-IDENTITY-010]
nfr: [NFR-REL-014]
invariants: [INV-004, INV-022, INV-031]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export.api.test.ts","apps/api/test/db/workspace-roundtrip-large.int.test.ts","tests/e2e/specs/workspace-export.spec.ts"]
status: automated
regression_suite: true
phase: 2
tags: ["restore", "round-trip", "money", "exit-criteria"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
input:
  roundTrip: true
steps:
  - "Exportar \"W1\""
  - "Importar el archivo"
  - "Comparar saldos por cuenta y moneda, balance de comprobación y patrimonio con la misma tasa"
expected_result:
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, \"Visa\" deuda 520.00 BOB"
  - "Balance de comprobación Σ 0 en BOB y en USDT"
  - "Patrimonio 3180.10 BOB en ambos (3099.10 + 601.00 − 520.00)"
  - "VerifyLedgerIntegrity sin violaciones"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-002 — La ida y vuelta export e import reproduce saldos, balance y patrimonio

## Intención

Criterio de salida de Phase 2 (docs/24 §5.2) y NFR-REL-014; base del test nightly con el dataset large.

## Escenario

```gherkin
Dado "W1" con "Bank A" 3099.10 BOB, "Wallet USDT" 50.000000 USDT y "Visa" con deuda 520.00 BOB
Cuando se exporta y se importa
Entonces el workspace restaurado tiene los mismos saldos
  Y con USDT/BOB 12.02 su patrimonio neto es 3180.10 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
