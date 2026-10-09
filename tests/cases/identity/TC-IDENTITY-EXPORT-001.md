---
id: TC-IDENTITY-EXPORT-001
title: "Solo el OWNER con autenticación reciente solicita la exportación"
spec: identity/workspace-portability
related_specs: ["security/access-control", "platform/api-conventions"]
requirement: "Solicitar la exportación del workspace"
scenario: "El OWNER solicita la exportación"
requirement_status: confirmed
fr: [FR-IDENTITY-010, FR-IDENTITY-006]
nfr: [NFR-SEC-003]
invariants: [INV-027]
priority: critical
type: security
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export-lifecycle.api.test.ts","apps/api/test/api/workspace-export.api.test.ts","apps/web/test/integration/bff.int.test.ts","packages/contexts/identity/src/application/portability/reauth.test.ts","packages/contexts/identity/src/application/portability/workspace-export.service.test.ts","packages/contexts/identity/src/domain/workspace-export.test.ts","tests/e2e/specs/workspace-export.spec.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["export", "rbac", "reauth"]
error_code: "REAUTHENTICATION_REQUIRED"
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
input:
  - "{\"actor\":\"U1\",\"authAgeMinutes\":3}"
  - "{\"actor\":\"U1\",\"authAgeMinutes\":45}"
  - "{\"actor\":\"U2\",\"authAgeMinutes\":1}"
  - "{\"actor\":\"U1\",\"authAgeMinutes\":2,\"secondExport\":true}"
steps:
  - "POST W/exports con Idempotency-Key para cada caso"
expected_result:
  - "U1 (3 min): 202 con Location a la operación EXPORT en PENDING"
  - "U1 (45 min): 403 REAUTHENTICATION_REQUIRED sin operación"
  - "U2: 403 INSUFFICIENT_ROLE"
  - "Segunda en curso con otra clave: 409 EXPORT_IN_PROGRESS"
  - "Reenvío con la misma clave: misma operación"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-EXPORT-001 — Solo el OWNER con autenticación reciente solicita la exportación

## Intención

docs/12 §4: exportar es acción sensible (OWNER + re-autenticación reciente).

## Escenario

```gherkin
Dado el OWNER de "W1" autenticado hace 3 minutos
Cuando solicita la exportación
Entonces recibe una operación pendiente que puede consultar
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
