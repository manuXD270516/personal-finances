---
id: TC-SECURITY-RLS-006
title: "Con las políticas reescritas el contexto de W1 no lee filas de W2 y una inserción hacia W2 falla"
spec: security/access-control
related_specs: ["ledger/balances"]
requirement: "Reescritura de las políticas de aislamiento sin pérdida de aislamiento"
scenario: "Lectura y escritura cruzadas con las políticas reescritas"
requirement_status: confirmed
fr: [FR-IDENTITY-006]
nfr: [NFR-SEC-003, NFR-SEC-004]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 5
tags: ["rls", "isolation", "policy-rewrite"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed y la migración de las políticas reescritas aplicada"
  - "Conexión con el rol pf_app y contexto fijado en W1 Personal Demo"
input:
  w2_account: "W2 Bank, saldo 5000.00 BOB"
  cross_insert: "cuenta del ledger con workspace W2 Other Demo"
steps:
  - "Consultar sin filtro cuentas, asientos, postings y snapshots de saldo"
  - "Intentar insertar una cuenta del ledger con el workspace de W2"
expected_result:
  - "Solo se devuelven filas de W1 Personal Demo; W2 Bank no aparece"
  - "La inserción hacia W2 falla por la política de aislamiento"
created: 2026-10-21
updated: 2026-10-23
---

# TC-SECURITY-RLS-006 — Con las políticas reescritas el contexto de W1 no lee filas de W2 y una inserción hacia W2 falla

## Intención

`optimize-rls-policy-overhead` cambia la expresión de las políticas para quitar trabajo por fila. Este caso repite el aislamiento básico (TC-SECURITY-RLS-001) sobre las tablas del ledger con la forma nueva.

## Escenario

```gherkin
Dado el contexto fijado en W1 Personal Demo con las políticas reescritas
Cuando se consultan sin filtro cuentas, asientos, postings y saldos
  Y se intenta insertar una cuenta del ledger de W2 Other Demo
Entonces solo se devuelven filas de W1 y W2 Bank con 5000.00 BOB no aparece
  Y la inserción hacia W2 falla
```

## Notas

- Change `optimize-rls-policy-overhead` (D287, docs/46). Datos de la Minimal Seed (docs/29).
