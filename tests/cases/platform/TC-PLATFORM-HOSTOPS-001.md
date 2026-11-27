---
id: TC-PLATFORM-HOSTOPS-001
title: "Un deploy durante el drill falla sin cambiar nada y nombra la operación en curso"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Operaciones del host serializadas con el deploy"
scenario: "Deploy durante el drill"
requirement_status: confirmed
fr: []
nfr: ["NFR-REL-006"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/hostops.test.ts"
  - "scripts/host-ops/test/drill.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","deploy","lock","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops; el lock deploy.lock tomado por un proceso de prueba que escribió drill"
input: {"lock_holder":"drill","command":"pfos-deploy.sh deploy <sha> <api> <web> <pg>"}
steps:
  - "Ejecutar pfos-deploy.sh deploy con el lock tomado"
  - "Ejecutar pfos-backup.sh verify con el lock tomado y liberarlo a los 2 s"
expected_result:
  - "El deploy termina con error «operación del host en curso: drill» sin llamar a docker pull ni compose up"
  - "verify espera el lock y corre al liberarse"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-001 — Un deploy durante el drill falla sin cambiar nada y nombra la operación en curso

## Intención

Requirement «Operaciones del host serializadas con el deploy» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado el drill mensual en curso
Cuando se lanza un deploy
Entonces el deploy falla sin tocar el release actual e informa que hay un drill en curso
```

## Notas

- Cubre también el scenario «Verificación que coincide con el drill».
