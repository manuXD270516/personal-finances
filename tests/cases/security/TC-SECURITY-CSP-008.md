---
id: TC-SECURITY-CSP-008
title: "El borde agrega Permissions-Policy y COOP sin romper el login ni el logout"
spec: security/access-control
related_specs: ["identity/authentication"]
requirement: "Cabeceras complementarias en el borde de la web"
scenario: "Login y logout con las cabeceras"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-SEC-008","NFR-SEC-001"]
invariants: []
priority: medium
type: security
level: smoke
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Host de producción tras la fase 6 del runbook, o Caddy local con el Caddyfile del repositorio"
  - "Usuario de prueba del realm de producción creado por el owner"
input: {"base":"$BASE"}
steps:
  - "curl -sI $BASE/ y leer permissions-policy y cross-origin-opener-policy"
  - "Iniciar sesión en $BASE y luego cerrarla"
expected_result:
  - "permissions-policy deshabilita camera, microphone, geolocation, payment y usb"
  - "cross-origin-opener-policy es same-origin"
  - "El login vuelve a la web con sesión y el logout termina en la web sin errores"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-008 — El borde agrega Permissions-Policy y COOP sin romper el login ni el logout

## Intención

Requirement «Cabeceras complementarias en el borde de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado el borde de producción con las cabeceras nuevas
Cuando el usuario inicia y cierra sesión
Entonces las dos redirecciones con Keycloak terminan en la web sin errores
```

## Notas

- La suite E2E (auth.spec.ts incluida) corre sin Caddy; esta comprobación se hace en la fase 6 del runbook (comprobación 6 ampliada) y en el PoC. Cubre también el scenario «Cabeceras en el Home».
