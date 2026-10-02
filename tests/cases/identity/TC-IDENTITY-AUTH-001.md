---
id: TC-IDENTITY-AUTH-001
title: Las solicitudes sin un token de acceso válido se rechazan con 401
spec: identity/authentication
related_specs: []
requirement: Acceso autenticado a la API
scenario: Petición sin token o con token inválido
requirement_status: confirmed
fr:
- FR-IDENTITY-001
nfr:
- NFR-SEC-002
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- authn
- jwt
error_code: UNAUTHENTICATED
preconditions:
- finance-api con un emisor JWKS de prueba local (claves RS256 y ES256)
- Usuario owner provisionado (Minimal Seed)
input:
- token: ninguno
- token: expirado hace 31 s (fuera del skew de 30 s)
- token: audiencia incorrecta
- token: firmado con una clave desconocida (kid inexistente)
- token: alg none
- token: HS256 con la clave pública como secreto
- token: id token (typ ID)
- token: sin scope pfos.api
- token: expirado hace 20 s (dentro del skew)
- token: válido
steps:
- GET /api/v1/workspaces con cada token
- GET /health/live sin token
expected_result:
- 'Todos los casos inválidos: 401 application/problem+json con código UNAUTHENTICATED, sin datos de negocio y sin detalle de la validación que falló'
- 'Token expirado dentro del skew y token válido: 200'
- 'GET /health/live sin token: no responde 401'
created: 2026-10-01
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-001 — Las solicitudes sin un token de acceso válido se rechazan con 401

## Intención

Toda ruta de la API, excepto health, exige un JWT válido (ARCHITECTURE §8, ADR-0010, docs/12 §3.1). Sin este caso un token manipulado o de otro emisor podría leer datos financieros.

## Escenario

```gherkin
Cuando una solicitud sin un token válido llama a "GET /api/v1/workspaces"
Entonces el estado de la respuesta es 401
  Y el código del problema es "UNAUTHENTICATED"
  Y el cuerpo no indica qué validación falló
```

## Notas

- Incluye los casos negativos validados en SPIKE-06 (alg none, HS256, kid desconocido, payload manipulado, id token).
- Relacionado: TC-IDENTITY-AUTH-007 (provisión del usuario).
