---
id: TC-PLATFORM-WEBUI-019
title: "El job de E2E corre el subconjunto de specs también en WebKit"
spec: platform/web-interface
related_specs: []
requirement: "Cobertura de la interfaz en WebKit"
scenario: "Subconjunto en WebKit en cada pull request"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005"]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["e2e","webkit","ci"]
error_code: null
preconditions:
  - "el spike de WebKit pasó (D509)"
  - "el proyecto webkit está en tests/e2e/playwright.config.ts"
input: {}
steps:
  - "corre el job e2e de un pull request"
expected_result:
  - "app-shell, a11y, transactions, auth y content-security-policy corren en webkit además de chromium"
  - "el job termina dentro de sus 40 minutos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-019 — El job de E2E corre el subconjunto de specs también en WebKit

## Intención

Cubre Safari/iOS, donde más fallan las funciones Newly available que D500 admite como mejora progresiva.

## Escenario

```gherkin
Dado el spike de WebKit pasó (D509)
  Y el proyecto webkit está en tests/e2e/playwright.config.ts
Cuando corre el job e2e de un pull request
Entonces app-shell, a11y, transactions, auth y content-security-policy corren en webkit además de chromium
  Y el job termina dentro de sus 40 minutos
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner. Condicionado al spike de D509: si falla, queda en draft y la decisión vuelve al owner.
