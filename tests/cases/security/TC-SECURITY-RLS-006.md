---
id: TC-SECURITY-RLS-006
title: "Con las políticas vigentes el contexto de W1 no lee filas de W2 en el ledger y cuentas y una inserción hacia W2 falla"
spec: security/access-control
related_specs: ["ledger/balances"]
requirement: "Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla"
scenario: "Lectura y escritura cruzadas en las tablas del ledger y de cuentas"
requirement_status: confirmed
fr: [FR-IDENTITY-006]
nfr: [NFR-SEC-003, NFR-SEC-004]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
status: automated
regression_suite: true
phase: 5
tags: ["rls", "isolation"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed y las políticas vigentes (sin migración, D298)"
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
updated: 2026-10-24
---

# TC-SECURITY-RLS-006 — Con las políticas vigentes el contexto de W1 no lee filas de W2 en el ledger y cuentas y una inserción hacia W2 falla

## Intención

Repite el aislamiento básico (TC-SECURITY-RLS-001) sobre las tablas del ledger y de cuentas. Se escribió para la forma nueva de las políticas; sin migración (D298) queda como regresión permanente del aislamiento con la política vigente.

## Escenario

```gherkin
Dado el contexto fijado en W1 Personal Demo con las políticas vigentes
Cuando se consultan sin filtro cuentas, asientos, postings y saldos
  Y se intenta insertar una cuenta del ledger de W2 Other Demo
Entonces solo se devuelven filas de W1 y W2 Bank con 5000.00 BOB no aparece
  Y la inserción hacia W2 falla
```

## Notas

- Change `optimize-rls-policy-overhead` (D287, docs/46; reconvertido por D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)). Datos de la Minimal Seed (docs/29).
- En verde en el job `integration` de #162 con la política actual.
