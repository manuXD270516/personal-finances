---
id: TC-IDENTITY-WORKSPACE-008
title: Cambiar el workspace activo muestra solo datos del workspace elegido
spec: identity/workspace-membership
related_specs: []
requirement: Selección del workspace activo
scenario: Cambiar de workspace activo
requirement_status: confirmed
fr:
- FR-IDENTITY-007
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
- tests/e2e/specs/workspace-identity.spec.ts
status: automated
regression_suite: false
phase: 1
tags:
- workspace
- ui
error_code: null
preconditions:
- Stack core con Minimal Seed; owner autenticado con W1 activo
input:
  workspace_destino: W2 Other Demo
steps:
- Elegir W2 Other Demo en el selector
- Abrir la vista de cuentas
- Interceptar las peticiones del navegador al BFF
expected_result:
- La vista de cuentas muestra W2 Bank con 5000.00 BOB y ninguna cuenta de W1
- Todas las peticiones de negocio llevan el id de W2 en la ruta
created: 2026-10-02
updated: 2026-10-04
---

# TC-IDENTITY-WORKSPACE-008 — Cambiar el workspace activo muestra solo datos del workspace elegido

## Intención

El servidor nunca infiere workspace; la elección vive en el cliente y viaja en la ruta (ARCHITECTURE §8).

## Escenario

```gherkin
Dado que "owner" tiene "W1 Personal Demo" como workspace activo
Cuando elige "W2 Other Demo"
Entonces ve la cuenta "W2 Bank" con 5000.00 BOB
  Y no ve cuentas de "W1 Personal Demo"
```

## Notas

- Requirement Should.
- Automatizado (2026-10-04, add-workspace-identity 9.2) en `tests/e2e/specs/workspace-identity.spec.ts`: owner elige W1 y luego W2 en el selector de la vista de cuentas; se verifica "W2 Bank" con 5.000,00 BOB, ninguna cuenta de W1 y que toda petición de negocio interceptada lleva el id de W2 en la ruta. "W2 Bank" no es parte de la Minimal Seed: la prueba la crea una vez (idempotente) en W2.
