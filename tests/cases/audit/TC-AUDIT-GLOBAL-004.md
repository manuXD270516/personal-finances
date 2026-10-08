---
id: TC-AUDIT-GLOBAL-004
title: "Un rechazo por rol insuficiente queda auditado como evento de seguridad"
spec: audit/audit-trail
related_specs: ["security/access-control"]
requirement: "Auditoría de fallos de autorización"
scenario: "VIEWER intenta registrar un gasto"
requirement_status: confirmed
fr: [FR-AUDIT-005]
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["audit", "security"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Usuario VIEWER \"U3\" en \"W1\""
input:
  operation: "createTransaction"
  amount: "45.90"
  description: "Compra"
steps:
  - "U3 intenta registrar el gasto"
  - "Consultar la auditoría de \"W1\" con category=SECURITY"
expected_result:
  - "Respuesta 403 INSUFFICIENT_ROLE"
  - "Registro security.authorization.denied con U3, operación createTransaction y código INSUFFICIENT_ROLE"
  - "El registro no contiene \"45.90\" ni \"Compra\""
  - "Si la escritura de auditoría falla, la respuesta sigue siendo 403"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-004 — Un rechazo por rol insuficiente queda auditado como evento de seguridad

## Intención

FR-AUDIT-005: fallos de autorización visibles para el OWNER.

## Escenario

```gherkin
Dado un VIEWER de "W1"
Cuando intenta registrar un gasto de 45.90 BOB y se rechaza
Entonces la auditoría contiene un evento de seguridad sin el monto ni la descripción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
