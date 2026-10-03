---
id: TC-IDENTITY-SESSION-002
title: El BFF rechaza mutaciones sin token anti-CSRF o desde otro origen
spec: identity/authentication
related_specs: []
requirement: Protección CSRF en mutaciones vía BFF
scenario: Mutación sin token anti-CSRF
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-008
invariants: []
priority: critical
type: security
level: container-integration
automation_status: automated
automated_tests:
- apps/web/test/integration/bff.int.test.ts
- apps/web/src/bff/csrf.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- csrf
- bff
error_code: CSRF_REJECTED
preconditions:
- BFF con sesión válida del editor de W1
- Espía de peticiones en finance-api
input:
- metodo: POST
  ruta: /api/bff/v1/workspaces/{W1}/transactions
  csrf: ausente
  origin: app
  body:
    amount:
      amount: '75.00'
      currency: BOB
- metodo: POST
  csrf: válido
  origin: https://evil.example
- metodo: POST
  csrf: válido
  origin: app
steps:
- Enviar cada petición al BFF
expected_result:
- 'Sin token o con Origin ajeno: 403 problem+json con código CSRF_REJECTED; finance-api no recibe la petición; no se registra el gasto de 75.00 BOB'
- 'Con token válido y Origin propio: la petición se reenvía a finance-api'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-SESSION-002 — El BFF rechaza mutaciones sin token anti-CSRF o desde otro origen

## Intención

SameSite=Lax no cubre todos los vectores; el synchronizer token y el chequeo de Origin cierran el resto (docs/12 §3).

## Escenario

```gherkin
Dado un usuario autenticado
Cuando envía un POST para registrar un gasto de 75.00 BOB sin token anti-CSRF
Entonces la respuesta es 403
  Y la API no recibe la petición
```

## Notas

- CSRF_REJECTED es un código propio del BFF (no del contrato de finance-api).
