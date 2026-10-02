---
id: TC-PLATFORM-API-015
title: La paginación por cursor recorre la colección sin omitir ni repetir elementos
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Paginación por cursor
scenario: Recorrido completo de una colección
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-012
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- packages/platform/src/api/pagination/cursor-codec.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- pagination
- cursor
error_code: null
preconditions:
- W1 con 120 transacciones, varias con la misma fecha de negocio (empates de orden)
input:
- limit: 50
- limit: 500
steps:
- Listar con limit=50 siguiendo nextCursor hasta hasMore=false
- Listar con limit=500
expected_result:
- Páginas de 50, 50 y 20; la última con hasMore false y nextCursor null; cada transacción aparece exactamente una vez
- 'limit=500: 400 VALIDATION_FAILED'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-015 — La paginación por cursor recorre la colección sin omitir ni repetir elementos

## Intención

Omitir o repetir transacciones en listas falsearía conteos y conciliaciones.

## Escenario

```gherkin
Dado un workspace con 120 transacciones
Cuando se listan con "limit=50" siguiendo "nextCursor"
Entonces se obtienen 3 páginas con 50, 50 y 20 elementos
  Y cada transacción aparece exactamente una vez
```

## Notas

- Mientras add-transaction-recording no exista, se verifica sobre GET /api/v1/workspaces con un usuario con 120 workspaces sembrados.
