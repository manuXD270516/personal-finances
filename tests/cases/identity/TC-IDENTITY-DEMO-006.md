---
id: TC-IDENTITY-DEMO-006
title: "Limpiar o purgar un workspace real se rechaza sin borrar nada"
spec: identity/demo-data
related_specs: ["ledger/journal-posting","audit/audit-trail"]
requirement: "La purga nunca afecta a un workspace real"
scenario: "Limpiar un workspace real"
requirement_status: confirmed
fr: ["FR-IDENTITY-015","FR-LEDGER-005"]
nfr: ["NFR-DATA-012","NFR-SEC-003"]
invariants: ["INV-007","INV-029"]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["demo-data","purge","security"]
error_code: WORKSPACE_NOT_DEMO
preconditions:
  - "\"W1 Personal Demo\" real con \"Banco Real\" en 1500.00 BOB, sus asientos y su auditoría"
input: {"api":"POST W1/demo-data/cleanup","db":"SELECT platform.purge_demo_workspace(W1) como pf_worker; y como pf_app con SET pf.demo_purge_workspace = W1 seguido de DELETE"}
steps:
  - "El OWNER de W1 ejecuta \"Limpiar datos de demostración\" sobre W1"
  - "Invocar directamente la purga física sobre W1"
  - "Como pf_app, fijar la GUC de purga e intentar DELETE de postings de W1"
expected_result:
  - "La API responde 409 WORKSPACE_NOT_DEMO"
  - "La función de purga falla con PF006 sin borrar filas"
  - "El DELETE directo falla (sin grant / PF003)"
  - "\"Banco Real\" sigue en 1500.00 BOB y el número de asientos y registros de auditoría de W1 no cambia"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-006 — Limpiar o purgar un workspace real se rechaza sin borrar nada

## Intención

Barrera crítica de ADR-0026: la ruta de purga jamás puede alcanzar datos reales.

## Escenario

```gherkin
Dado "W1 Personal Demo" real con "Banco Real" en 1500.00 BOB
Cuando se intenta limpiarlo o purgarlo por la API o directamente en la base
Entonces todas las vías se rechazan
  Y "Banco Real" sigue en 1500.00 BOB con todos sus asientos y su auditoría
```

## Notas

- Cubre también el scenario "Purga directa de un workspace real".
