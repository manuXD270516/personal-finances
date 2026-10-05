---
id: TC-IDENTITY-EXPORT-005
title: "El archivo de export se guarda cifrado y se detecta cualquier alteración"
spec: identity/workspace-portability
related_specs: []
requirement: "Archivo de export cifrado en reposo"
scenario: "Objeto almacenado cifrado"
requirement_status: provisional
fr: [FR-IDENTITY-010]
nfr: [NFR-SEC-006]
invariants: []
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["export", "encryption"]
error_code: "EXPORT_FILE_CORRUPTED"
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz) con OWNER \"U1\", EDITOR \"U2\" y VIEWER \"U3\""
  - "\"Bank A\" 3099.10 BOB, \"Wallet USDT\" 50.000000 USDT, tarjeta \"Visa\" con deuda 520.00 BOB"
  - "Tasa PARALLEL USDT/BOB 12.02 vigente"
  - "Export de \"W1\" terminado"
input:
  - "{\"read\":\"objeto directo del bucket exports\"}"
  - "{\"tamper\":\"cambiar un byte del objeto\"}"
steps:
  - "Leer el objeto con el cliente S3 sin pasar por la API"
  - "Alterar un byte y descargar por la API"
expected_result:
  - "El objeto no empieza con la firma ZIP \"PK\" ni contiene \"Bank A\""
  - "iam.workspace_export guarda keyId y wrappedKey; el bucket no contiene la clave"
  - "Alterado: 422 EXPORT_FILE_CORRUPTED sin bytes de contenido entregados"
created: 2026-10-05
updated: 2026-10-05
---

# TC-IDENTITY-EXPORT-005 — El archivo de export se guarda cifrado y se detecta cualquier alteración

## Intención

Cifrado de sobre (decisión 4 de add-workspace-export): el almacenamiento nunca tiene el ZIP en claro.

## Escenario

```gherkin
Dado un export terminado de "W1"
Cuando se lee el objeto directamente del almacenamiento
Entonces su contenido no es un archivo comprimido legible ni contiene "Bank A"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
