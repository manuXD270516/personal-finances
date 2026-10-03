---
id: TC-FX-PROVIDER-019
title: "En el stack en contenedores el worker tiene salida de red y recibe FX_* del contrato único; la suite sigue sin red"
spec: fx/market-rate-providers
related_specs: ["platform/local-environment"]
requirement: "Salida de red del worker en el entorno en contenedores"
scenario: "Stack en contenedores"
requirement_status: confirmed
fr: ["FR-FX-009","FR-FX-015"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: medium
type: e2e
level: container-integration
automation_status: automated
automated_tests:
  - scripts/stack/test/stack/stack.stack.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","provider","docker","compose","network","config","stack"]
error_code: null
preconditions:
  - "Docker disponible; proyecto Compose desechable pfos-test (pnpm test:stack)"
  - "`.env` temporal generado desde `.env.example` con FX_PROVIDER_PRIMARY/FALLBACK/OFFICIAL = none (sin red en tests)"
input: {"profile": "core", "service": "finance-worker"}
steps:
  - "Levantar el producto completo (modo B, perfil core)"
  - "Inspeccionar las redes del contenedor finance-worker y sus variables de entorno FX_*"
  - "Consultar el log de arranque del worker"
expected_result:
  - "finance-worker está conectado solo a redes no internas (Internal = false): puede abrir conexiones HTTPS salientes a paralelo.bo y bo.dolarapi.com"
  - "Las variables FX_* del contenedor son exactamente las del `.env` (contrato único; compose no fija ninguna), incluida FX_STALE_AFTER_FALLBACK"
  - "Con FX_PROVIDER_* = none el worker informa providers deshabilitados y no envía ninguna solicitud externa"
created: 2026-10-03
updated: 2026-10-03
---

# TC-FX-PROVIDER-019 — En el stack en contenedores el worker tiene salida de red y recibe FX_* del contrato único; la suite sigue sin red

## Intención

Decisión del owner (2026-10-03): ambos providers habilitados por defecto en `.env.example` y el entorno dockerizado (modo B) capaz de consultarlos, sin perder la regla de "tests sin red".

## Escenario

```gherkin
Dado el stack en contenedores levantado con el perfil core
Cuando inspecciono el contenedor finance-worker
Entonces sus redes no son internas y sus variables FX_* son las del .env
  Y con los providers en none no consulta ninguna red
```

## Notas

- La verificación real de salida (una solicitud a paralelo.bo desde el contenedor) es manual y está documentada en docs/19 (modo B); la suite automatizada no usa red.
- El worker usa `node:https` con el almacén de CA propio de Node: no requiere `ca-certificates` en la imagen.
