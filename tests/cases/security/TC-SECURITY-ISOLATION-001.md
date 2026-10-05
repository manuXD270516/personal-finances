---
id: TC-SECURITY-ISOLATION-001
title: Un recurso de otro workspace es indistinguible de uno inexistente
spec: security/access-control
related_specs: []
requirement: Recursos de otro workspace indistinguibles de inexistentes
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-006
nfr:
- NFR-SEC-003
invariants:
- INV-025
priority: critical
type: security
level: api
automation_status: automated
automated_tests:
  - tests/e2e/specs/workspace-identity.spec.ts
  - apps/api/test/api/isolation.api.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- isolation
- multi-tenancy
- property-based
error_code: RESOURCE_NOT_FOUND
preconditions:
- 'Minimal Seed: owner es miembro de W1 y W2; editor es EDITOR solo de W1; W2 Bank (5000.00 BOB) pertenece a W2'
input:
- usuario: owner
  request: GET /api/v1/workspaces/{W1}/accounts/{W2Bank}
- usuario: editor
  request: POST /api/v1/workspaces/{W1}/transactions
  body:
    accountId: '{W2Bank}'
    amount:
      amount: '75.00'
      currency: BOB
- usuario: editor
  request: operaciones aleatorias del contrato con IDs de W2 (property-based, fast-check)
steps:
- Enviar cada solicitud
- Buscar el id, el nombre y el saldo de W2 Bank en los cuerpos de respuesta
expected_result:
- 'Ruta: 404 RESOURCE_NOT_FOUND sin nombre ni saldo de W2 Bank'
- 'Cuerpo: 422 REFERENCE_NOT_FOUND y no se registra nada'
- 'Property-based: toda respuesta es 403, 404 o 422 y nunca contiene identificadores de W2'
created: 2026-10-02
updated: 2026-10-04
---

# TC-SECURITY-ISOLATION-001 — Un recurso de otro workspace es indistinguible de uno inexistente

## Intención

Un ID adivinado o filtrado de otro workspace no debe revelar ni afectar datos ajenos (docs/10 §3, docs/12 §5).

## Escenario

```gherkin
Dado que "owner" es miembro de "W1" y la cuenta "W2 Bank" pertenece a "W2"
Cuando solicita "W2 Bank" bajo la ruta de "W1"
Entonces la respuesta es 404 con código "RESOURCE_NOT_FOUND"
  Y no se revela el saldo de 5000.00 BOB
```

## Notas

- Requiere add-accounts-management y add-transaction-recording para los endpoints de negocio; el caso de ruta se ejecuta desde add-accounts-management.
- Automatizado (2026-10-04, add-workspace-identity 9.2) a través del BFF en `tests/e2e/specs/workspace-identity.spec.ts`: ruta (404 `RESOURCE_NOT_FOUND`, igual que un id inexistente, sin nombre/saldo/ids de W2; también la URL manipulada en la UI), cuerpo (422 `REFERENCE_NOT_FOUND` y no se registra nada) y un barrido determinista de operaciones de cuentas, transferencias y transacciones con ids de W2 bajo W1 (toda respuesta 403/404/422, sin identificadores de W2). Pendiente: la variante property-based con fast-check a nivel API (operaciones aleatorias del contrato).
- Automatizado 2026-10-04 (add-workspace-identity 7.2) a nivel API: en lugar de una muestra aleatoria (fast-check), recorre TODAS las operaciones implementadas del contrato con un id de recurso en la ruta (OWNER de W1 y W2, y EDITOR solo de W1) y las operaciones de colección que reciben ids en el cuerpo; cada respuesta con un id de W2 es idéntica (estado y código) a la de un id inexistente, nunca 2xx ni datos de W2, y W2 queda intacto. El recorrido E2E por URLs sigue en add-workspace-identity 9.2.
