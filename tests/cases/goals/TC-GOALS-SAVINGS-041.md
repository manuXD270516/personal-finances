---
id: TC-GOALS-SAVINGS-041
title: "VIEWER no escribe, la Idempotency-Key evita aportes duplicados y otro workspace no ve las metas"
spec: goals/savings-goals
related_specs: []
requirement: "Permisos, idempotencia y aislamiento de las metas"
scenario: "VIEWER intenta aportar"
requirement_status: provisional
fr: ["FR-IDENTITY-006", "FR-AUDIT-001"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: critical
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "rbac", "idempotency", "rls"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "Workspace \"W2\" con otra meta"
  - "Usuarios VIEWER y EDITOR de W1"
input: {}
steps:
  - "VIEWER: POST …/contributions de 100.00 BOB"
  - "EDITOR: dos POST idénticos de 1000.00 BOB con la misma Idempotency-Key"
  - "Miembro de W1: GET de la meta de W2"
  - "Consulta SQL sin contexto de workspace"
expected_result:
  - "403 INSUFFICIENT_ROLE sin efectos"
  - "Una sola transferencia y un solo aporte; la segunda respuesta con Idempotent-Replayed: true"
  - "404 RESOURCE_NOT_FOUND"
  - "PF002 (RLS fail-closed)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-041 — VIEWER no escribe, la Idempotency-Key evita aportes duplicados y otro workspace no ve las metas

## Intención

FR-IDENTITY-006 y aislamiento por workspace (INV-025).

## Escenario

```gherkin
Cuando un VIEWER aporta 100.00 BOB
Entonces se rechaza con INSUFFICIENT_ROLE
  Y no se crea ninguna transferencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
