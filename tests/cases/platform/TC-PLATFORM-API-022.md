---
id: TC-PLATFORM-API-022
title: Importar otro archivo con la misma Idempotency-Key se rechaza con 422
spec: platform/api-conventions
related_specs: []
requirement: Rechazo de Idempotency-Key reutilizada con otro payload
scenario: Misma clave, archivo de importación distinto
requirement_status: provisional
fr: []
nfr:
- NFR-REL-007
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- idempotency
- import
error_code: IDEMPOTENCY_KEY_REUSED
preconditions:
- Dos exports válidos A y B de workspaces distintos
input:
  request: 'POST /workspace-imports con K-IMP-0001 y el archivo A, luego con el archivo B'
steps:
- Importar A con la clave
- Importar B con la misma clave
expected_result:
- La segunda respuesta es 422 IDEMPOTENCY_KEY_REUSED
- Solo existe la importación de A
- Repetir A con la clave reproduce la primera respuesta
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-API-022 — Importar otro archivo con la misma Idempotency-Key se rechaza con 422

## Intención

Change `fix-phase-2-gaps`: verificar el escenario "Misma clave, archivo de importación distinto" del requirement "Rechazo de Idempotency-Key reutilizada con otro payload" de `platform/api-conventions`.

## Notas

- Borrador; pasa a `ready` al aprobar el change (tarea 1.2).
