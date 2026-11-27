---
id: TC-PLATFORM-CLIENTNAV-005
title: "Idioma conservado"
spec: platform/web-interface
related_specs: []
requirement: "Navegación entre secciones sin recargar el documento"
scenario: "Idioma conservado"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-001", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "i18n", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión y la interfaz en inglés"
input: {}
steps:
  - "el OWNER, con la interfaz en inglés, pasa de Inicio a Reportes"
expected_result:
  - "la dirección del navegador queda en la ruta en inglés de Reportes y la página se muestra en inglés"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-005 — Idioma conservado

## Intención

Verifica el requirement «Navegación entre secciones sin recargar el documento» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y la interfaz en inglés
Cuando el OWNER, con la interfaz en inglés, pasa de Inicio a Reportes
Entonces la dirección del navegador queda en la ruta en inglés de Reportes y la página se muestra en inglés
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
