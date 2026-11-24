---
id: TC-PLATFORM-HOSTOPS-006
title: "Solo el worker monta la clave privada de las conexiones en producción"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Clave privada de las conexiones disponible solo para el worker"
scenario: "Solo el worker la ve"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-007"]
invariants: []
priority: high
type: platform
level: contract
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["compose","secrets","connections","add-host-restore-drill"]
error_code: null
preconditions:
  - "docker compose disponible en el runner; variables mínimas de pfos.env y release.env de prueba"
input: {"files":["deploy/compose/compose.yaml","deploy/compose/compose.prod.yaml"],"profile":"core"}
steps:
  - "Renderizar docker compose config con los dos archivos y el perfil core"
  - "Buscar el destino /run/pfos/connection-credentials.keys en cada servicio"
expected_result:
  - "finance-worker monta /etc/pfos/connection-credentials.keys en /run/pfos/connection-credentials.keys"
  - "finance-api, finance-web y los demás servicios no lo montan"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-006 — Solo el worker monta la clave privada de las conexiones en producción

## Intención

Requirement «Clave privada de las conexiones disponible solo para el worker» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el compose de producción
Cuando se inspeccionan los servicios
Entonces solo el worker tiene montada la clave privada
```

## Notas


