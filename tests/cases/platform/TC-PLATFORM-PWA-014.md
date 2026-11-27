---
id: TC-PLATFORM-PWA-014
title: "Cookie de sesión sin cambios"
spec: platform/web-interface
related_specs: []
requirement: "Sesión en la aplicación instalada"
scenario: "Cookie de sesión sin cambios"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-SEC-001"]
invariants: []
priority: low
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["pwa", "auth", "security"]
error_code: null
preconditions:
  - "OWNER con credenciales de prueba del seed"
input: {}
steps:
  - "el OWNER inicia sesión con el manifiesto publicado"
expected_result:
  - "la cookie de sesión conserva su nombre y sus atributos"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-014 — Cookie de sesión sin cambios

## Intención

Verifica el requirement «Sesión en la aplicación instalada» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado OWNER con credenciales de prueba del seed
Cuando el OWNER inicia sesión con el manifiesto publicado
Entonces la cookie de sesión conserva su nombre y sus atributos
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
