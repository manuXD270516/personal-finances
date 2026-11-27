---
id: TC-PLATFORM-STACK-010
title: "La autoridad de prueba del E2E es efímera y no deja secretos en el repositorio"
spec: platform/local-environment
related_specs: []
requirement: "Stack de E2E servido por HTTPS con una autoridad de prueba efímera"
scenario: "Autoridad efímera sin secretos versionados"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-001", "NFR-PORT-001"]
invariants: []
priority: high
type: security
level: container-integration
automation_status: automated
automated_tests:
  - tests/e2e/specs/tls.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tls", "secrets", "stack"]
error_code: null
preconditions:
  - "stack de E2E bajado y sin volúmenes previos"
input: {}
steps:
  - "el global setup levanta el stack con el perfil tls"
  - "se baja con stack:down --volumes"
  - "se escanea el repositorio con el check secrets de CI"
expected_result:
  - "mientras el stack está arriba, el proxy sirve un certificado emitido por su autoridad interna"
  - "al bajarlo no queda ningún volumen ni archivo de la autoridad"
  - "el repositorio no contiene claves privadas ni certificados de la autoridad y .gitleaks.toml no suma excepciones"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-STACK-010 — La autoridad de prueba del E2E es efímera y no deja secretos en el repositorio

## Intención

El certificado nace y muere con el stack (D516): ningún secreto de prueba entra al repositorio público.

## Escenario

```gherkin
Dado stack de E2E bajado y sin volúmenes previos
Cuando el global setup levanta el stack con el perfil tls
  Y se baja con stack:down --volumes
  Y se escanea el repositorio con el check secrets de CI
Entonces mientras el stack está arriba, el proxy sirve un certificado emitido por su autoridad interna
  Y al bajarlo no queda ningún volumen ni archivo de la autoridad
  Y el repositorio no contiene claves privadas ni certificados de la autoridad y .gitleaks.toml no suma excepciones
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
