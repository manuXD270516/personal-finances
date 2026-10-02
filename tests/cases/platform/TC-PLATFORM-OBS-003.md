---
id: TC-PLATFORM-OBS-003
title: El log de una petición con header Authorization no contiene el valor del token
spec: platform/observability
related_specs: []
requirement: Logs estructurados y correlacionados
scenario: Datos sensibles excluidos
requirement_status: confirmed
fr: []
nfr:
- NFR-OBS-001
- NFR-SEC-015
invariants: []
priority: critical
type: security
level: application
automation_status: automated
automated_tests: ["apps/api/test/api/correlation.api.test.ts", "packages/platform/src/logging/logger.test.ts"]
status: automated
regression_suite: false
phase: 1
tags:
- logging
- redaction
- security
error_code: null
preconditions:
- finance-api bajo prueba con el logger real y salida capturada
input:
  endpoint: GET /health/ready
  header: 'Authorization: Bearer token-ficticio-de-prueba'
steps:
- Enviar la petición con el header Authorization
- Capturar las líneas de log emitidas por finance-api
- Buscar el valor del token en la salida
expected_result:
- Ninguna línea de log contiene la cadena token-ficticio-de-prueba
- Si el header se registra, aparece redactado (p. ej. [REDACTED])
- Tampoco aparecen cookies de sesión ni contenido de documentos
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-OBS-003 — El log de una petición con header Authorization no contiene el valor del token

## Intención

Los logs no deben convertirse en una fuente de filtración de credenciales (NFR-SEC-015).

## Escenario

```gherkin
Dada una petición con un header de autorización
Cuando se registra la petición
Entonces la entrada de log no contiene el valor del token
```

## Notas

- El token es un valor ficticio del test; nunca un token real.
