---
id: TC-AUDIT-HISTORY-001
title: "El historial de auditoría de una cuenta muestra apertura, renombre y archivo en orden cronológico"
spec: audit/audit-trail
related_specs: ["accounts/account-management"]
requirement: "Historial de auditoría por entidad"
scenario: "Historial de una cuenta"
requirement_status: confirmed
fr: [FR-AUDIT-004]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/audit/src/application/audit-queries.test.ts
  - apps/api/test/api/audit.api.test.ts
  - apps/web/src/ui/AuditHistory.test.tsx
  - tests/e2e/specs/audit.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["audit", "history"]
error_code: null
preconditions:
  - "Usuario EDITOR en W1"
  - "FixedClock que avanza 1 minuto entre comandos desde 2026-03-15T14:00:00Z"
input:
  commands:
    - "Abrir Bank C (bank, BOB) con saldo inicial 500.00 BOB"
    - "Renombrar Bank C a \"Bank C Sueldo\""
    - "Archivar Bank C Sueldo"
  request: "GET /workspaces/W1/audit-log?aggregateType=Account&aggregateId=<Bank C>"
steps:
  - "Ejecutar los tres comandos"
  - "Consultar el historial de la cuenta"
  - "Consultar el historial de una cuenta sin registros"
expected_result:
  - "Tres registros en orden cronológico ascendente: apertura (con 500.00 BOB), renombre (before \"Bank C\", after \"Bank C Sueldo\"), archivo"
  - "Cada registro muestra actor, acción, instante, origen y diferencias"
  - "Una entidad sin registros devuelve lista vacía"
  - "Con limit=2 la respuesta trae dos registros y un cursor que devuelve el tercero"
created: 2026-10-02
updated: 2026-10-03
---

# TC-AUDIT-HISTORY-001 — El historial de auditoría de una cuenta muestra apertura, renombre y archivo en orden cronológico

## Intención

FR-AUDIT-004: el usuario debe poder responder "qué le pasó a esta cuenta" desde su pestaña de historial.

## Escenario

```gherkin
Dado que "Bank C" se abrió con 500.00 BOB, se renombró y se archivó
Cuando el usuario consulta su historial
Entonces ve los tres cambios en orden cronológico con sus diferencias
```

## Notas

- Automatización (add-audit-trail): Historial de "Bank C" con registros de fixture (aplicación); por HTTP y E2E, el historial real del workspace (crear, renombrar) en la pestaña "Historial" de Configuración.
