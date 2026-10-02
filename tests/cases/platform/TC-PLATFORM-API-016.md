---
id: TC-PLATFORM-API-016
title: Un cursor manipulado o de otros filtros se rechaza con INVALID_CURSOR
spec: platform/api-conventions
related_specs: []
requirement: Rechazo de cursores inválidos
scenario: null
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-012
nfr:
- NFR-SEC-009
invariants:
- INV-025
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- pagination
- cursor
- security
error_code: INVALID_CURSOR
preconditions:
- W1 con más de 50 transacciones en BOB y USD
input:
- caso: un byte del nextCursor alterado
- caso: cursor de currency=BOB usado con currency=USD
- caso: cursor de W1 usado en la ruta de W2 por un miembro de ambos
steps:
- Obtener un nextCursor válido
- Enviar cada variante
expected_result:
- 'Las tres variantes: 400 problem+json con código INVALID_CURSOR y sin datos'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-016 — Un cursor manipulado o de otros filtros se rechaza con INVALID_CURSOR

## Intención

Un cursor forjado no debe permitir saltos arbitrarios ni cruzar workspaces (docs/10 §5.1).

## Escenario

```gherkin
Dado un "nextCursor" recibido
Cuando el cliente altera un byte y lo envía
Entonces la respuesta es 400 con código "INVALID_CURSOR"
```
