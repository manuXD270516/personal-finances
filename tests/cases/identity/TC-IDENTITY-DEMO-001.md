---
id: TC-IDENTITY-DEMO-001
title: "El OWNER carga los datos de demostración en un workspace demo nuevo"
spec: identity/demo-data
related_specs: ["identity/workspace-membership"]
requirement: "Carga de datos demo solo por acción explícita del OWNER"
scenario: "El OWNER carga los datos de demostración"
requirement_status: confirmed
fr: ["FR-IDENTITY-013"]
nfr: []
invariants: []
priority: high
type: api
level: application
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-data.int.test.ts","packages/contexts/identity/src/application/demo-data.service.test.ts","packages/contexts/identity/src/domain/demo-workspace.test.ts","tests/e2e/specs/demo-data.spec.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["demo-data","workspace"]
error_code: null
preconditions:
  - "Minimal Seed: owner@demo.pfos.test es OWNER de \"W1 Personal Demo\""
  - "DEMO_DATA_ENABLED = true"
  - "El usuario no tiene workspaces demo"
input: {"action":"POST W1/demo-data","datasetVersion":"1","anchor":"today"}
steps:
  - "El OWNER ejecuta \"Cargar datos de demostración\" desde la configuración de W1"
  - "Esperar a que el job de carga termine"
  - "Consultar el estado de la carga y la lista de workspaces"
expected_result:
  - "La respuesta es 202 con el id de un workspace demo nuevo y estado LOADING"
  - "Al terminar, el estado es READY"
  - "El workspace demo tiene un único miembro: el solicitante con rol OWNER"
  - "El workspace demo contiene cuentas, transacciones, transferencias, conversiones y tasas de demostración"
created: 2026-10-03
updated: 2026-10-04
---

# TC-IDENTITY-DEMO-001 — El OWNER carga los datos de demostración en un workspace demo nuevo

## Intención

Decisión del owner D36 (docs/31): la carga existe solo como acción explícita del OWNER y siempre en un workspace dedicado.

## Escenario

```gherkin
Dado que soy OWNER de "W1 Personal Demo"
Cuando ejecuto "Cargar datos de demostración"
Entonces se crea un workspace de demostración del que soy el único OWNER
  Y al terminar la carga queda en estado READY con datos de demostración
```

## Notas

- Datos ficticios de docs/29 §2.2 (Valeria Mamani, Banco Andino Demo).
- Ver TC-IDENTITY-DEMO-014 para la verificación de que W1 no cambia.
