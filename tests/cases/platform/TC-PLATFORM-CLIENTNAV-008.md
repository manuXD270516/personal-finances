---
id: TC-PLATFORM-CLIENTNAV-008
title: "Anuncio de la sección nueva"
spec: platform/web-interface
related_specs: []
requirement: "Foco y anuncio al cambiar de sección"
scenario: "Anuncio de la sección nueva"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102", "NFR-USAB-108", "NFR-USAB-101"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "a11y", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER pasa de Inicio a Transacciones"
expected_result:
  - "una región en vivo anuncia el título de Transacciones"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-008 — Anuncio de la sección nueva

## Intención

Verifica el requirement «Foco y anuncio al cambiar de sección» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER pasa de Inicio a Transacciones
Entonces una región en vivo anuncia el título de Transacciones
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
