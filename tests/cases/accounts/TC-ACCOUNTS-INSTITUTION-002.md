---
id: TC-ACCOUNTS-INSTITUTION-002
title: "Ninguna institución viene fija en el producto y las del catálogo inicial son editables por workspace"
spec: accounts/institutions
related_specs: ["platform/local-environment"]
requirement: "Instituciones no predefinidas en el producto"
scenario: "Institución del catálogo inicial editable"
requirement_status: confirmed
fr: [FR-ACCOUNTS-012]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["institutions", "seed"]
error_code: null
preconditions: ["Migraciones aplicadas sin seed", "Catálogo inicial ficticio con \"Banco Andino Demo\""]
input:
  - {workspace: "W3 nuevo sin catálogo"}
  - {workspace: "W4 nuevo con catálogo inicial", rename: {from: "Banco Andino Demo", to: "Banco Andino"}}
  - {workspace: "W5 nuevo con catálogo inicial"}
steps:
  - "Listar instituciones de W3"
  - "Renombrar la institución en W4 y listar W4 y W5"
  - "Buscar instituciones con workspace_id nulo y nombres de instituciones en el código fuente de dominio/aplicación"
expected_result:
  - "W3 no tiene instituciones"
  - "En W4 la institución se llama Banco Andino; en W5 sigue llamándose Banco Andino Demo"
  - "No existen filas globales de institución ni instituciones literales en el código (solo en archivos de seed)"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-INSTITUTION-002 — Ninguna institución viene fija en el producto y las del catálogo inicial son editables por workspace

## Intención

FR-ACCOUNTS-012: "ninguna institución hardcodeada"; el catálogo inicial es solo una comodidad editable.

## Escenario

```gherkin
Dado un workspace creado con el catálogo inicial que incluye "Banco Andino Demo"
Cuando el usuario la renombra a "Banco Andino"
Entonces cambia solo en ese workspace
```
