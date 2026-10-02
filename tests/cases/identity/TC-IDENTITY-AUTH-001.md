---
id: TC-IDENTITY-AUTH-001
title: "Las solicitudes sin un token de acceso válido se rechazan con 401"
spec: identity/authentication
related_specs: []
requirement: "Acceso autenticado a la API"
scenario: null
requirement_status: provisional
fr: [FR-IDENTITY-001]
nfr: [NFR-SEC-002]
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["authn", "jwt"]
error_code: "UNAUTHENTICATED"
preconditions: ["finance-api con un emisor JWKS de prueba local"]
input:
  - token: "ninguno"
  - token: "expirado"
  - token: "audiencia incorrecta"
  - token: "firmado con una clave desconocida"
  - token: "válido"
steps: ["GET /api/v1/workspaces con cada token"]
expected_result:
  - "Todos los casos inválidos: 401 application/problem+json con código UNAUTHENTICATED, sin datos y sin detalles en WWW-Authenticate que filtren información interna"
  - "Token válido: 200"
created: 2026-10-01
updated: 2026-10-01
---

# TC-IDENTITY-AUTH-001 — Las solicitudes sin un token de acceso válido se rechazan con 401

## Intención

Toda ruta de la API, excepto health, está autenticada (ARCHITECTURE §8, ADR-0010).

## Escenario

```gherkin
Cuando una solicitud sin un token válido llama a "GET /api/v1/workspaces"
Entonces el estado de la respuesta es 401
  Y el código del problema es "UNAUTHENTICATED"
```
