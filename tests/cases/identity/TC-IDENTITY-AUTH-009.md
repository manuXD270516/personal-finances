---
id: TC-IDENTITY-AUTH-009
title: GET /me con un locale guardado no soportado responde con el locale por defecto
spec: identity/authentication
related_specs: []
requirement: Perfil del usuario autenticado
scenario: Locale guardado no soportado
requirement_status: provisional
fr:
- FR-IDENTITY-003
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- locale
- i18n
error_code: null
preconditions:
- Usuario con iam.user.locale = fr-FR escrito directo en la BD
- APP_DEFAULT_LOCALE = es-BO
input:
  request: 'GET /api/v1/me'
steps:
- Consultar el perfil
expected_result:
- La respuesta es 200
- El locale del perfil es es-BO
created: 2026-10-09
updated: 2026-10-09
---

# TC-IDENTITY-AUTH-009 — GET /me con un locale guardado no soportado responde con el locale por defecto

## Intención

Change `fix-phase-2-gaps`: verificar el escenario "Locale guardado no soportado" del requirement "Perfil del usuario autenticado" de `identity/authentication`.

## Notas

- Borrador; pasa a `ready` al aprobar el change (tarea 1.2).
