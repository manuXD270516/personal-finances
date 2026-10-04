---
id: TC-IDENTITY-DEMO-002
title: "Un EDITOR no puede cargar datos de demostración"
spec: identity/demo-data
related_specs: ["security/access-control"]
requirement: "Carga de datos demo solo por acción explícita del OWNER"
scenario: "Un EDITOR no puede cargar datos de demostración"
requirement_status: confirmed
fr: ["FR-IDENTITY-013","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/demo-data.api.test.ts","packages/contexts/identity/src/application/demo-data.service.test.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["demo-data","authorization"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Minimal Seed: editor@demo.pfos.test es EDITOR de \"W1 Personal Demo\""
  - "DEMO_DATA_ENABLED = true"
input: {"action":"POST W1/demo-data","actor":"editor@demo.pfos.test"}
steps:
  - "El EDITOR envía la solicitud de carga de datos de demostración"
expected_result:
  - "Respuesta 403 con code INSUFFICIENT_ROLE"
  - "No se crea ningún workspace ni job de carga"
created: 2026-10-03
updated: 2026-10-04
---

# TC-IDENTITY-DEMO-002 — Un EDITOR no puede cargar datos de demostración

## Intención

La carga crea un workspace y datos: es una decisión de configuración reservada al OWNER (D36).

## Escenario

```gherkin
Dado que soy EDITOR de "W1 Personal Demo"
Cuando intento cargar los datos de demostración
Entonces la solicitud se rechaza con INSUFFICIENT_ROLE
  Y no existe ningún workspace de demostración
```

## Notas

- El VIEWER recibe el mismo rechazo (variante del mismo test).
