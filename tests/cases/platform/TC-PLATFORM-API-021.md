---
id: TC-PLATFORM-API-021
title: La edición masiva 11 dentro del minuto se rechaza con 429 por la cuota costosa
spec: platform/api-conventions
related_specs: []
requirement: Límite de tasa por usuario
scenario: Ráfaga de ediciones masivas
requirement_status: provisional
fr: []
nfr:
- NFR-SEC-011
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
- rate-limit
- bulk-edit
error_code: RATE_LIMITED
preconditions:
- EDITOR de W1 con transacciones editables
- RATE_LIMIT_COSTLY_PER_MIN = 10
input:
  request: '11 POST bulk-edit con claves distintas'
steps:
- Enviar 10 ediciones masivas
- Enviar la edición 11
expected_result:
- La edición 11 responde 429 RATE_LIMITED con Retry-After
- La edición 11 no modifica ninguna transacción
- Repetir la edición 1 con su misma clave reproduce la respuesta sin consumir cuota
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-API-021 — La edición masiva 11 dentro del minuto se rechaza con 429 por la cuota costosa

## Intención

Change `fix-phase-2-gaps`: verificar el escenario "Ráfaga de ediciones masivas" del requirement "Límite de tasa por usuario" de `platform/api-conventions`.

## Notas

- Borrador; pasa a `ready` al aprobar el change (tarea 1.2).
