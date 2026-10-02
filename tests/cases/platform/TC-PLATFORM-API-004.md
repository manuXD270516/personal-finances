---
id: TC-PLATFORM-API-004
title: Los errores usan problem+json con code, requestId y errores por campo, sin filtrar internos
spec: platform/api-conventions
related_specs: []
requirement: Errores en formato Problem Details
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-009
- NFR-USAB-009
invariants:
- INV-001
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- errors
- rfc9457
error_code: INTERNAL_ERROR
preconditions:
- finance-api bajo prueba; controller de prueba que lanza una excepción no controlada
- EDITOR de W1
input:
- request: POST de un gasto con split de 75.001 BOB
- request: GET /api/v1/_test/boom
steps:
- Enviar cada solicitud
- Buscar el requestId en los logs
expected_result:
- 'Split 75.001 BOB: 422 application/problem+json con type, title, status, code AMOUNT_SCALE_EXCEEDED, requestId y errors[0].pointer /splits/0/amount'
- 'Excepción: 500 con code INTERNAL_ERROR y requestId presente en los logs'
- Ningún cuerpo contiene stack trace, SQL ni nombres de tablas
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-004 — Los errores usan problem+json con code, requestId y errores por campo, sin filtrar internos

## Intención

La UI traduce por code y soporte correlaciona por requestId; filtrar internos sería una fuga de información.

## Escenario

```gherkin
Cuando una operación falla por una excepción no controlada
Entonces la respuesta es 500 con código "INTERNAL_ERROR" y un "requestId"
  Y el cuerpo no contiene stack trace ni SQL
```
