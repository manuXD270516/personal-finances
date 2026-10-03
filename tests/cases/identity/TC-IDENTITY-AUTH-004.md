---
id: TC-IDENTITY-AUTH-004
title: Cerrar sesión invalida la sesión del BFF y la cookie anterior deja de dar acceso
spec: identity/authentication
related_specs: []
requirement: Cierre de sesión
scenario: Reutilizar la cookie tras el logout
requirement_status: confirmed
fr:
- FR-IDENTITY-002
nfr:
- NFR-SEC-017
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: automated
automated_tests:
- tests/e2e/specs/auth.spec.ts
- apps/web/test/integration/bff.int.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- authn
- session
- logout
error_code: UNAUTHENTICATED
preconditions:
- Stack core
- Usuario owner autenticado; se guarda una copia de la cookie de sesión
input:
  accion: logout
steps:
- Ejecutar el logout desde la UI
- Verificar el almacén de sesiones
- Enviar al BFF una petición con la cookie copiada
- Verificar en Keycloak el estado de la sesión y del refresh token
expected_result:
- La sesión desaparece del almacén y la cookie se borra en el navegador
- El navegador pasa por el end_session_endpoint del IdP
- La petición con la cookie antigua responde 401 UNAUTHENTICATED y no llega a finance-api
- El refresh token queda revocado en el IdP
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-004 — Cerrar sesión invalida la sesión del BFF y la cookie anterior deja de dar acceso

## Intención

Una sesión que sobrevive al logout permite que otra persona use un dispositivo compartido (FR-IDENTITY-002).

## Escenario

```gherkin
Dado un usuario autenticado
Cuando cierra sesión
  Y luego se reenvía una petición con la cookie anterior
Entonces la respuesta es 401
  Y la API no recibe la petición
```

## Notas

- El access token emitido sigue siendo válido contra la API hasta su exp (≤ 5 min), aceptado en ADR-0010.
