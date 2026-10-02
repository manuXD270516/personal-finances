---
id: TC-LEDGER-INTEGRITY-001
title: El verificador de invariantes detecta un snapshot divergente y emite alerta
spec: ledger/balances
related_specs: []
requirement: Verificación periódica de invariantes del ledger
scenario: Snapshot divergente detectado
requirement_status: confirmed
fr: [FR-LEDGER-015]
nfr: [NFR-DATA-008, NFR-OBS-004, NFR-OBS-005]
invariants: [INV-004, INV-005, INV-008, INV-022]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [invariants, observability]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers
- Bank A con postings que suman 595.50 BOB
- Snapshot de Bank A alterado a 600.00 BOB con el rol de mantenimiento (simula corrupción de caché)
input:
  job: VerifyLedgerIntegrity
steps:
- Ejecutar VerifyLedgerIntegrity sobre el ledger íntegro
- Alterar el snapshot y ejecutar de nuevo
expected_result:
- 'Primera ejecución: sin violaciones, sin alertas, métrica ledger_invariant_violations_total sin cambios'
- 'Segunda ejecución: reporta INV-022 con la cuenta, la fecha y la diferencia 4.50 BOB'
- Se emite un log de nivel error con workspaceId, se incrementa la métrica y se dispara la alerta crítica
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-INTEGRITY-001 — El verificador de invariantes detecta un snapshot divergente y emite alerta

## Intención

NFR-DATA-008: una violación de invariante debe detectarse en minutos, no cuando el usuario ve un saldo incorrecto.

## Escenario

```gherkin
Dado un snapshot de "Bank A" de 600.00 BOB y postings que suman 595.50 BOB
Cuando se ejecuta la verificación de invariantes
Entonces se reporta una diferencia de 4.50 BOB
  Y se emite una alerta crítica
```
