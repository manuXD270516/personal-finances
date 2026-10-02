---
id: TC-PLATFORM-API-002
title: El quality gate falla ante un cambio incompatible del contrato v1
spec: platform/api-conventions
related_specs: []
requirement: Detección de cambios incompatibles del contrato
scenario: Campo eliminado de una respuesta
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-009
invariants: []
priority: high
type: platform
level: contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- contract
- ci
- oasdiff
error_code: null
preconditions:
- Contrato de main como base
- Fixtures de contrato modificado
input:
- cambio: eliminar Workspace.baseCurrency
- cambio: cambiar el status 201 de createWorkspace a 200
- cambio: agregar un campo opcional a Workspace
steps:
- Ejecutar oasdiff breaking contra main con cada fixture
expected_result:
- 'Eliminar campo o cambiar status: el chequeo falla nombrando el cambio'
- 'Campo opcional agregado: el chequeo pasa'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-002 — El quality gate falla ante un cambio incompatible del contrato v1

## Intención

Un breaking change silencioso rompería al BFF y a clientes futuros (NFR-MAINT-009).

## Escenario

```gherkin
Dada una pull request que elimina el campo "baseCurrency" de la respuesta de workspace
Cuando corre el quality gate
Entonces el chequeo de compatibilidad falla
```
