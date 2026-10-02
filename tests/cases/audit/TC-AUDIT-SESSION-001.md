---
id: TC-AUDIT-SESSION-001
title: "El inicio y el cierre de sesión quedan auditados sin tokens ni cookies"
spec: audit/audit-trail
related_specs: ["identity/authentication"]
requirement: "Auditoría de inicio y cierre de sesión"
scenario: "Inicio de sesión auditado"
requirement_status: confirmed
fr: [FR-AUDIT-005]
nfr: [NFR-SEC-015]
invariants: []
priority: high
type: integration
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["audit", "session", "security"]
error_code: null
preconditions:
  - "Keycloak dev realm y BFF en Compose core"
  - "FixedClock 2026-03-15T12:00:00Z en la API"
  - "owner@demo.pfos.test (U1) con workspace activo W1"
input:
  actions: ["login de U1", "primer request autenticado", "segundo request autenticado", "logout"]
steps:
  - "Iniciar sesión y hacer dos requests"
  - "Cerrar sesión"
  - "Leer los registros de auditoría de sesión de U1 en W1"
expected_result:
  - "Existe exactamente un registro de inicio de sesión de U1 con instante 2026-03-15T12:00:00Z, hash de IP y user agent"
  - "Existe un registro de cierre de sesión de U1"
  - "Ningún registro contiene el access token, el refresh token ni la cookie de sesión"
created: 2026-10-02
updated: 2026-10-02
---

# TC-AUDIT-SESSION-001 — El inicio y el cierre de sesión quedan auditados sin tokens ni cookies

## Intención

FR-AUDIT-005 (parte Phase 1): los accesos deben ser atribuibles sin exponer credenciales.

## Escenario

```gherkin
Dado el usuario "U1"
Cuando inicia sesión el 2026-03-15T12:00:00Z y luego cierra sesión
Entonces existen registros de inicio y cierre de sesión de "U1"
  Y ninguno contiene tokens ni cookies
```
