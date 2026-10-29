---
id: TC-IMPORTS-BANKING-003
title: "El proveedor simulado impide arrancar en staging o producción"
spec: imports/banking-providers
related_specs: []
requirement: "Proveedores habilitados solo con términos y formato verificados"
scenario: "Proveedor simulado en producción"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: null
preconditions:
  - "PFOS_ENV=production e IMPORTS_PROVIDER_FAKE_ENABLED=true"
input: {"env":["staging","production"]}
steps:
  - "Cargar la configuración"
expected_result:
  - "Error de configuración en ambos entornos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-003 — El proveedor simulado impide arrancar en staging o producción

## Intención

Igual que el catálogo ficticio del change 41.

## Escenario

```gherkin
Dado el proveedor simulado habilitado en producción
Cuando arranca la aplicación
Entonces falla la configuración
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
