---
id: TC-PLATFORM-API-005
title: Todo código de error del catálogo tiene mensaje en español y está en el contrato
spec: platform/api-conventions
related_specs: []
requirement: Catálogo estable de códigos de error
scenario: Código sin mensaje en español
requirement_status: confirmed
fr: []
nfr:
- NFR-USAB-009
- NFR-MAINT-009
invariants: []
priority: high
type: unit
level: contract
automation_status: automated
automated_tests:
- packages/platform/src/api/errors/error-catalog.test.ts
- apps/web/src/errors/error-messages.test.tsx
status: automated
regression_suite: false
phase: 1
tags:
- errors
- i18n
- catalog
error_code: null
preconditions:
- ErrorCatalog de @pf/platform
- ErrorCode del contrato
- Catálogo errors.es.json de finance-web
input:
  fixture: código NUEVO_CODIGO agregado al ErrorCatalog sin mensaje en español
steps:
- Comparar los tres conjuntos de códigos
- Repetir con el fixture
- Renderizar en la UI un problem con code PERIOD_CLOSED
expected_result:
- 'Sin fixture: los tres conjuntos coinciden y el status HTTP de cada código coincide con docs/10 §9.1'
- 'Con fixture: el test falla nombrando NUEVO_CODIGO'
- La UI muestra el mensaje en español de PERIOD_CLOSED y no el title
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-005 — Todo código de error del catálogo tiene mensaje en español y está en el contrato

## Intención

Los códigos son contrato estable para el cliente y la UI nunca muestra códigos crudos (NFR-USAB-009).

## Escenario

```gherkin
Dado un código de error sin mensaje en español
Cuando corre el test de catálogo
Entonces falla indicando el código
```
