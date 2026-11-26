---
id: TC-PLATFORM-STACK-013
title: "Sin el perfil tls el stack de desarrollo sigue por http y no hay proxy"
spec: platform/local-environment
related_specs: []
requirement: "El stack de desarrollo sigue por http salvo que se pida TLS"
scenario: "Stack de desarrollo sin el perfil de TLS"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-001"]
invariants: []
priority: medium
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["stack", "tls", "regression"]
error_code: null
preconditions:
  - "stack de prueba con PF_E2E_PROJECT=pfos-e2e-<nombre> y .env de ejemplo sin cambios de URL"
input: {}
steps:
  - "se levanta el perfil core sin el perfil tls"
  - "se listan los contenedores del proyecto"
  - "se pide la URL de salud de la web por http"
expected_result:
  - "no existe el contenedor tls-proxy"
  - "la web responde por http en su puerto de siempre"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-STACK-013 — Sin el perfil tls el stack de desarrollo sigue por http y no hay proxy

## Intención

El stack de desarrollo del owner no cambia si no pide TLS.

## Escenario

```gherkin
Dado stack de prueba con PF_E2E_PROJECT=pfos-e2e-<nombre> y .env de ejemplo sin cambios de URL
Cuando se levanta el perfil core sin el perfil tls
  Y se listan los contenedores del proyecto
  Y se pide la URL de salud de la web por http
Entonces no existe el contenedor tls-proxy
  Y la web responde por http en su puerto de siempre
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
