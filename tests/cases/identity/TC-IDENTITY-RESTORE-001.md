---
id: TC-IDENTITY-RESTORE-001
title: "Importar un export crea un workspace nuevo con identificadores nuevos"
spec: identity/workspace-portability
related_specs: ["identity/workspace-membership"]
requirement: "Importar un export en un workspace nuevo"
scenario: "Importar el export de \"W1\""
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-REL-014]
invariants: [INV-025]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-export.api.test.ts","apps/api/test/api/workspace-import.api.test.ts","packages/contexts/identity/src/application/portability/workspace-import.service.test.ts","packages/contexts/identity/src/domain/id-remap.test.ts","packages/contexts/identity/src/domain/workspace-export.test.ts","tests/e2e/specs/workspace-export.spec.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["restore", "import"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
  - "Export de \"W1\" descargado"
  - "U1 autenticado hace 1 minuto"
input:
  file: "export de W1"
steps:
  - "POST /workspace-imports (multipart)"
  - "Esperar SUCCEEDED"
  - "Comparar con \"W1\""
expected_result:
  - "Workspace \"W1 (restaurado)\" ACTIVE con U1 OWNER y restored_from_export informado"
  - "Mismas cuentas, categorías, transacciones y asientos; ningún id coincide con los de \"W1\""
  - "\"W1\" sin cambios (conteos y versión de datos iguales)"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-001 — Importar un export crea un workspace nuevo con identificadores nuevos

## Intención

FR-IDENTITY-017: la importación nunca escribe en un workspace existente.

## Escenario

```gherkin
Dado el export de "W1" y "W1" todavía existente
Cuando "U1" lo importa
Entonces se crea "W1 (restaurado)" con los mismos datos e identificadores distintos
  Y "W1" no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
