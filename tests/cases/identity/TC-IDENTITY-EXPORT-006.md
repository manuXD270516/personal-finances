---
id: TC-IDENTITY-EXPORT-006
title: "El OWNER descarga el export terminado con su suma SHA-256 y queda auditado"
spec: identity/workspace-portability
related_specs: ["audit/audit-trail"]
requirement: "Descarga del export"
scenario: "Descargar el export terminado"
requirement_status: confirmed
fr: [FR-IDENTITY-010, FR-AUDIT-005]
nfr: []
invariants: [INV-029]
priority: high
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export-lifecycle.api.test.ts","apps/api/test/api/workspace-export.api.test.ts","packages/contexts/identity/src/application/portability/workspace-export.service.test.ts","packages/contexts/identity/src/domain/workspace-export.test.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["export", "download"]
error_code: "EXPORT_NOT_READY"
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
  - "Export E1 READY hace 1 hora; export E2 RUNNING"
input:
  - "{\"export\":\"E1\",\"actor\":\"U1\",\"authAgeMinutes\":2}"
  - "{\"export\":\"E2\",\"actor\":\"U1\",\"authAgeMinutes\":2}"
  - "{\"export\":\"E1\",\"actor\":\"U2\"}"
steps:
  - "GET W/exports/E1/download"
  - "GET W/exports/E2/download"
  - "U2 descarga E1"
expected_result:
  - "200 application/zip; sha256 del cuerpo = sha256 informado (Repr-Digest)"
  - "Registro de auditoría identity.export.downloaded"
  - "E2: 409 EXPORT_NOT_READY"
  - "U2: 403 INSUFFICIENT_ROLE"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-006 — El OWNER descarga el export terminado con su suma SHA-256 y queda auditado

## Intención

La descarga es el momento de mayor exposición: OWNER, re-auth, integridad y auditoría.

## Escenario

```gherkin
Dado un export de "W1" terminado hace 1 hora
Cuando el OWNER autenticado hace 2 minutos lo descarga
Entonces recibe el archivo con la suma SHA-256 informada
  Y queda un registro de auditoría de la descarga
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
