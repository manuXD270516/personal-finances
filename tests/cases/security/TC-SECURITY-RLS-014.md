---
id: TC-SECURITY-RLS-014
title: "Con solo el usuario fijado, las claves de idempotencia exponen solo las de alcance de usuario de ese usuario"
spec: security/access-control
related_specs: ["platform/api-conventions"]
requirement: "Fail-closed de las claves de idempotencia sin contexto"
scenario: "Claves de alcance de usuario con solo el usuario fijado"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/db/idempotency-key.int.test.ts
status: automated
regression_suite: true
phase: 5
tags: ["rls", "fail-closed", "idempotency"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con la migración de este change"
  - "Una clave de alcance de usuario de owner@demo.pfos.test (POST /workspaces) y la clave de W1 de un gasto de 75.00 BOB"
input:
  contexts: ["solo el usuario owner@demo.pfos.test", "W1 Personal Demo y su usuario"]
  reads: ["sin filtro", "filtrada por workspace_id = W1"]
steps:
  - "Con solo el usuario fijado, leer sin filtro y filtrando por W1"
  - "Con W1 fijado, leer sin filtro"
  - "Con PgIdempotencyStore, reservar, completar y repetir una clave de alcance de usuario y otra de W1"
expected_result:
  - "Con solo el usuario se devuelve únicamente su clave de alcance de usuario; filtrando por W1 el resultado es vacío y la clave del gasto de 75.00 BOB no aparece"
  - "Con W1 se devuelve únicamente la clave de W1, no la de alcance de usuario"
  - "El store repite la respuesta guardada en los dos alcances como antes del change"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-014 — Con solo el usuario fijado, las claves de idempotencia exponen solo las de alcance de usuario de ese usuario

## Intención

La corrección de D296 no debe romper las claves de alcance de usuario (operaciones sin workspace, como crear un workspace). Este caso también fija el efecto colateral aceptado en el design: con el workspace fijado ya no se ven las claves de alcance de usuario del mismo usuario.

## Escenario

```gherkin
Dada la clave de alcance de usuario de "owner@demo.pfos.test" y la clave de "W1 Personal Demo" de un gasto de 75.00 BOB
Cuando con solo el usuario fijado se leen las claves sin filtro y filtrando por "W1 Personal Demo"
Entonces solo se devuelven las claves de alcance de usuario de "owner@demo.pfos.test"
  Y la clave del gasto de 75.00 BOB no se devuelve
```

## Notas

- Change `fix-rls-fail-closed-gaps`, tarea 2.2, en `apps/api/test/db/idempotency-key.int.test.ts`.
