---
id: TC-PLATFORM-CLIENTNAV-002
title: "Perfil de teléfono modesto"
spec: platform/web-interface
related_specs: []
requirement: "Medición de la navegación entre secciones"
scenario: "Perfil de teléfono modesto"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "performance"]
error_code: null
preconditions:
  - "OWNER con sesión"
  - "red «Fast 4G» emulada y procesador ralentizado ×4 por CDP"
input: {}
steps:
  - "se mide la navegación de Inicio a Transacciones con red rápida 4G emulada y el procesador ralentizado cuatro veces"
expected_result:
  - "el informe registra la mediana de tres corridas para ese perfil"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-002 — Perfil de teléfono modesto

## Intención

Verifica el requirement «Medición de la navegación entre secciones» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
  Y red «Fast 4G» emulada y procesador ralentizado ×4 por CDP
Cuando se mide la navegación de Inicio a Transacciones con red rápida 4G emulada y el procesador ralentizado cuatro veces
Entonces el informe registra la mediana de tres corridas para ese perfil
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 1 (sin condición).
