---
id: TC-IDENTITY-AUTH-005
title: La sesión expira por inactividad de 30 minutos y por duración absoluta de 12 horas
spec: identity/authentication
related_specs: []
requirement: Expiración de sesión por inactividad y duración absoluta
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-002
nfr:
- NFR-SEC-017
invariants: []
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- session
- expiry
error_code: UNAUTHENTICATED
preconditions:
- BFF con almacén de sesiones en PostgreSQL (Testcontainers) y reloj controlable
- SESSION_IDLE_TIMEOUT=30m, SESSION_ABSOLUTE_TIMEOUT=12h
input:
- caso: inactividad
  ultima_actividad: '2026-10-02T12:00:00Z'
  peticion: '2026-10-02T12:30:01Z'
- caso: absoluta
  login: '2026-10-02T08:00:00Z'
  actividad: cada 5 min
  peticion: '2026-10-02T20:00:01Z'
- caso: activa
  ultima_actividad: '2026-10-02T12:00:00Z'
  peticion: '2026-10-02T12:29:00Z'
steps:
- Crear una sesión en cada condición
- Enviar una petición autenticada al BFF en el instante indicado
expected_result:
- 'Inactividad y absoluta: 401 UNAUTHENTICATED y la UI pide un nuevo login'
- 'Sesión activa: la petición se atiende y la expiración por inactividad se desliza'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-005 — La sesión expira por inactividad de 30 minutos y por duración absoluta de 12 horas

## Intención

Limita la ventana de abuso de una sesión olvidada (FR-IDENTITY-002, NFR-SEC-017).

## Escenario

```gherkin
Dada una sesión sin actividad durante 30 minutos
Cuando el usuario intenta una acción
Entonces el BFF responde 401
  Y se exige un nuevo login
```

## Notas

- Fechas fijas con FixedClock; nunca 'hoy'.
