---
id: TC-PLATFORM-CLIENTNAV-014
title: "Sin violaciones de la política de seguridad"
spec: platform/web-interface
related_specs: []
requirement: "Sesión y seguridad en la navegación sin documento nuevo"
scenario: "Sin violaciones de la política de seguridad"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-SEC-001", "NFR-SEC-008"]
invariants: []
priority: low
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "csp", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER recorre Inicio, Transacciones, Presupuestos, Reportes y Mis preferencias con los enlaces de la navegación"
expected_result:
  - "no se registra ninguna violación de la política de seguridad de contenido"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-014 — Sin violaciones de la política de seguridad

## Intención

Verifica el requirement «Sesión y seguridad en la navegación sin documento nuevo» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER recorre Inicio, Transacciones, Presupuestos, Reportes y Mis preferencias con los enlaces de la navegación
Entonces no se registra ninguna violación de la política de seguridad de contenido
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
