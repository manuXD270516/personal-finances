---
id: TC-IMPORTS-CSV-027
title: "Un VIEWER no puede importar y la aprobación queda auditada con el actor y origen import"
spec: imports/import-pipeline
related_specs: ["security/access-control","audit/audit-trail"]
requirement: "Permisos y auditoría del import"
scenario: "VIEWER intenta importar"
requirement_status: provisional
fr: ["FR-IDENTITY-006","FR-AUDIT-002","FR-IMPORTS-003"]
nfr: []
invariants: ["INV-029"]
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["csv-import","rbac","audit"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {}
steps:
  - "Un VIEWER sube un CSV para Banco BOB"
  - "El EDITOR \"Ana\" aprueba una importación que crea 3 transacciones"
  - "Consultar el audit log"
expected_result:
  - "VIEWER: 403 INSUFFICIENT_ROLE, sin importación"
  - "Audit: creación y aprobación del import con actor Ana"
  - "Cada transacción creada: registro con origin import y actor Ana"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-027 — Un VIEWER no puede importar y la aprobación queda auditada con el actor y origen import

## Intención

FR-IDENTITY-006 y FR-AUDIT-002: quién importó qué queda trazado en la misma unidad de trabajo.

## Escenario

```gherkin
Dado un VIEWER
Cuando sube un CSV
Entonces se rechaza con INSUFFICIENT_ROLE
Cuando Ana aprueba una importación de 3 filas
Entonces el audit log registra la aprobación y las 3 transacciones con origen import y actor Ana
```

## Notas

- Cubre también el scenario "Auditoría de la aprobación".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
