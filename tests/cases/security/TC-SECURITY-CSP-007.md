---
id: TC-SECURITY-CSP-007
title: "Caddy agrega una CSP por omisión solo a las respuestas que no traen la suya"
spec: security/access-control
related_specs: ["security/file-upload-security"]
requirement: "La web no se puede enmarcar desde ningún origen"
scenario: "Respuesta sin política propia"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: high
type: security
level: container-integration
automation_status: automated
automated_tests:
  - scripts/stack/test/stack/caddy-headers.stack.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Caddy con la imagen fijada y el Caddyfile del repositorio, con finance-web detrás (stack local o contenedor de prueba)"
input: {"app":["/_next/static/chunks/<chunk>.js","/api/health/ready","/es"],"files":["/no-existe"],"download":"/api/bff/v1/documents/{id}/download"}
steps:
  - "Pedir un recurso estático, una respuesta del BFF y una ruta inexistente del hostname de archivos"
  - "Pedir una página HTML de la web"
  - "Pedir la descarga de un documento"
  - "Pedir el discovery OIDC del hostname de auth"
expected_result:
  - "Las tres primeras respuestas traen Content-Security-Policy default-src none; frame-ancestors none"
  - "La página HTML conserva la política con nonce de la web (Caddy no la reemplaza)"
  - "La descarga conserva sandbox; default-src none (ADR-0030)"
  - "La respuesta del hostname de auth no recibe la política por omisión"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-007 — Caddy agrega una CSP por omisión solo a las respuestas que no traen la suya

## Intención

Requirement «La web no se puede enmarcar desde ningún origen» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado Caddy delante de la web y del hostname de archivos
Cuando una respuesta no trae política propia
Entonces Caddy agrega default-src none y frame-ancestors none
  Y no reemplaza la política de la web ni la de la descarga
```

## Notas

- Cubre también el scenario «La descarga de un documento conserva su política». El prefijo ? de la directiva header de Caddy implica defer.
