---
id: TC-AUDIT-ISOLATION-001
title: "La auditoría de un workspace no es visible desde otro workspace"
spec: audit/audit-trail
related_specs: ["security/access-control"]
requirement: "Auditoría aislada por workspace"
scenario: "Consulta de historial de una entidad de otro workspace"
requirement_status: confirmed
fr: [FR-AUDIT-003]
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: critical
type: security
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["audit", "rls", "multi-tenant"]
error_code: null
preconditions:
  - "Minimal Seed: W1 con Bank A y su historial de auditoría; W2 con W2 Bank"
  - "outsider@demo.pfos.test es OWNER solo de W2"
input:
  request: "GET /workspaces/W2/audit-log?aggregateType=Account&aggregateId=<id de Bank A de W1>"
steps:
  - "Consultar como outsider en W2 el historial de Bank A"
  - "Consultar como outsider en W2 un aggregateId inexistente"
  - "Consultar directamente audit.audit_log con app.workspace_id = W2"
expected_result:
  - "Ambas consultas API devuelven 200 con lista vacía, indistinguibles entre sí"
  - "La consulta SQL no devuelve filas de W1"
  - "Sin app.workspace_id la consulta SQL falla (fail-closed) en vez de devolver filas"
created: 2026-10-02
updated: 2026-10-02
---

# TC-AUDIT-ISOLATION-001 — La auditoría de un workspace no es visible desde otro workspace

## Intención

La auditoría contiene montos y actores; filtrarla entre workspaces sería una fuga grave (ADR-0023).

## Escenario

```gherkin
Dado que "Bank A" pertenece a "W1"
Cuando un usuario de "W2" consulta el historial de "Bank A"
Entonces obtiene una lista vacía, igual que para una entidad inexistente
```
