---
id: TC-TRANSACTIONS-QUICK-013
title: "Recordar la cuenta no cambia la versión del perfil ni audita preferencias"
spec: transactions/transaction-recording
related_specs: ["identity/authentication","audit/audit-trail"]
requirement: "Cuenta recordada en el dispositivo"
scenario: "Sin cambios en el perfil"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-007"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","audit"]
error_code: null
preconditions:
  - "un EDITOR con la versión de su perfil leída de GET /me"
input:
  monto: "10.00"
  moneda: "BOB"
steps:
  - "el usuario registra tres gastos de 10.00 BOB en tres cuentas distintas desde el alta"
expected_result:
  - "no se envió ningún PATCH /me"
  - "la versión del perfil en GET /me no cambió"
  - "no hay eventos de auditoría identity.user.preferences_changed nuevos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-013 — Recordar la cuenta no cambia la versión del perfil ni audita preferencias

## Intención

Verifica el motivo de D510: cada PATCH /me sube la versión y audita, lo que ensuciaría la auditoría con una comodidad del dispositivo.

## Escenario

```gherkin
Dado un EDITOR con la versión de su perfil leída de GET /me
Cuando el usuario registra tres gastos de 10.00 BOB en tres cuentas distintas desde el alta
Entonces no se envió ningún PATCH /me
  Y la versión del perfil en GET /me no cambió
  Y no hay eventos de auditoría identity.user.preferences_changed nuevos
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
