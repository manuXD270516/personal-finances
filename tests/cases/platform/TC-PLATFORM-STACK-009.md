---
id: TC-PLATFORM-STACK-009
title: "Las URL públicas del stack de E2E son https y el login termina con sesión"
spec: platform/local-environment
related_specs: ["identity/authentication"]
requirement: "Stack de E2E servido por HTTPS con una autoridad de prueba efímera"
scenario: "Orígenes públicos por HTTPS"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-001", "NFR-SEC-001"]
invariants: []
priority: high
type: platform
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/tls.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["e2e", "tls", "stack"]
error_code: null
preconditions:
  - "el harness de E2E con PF_E2E_PROJECT=pfos-e2e-<nombre> y prefijo de puertos 3 o 4"
input: {}
steps:
  - "el global setup levanta el stack con los perfiles core, ml y tls"
  - "se leen WEB_PUBLIC_URL, OIDC_PUBLIC_BASE_URL y OBJECT_STORAGE_PUBLIC_ENDPOINT del .env desechable"
  - "el usuario de prueba owner inicia sesión"
expected_result:
  - "las tres URL usan https://localhost con el puerto TLS de la corrida"
  - "el login termina en la aplicación con la cookie de sesión presente"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-STACK-009 — Las URL públicas del stack de E2E son https y el login termina con sesión

## Intención

Prueba que el esquema del stack de E2E es el de producción (D516) sin tocar la cookie: es la condición para que WebKit tenga sesión.

## Escenario

```gherkin
Dado el harness de E2E con PF_E2E_PROJECT=pfos-e2e-<nombre> y prefijo de puertos 3 o 4
Cuando el global setup levanta el stack con los perfiles core, ml y tls
  Y se leen WEB_PUBLIC_URL, OIDC_PUBLIC_BASE_URL y OBJECT_STORAGE_PUBLIC_ENDPOINT del .env desechable
  Y el usuario de prueba owner inicia sesión
Entonces las tres URL usan https://localhost con el puerto TLS de la corrida
  Y el login termina en la aplicación con la cookie de sesión presente
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
