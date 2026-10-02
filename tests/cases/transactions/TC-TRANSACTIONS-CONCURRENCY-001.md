---
id: TC-TRANSACTIONS-CONCURRENCY-001
title: "Una edición con versión obsoleta o sin versión se rechaza sin aplicar cambios"
spec: transactions/transaction-recording
related_specs: ["platform/api-conventions"]
requirement: "Bloqueo optimista en la edición"
scenario: "Dos ediciones con la misma versión"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-011]
nfr: [NFR-DATA-014]
invariants: [INV-023]
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["optimistic-locking", "etag", "api"]
error_code: "PRECONDITION_FAILED"
preconditions:
  - "finance-api con PostgreSQL mediante Testcontainers"
  - "Gasto posteado T1 de 120.00 BOB, versión 1 (ETag \"1\")"
input:
  - request: "PATCH T1 amount 102.00 BOB"
    if_match: "\"1\""
  - request: "PATCH T1 amount 110.00 BOB"
    if_match: "\"1\""
  - request: "POST T1/void"
    if_match: null
steps:
  - "Enviar la primera edición"
  - "Enviar la segunda edición con la misma versión"
  - "Enviar la anulación sin If-Match"
expected_result:
  - "Primera: 200 con ETag \"2\""
  - "Segunda: 412 problem+json con code PRECONDITION_FAILED y currentVersion 2; monto vigente 102.00 BOB; sin asientos adicionales"
  - "Anulación sin If-Match: 428 con code PRECONDITION_REQUIRED; T1 sigue posted"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONCURRENCY-001 — Una edición con versión obsoleta o sin versión se rechaza sin aplicar cambios

## Intención

Evita actualizaciones perdidas sobre datos financieros (NFR-DATA-014).

## Escenario

```gherkin
Dado un gasto de 120.00 BOB en versión 1
Cuando dos ediciones con versión esperada 1 cambian el monto a 102.00 BOB y a 110.00 BOB
Entonces la segunda se rechaza con el código "PRECONDITION_FAILED"
  Y el monto vigente es 102.00 BOB
```

## Notas

- Una carrera detectada en BD después del chequeo de If-Match responde 409 CONCURRENCY_CONFLICT (docs/10 §6); variante con dos escritores simultáneos en el mismo TC.
