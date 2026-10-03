---
id: TC-IDENTITY-DEMO-003
title: "Ningún dato de demostración se carga automáticamente"
spec: identity/demo-data
related_specs: []
requirement: "Carga de datos demo solo por acción explícita del OWNER"
scenario: "Nada se carga automáticamente"
requirement_status: confirmed
fr: ["FR-IDENTITY-013","FR-IDENTITY-004"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","startup"]
error_code: null
preconditions:
  - "Base de datos vacía"
  - "DEMO_DATA_ENABLED = true"
input: {"steps":["migrate","start api + worker","first login de un usuario nuevo"]}
steps:
  - "Aplicar migraciones"
  - "Arrancar api y worker"
  - "Iniciar sesión por primera vez con un usuario nuevo"
expected_result:
  - "Existe solo el workspace personal del usuario nuevo, sin datos financieros"
  - "No existe ningún workspace con isDemo = true ni filas en el registro de cargas demo"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-003 — Ningún dato de demostración se carga automáticamente

## Intención

D36 exige que la carga sea solo por acción explícita: nunca un efecto colateral de arrancar, migrar o iniciar sesión.

## Escenario

```gherkin
Dado una base de datos vacía
Cuando se migran, arrancan los servicios y un usuario nuevo inicia sesión
Entonces no existe ningún workspace de demostración
  Y el workspace personal del usuario no tiene datos financieros
```

## Notas

- Incluye la Minimal Seed: W1/W2 siguen sin datos financieros.
