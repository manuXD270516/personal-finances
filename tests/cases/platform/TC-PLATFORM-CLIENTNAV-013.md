---
id: TC-PLATFORM-CLIENTNAV-013
title: "Sesión vencida"
spec: platform/web-interface
related_specs: []
requirement: "Sesión y seguridad en la navegación sin documento nuevo"
scenario: "Sesión vencida"
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
tags: ["navigation", "auth", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión y la cookie de sesión borrada por la prueba antes del clic"
input: {}
steps:
  - "la sesión del OWNER vence con Inicio abierto y usa el enlace Transacciones"
expected_result:
  - "ve el inicio de sesión y no ve ninguna transacción"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-013 — Sesión vencida

## Intención

Verifica el requirement «Sesión y seguridad en la navegación sin documento nuevo» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y la cookie de sesión borrada por la prueba antes del clic
Cuando la sesión del OWNER vence con Inicio abierto y usa el enlace Transacciones
Entonces ve el inicio de sesión y no ve ninguna transacción
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
