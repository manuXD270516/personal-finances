---
id: TC-CLASSIFICATION-COUNTERPARTY-003
title: Archivar una counterparty conserva sus transacciones
spec: classification/counterparties
related_specs: []
requirement: Las counterparties se archivan en lugar de eliminarse
scenario: Archivar una counterparty con historial
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
nfr: []
invariants: [INV-019]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [counterparties, archive]
error_code: null
preconditions:
- Counterparty "Entel" con 12 pagos que suman 1,440.00 BOB (120.00 BOB cada uno)
input:
  archive: Entel
  delete_request: DELETE /api/v1/workspaces/{W1}/counterparties/{Entel}
steps:
- Enviar el DELETE
- Archivar "Entel"
- Consultar los movimientos de "Entel"
expected_result:
- El DELETE responde 405 y nada cambia
- Los 12 pagos siguen referenciando "Entel"
- El historial de "Entel" sigue sumando 1,440.00 BOB
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-COUNTERPARTY-003 — Archivar una counterparty conserva sus transacciones

## Intención

INV-019 aplicado a counterparties.

## Escenario

```gherkin
Dada "Entel" con 12 pagos por 1,440.00 BOB
Cuando se archiva
Entonces los 12 pagos siguen referenciándola
```
