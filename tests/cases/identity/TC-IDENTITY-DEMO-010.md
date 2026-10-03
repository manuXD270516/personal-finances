---
id: TC-IDENTITY-DEMO-010
title: "Limpiar los datos de demostración oculta el workspace demo al instante"
spec: identity/demo-data
related_specs: ["security/access-control"]
requirement: "Limpieza inmediata del workspace demo"
scenario: "Limpiar oculta el workspace al instante"
requirement_status: confirmed
fr: ["FR-IDENTITY-015"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","cleanup"]
error_code: null
preconditions:
  - "Workspace demo READY con \"Banco Andino Demo\" en 12000.00 BOB"
input: {"action":"POST DEMO/demo-data/cleanup"}
steps:
  - "El OWNER ejecuta \"Limpiar datos de demostración\""
  - "Sin esperar la purga, listar workspaces y consultar el saldo de \"Banco Andino Demo\""
expected_result:
  - "Respuesta 202 con estado CLEANING"
  - "El workspace demo no aparece en la lista"
  - "Consultar la cuenta responde 404 como un recurso inexistente"
  - "Repetir la limpieza devuelve 202 sin efectos adicionales"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-010 — Limpiar los datos de demostración oculta el workspace demo al instante

## Intención

La limpieza debe sentirse inmediata aunque la purga física sea asíncrona.

## Escenario

```gherkin
Dado un workspace demo con "Banco Andino Demo" en 12000.00 BOB
Cuando limpio los datos de demostración
Entonces el workspace demo deja de listarse
  Y su cuenta responde como inexistente
```

## Notas

