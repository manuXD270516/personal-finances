---
id: TC-IDENTITY-DEMO-012
title: "Con la carga deshabilitada por entorno la API la rechaza y la UI no la ofrece"
spec: identity/demo-data
related_specs: []
requirement: "Carga de datos demo habilitable por entorno"
scenario: "Carga deshabilitada"
requirement_status: confirmed
fr: ["FR-IDENTITY-016"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","config"]
error_code: DEMO_DATA_DISABLED
preconditions:
  - "DEMO_DATA_ENABLED = false"
  - "El OWNER de W1 no tiene workspaces demo"
input: {"action":"POST W1/demo-data"}
steps:
  - "El OWNER solicita la carga por la API"
  - "Abrir la configuración del workspace"
expected_result:
  - "Respuesta 403 con code DEMO_DATA_DISABLED"
  - "La configuración no muestra \"Cargar datos de demostración\""
  - "Si existía un demo previo, \"Limpiar datos de demostración\" sigue disponible"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-012 — Con la carga deshabilitada por entorno la API la rechaza y la UI no la ofrece

## Intención

Permite apagar la demo en entornos donde no corresponde (propuesta: staging/producción, pendiente del owner).

## Escenario

```gherkin
Dado que la carga de datos de demostración está deshabilitada
Cuando el OWNER intenta cargarlos
Entonces se rechaza con DEMO_DATA_DISABLED
```

## Notas

