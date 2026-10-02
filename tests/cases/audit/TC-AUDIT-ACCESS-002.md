---
id: TC-AUDIT-ACCESS-002
title: VIEWER ve el historial de una transacción pero no el log de auditoría
spec: audit/audit-trail
related_specs: []
requirement: Lectura de auditoría restringida por rol
scenario: VIEWER ve el historial de una transacción
requirement_status: confirmed
fr:
- FR-AUDIT-004
- FR-TRANSACTIONS-014
nfr: []
invariants:
- INV-029
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- audit
- rbac
error_code: INSUFFICIENT_ROLE
preconditions:
- W1 con un VIEWER
- Gasto de 45.90 BOB editado
steps:
- Como VIEWER abrir el historial del gasto
- Como VIEWER consultar /audit-log
expected_result:
- El historial del gasto se devuelve
- /audit-log responde 403 INSUFFICIENT_ROLE
created: '2026-10-02'
updated: '2026-10-02'
---

# TC-AUDIT-ACCESS-002 — VIEWER ve el historial de una transacción pero no el log de auditoría

## Intención

Decisión del owner 2026-10-02 (D28, docs/31).

## Escenario

```gherkin
Dado un VIEWER de "W1" y un gasto editado de 45.90 BOB
Cuando abre el historial del gasto
Entonces obtiene su historial
Y al consultar el log de auditoría recibe INSUFFICIENT_ROLE
```
