---
id: TC-PLATFORM-HOSTOPS-005
title: "El deploy crea el archivo de la clave privada vacío con 0400 y dueño 1000, y normaliza uno existente sin tocarlo"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Clave privada de las conexiones disponible solo para el worker"
scenario: "Primer deploy sin la clave"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-007"]
invariants: []
priority: critical
type: platform
level: unit
automation_status: automated
automated_tests:
  - "scripts/host-ops/test/hostops.test.ts"
status: automated
regression_suite: false
phase: 9
tags: ["host","deploy","secrets","connections","add-host-restore-drill"]
error_code: null
preconditions:
  - "Harness scripts/host-ops con PFOS_ETC_DIR temporal; doble de docker para pull, compose y smoke"
input: {"cases":[{"file":null},{"file":"k1:<clave ficticia de prueba>","mode":"0644"}]}
steps:
  - "Ejecutar pfos-deploy.sh deploy sin el archivo"
  - "Ejecutar pfos-deploy.sh deploy con el archivo en 0644 y contenido ficticio"
  - "Ejecutar pfos-deploy.sh rollback"
expected_result:
  - "Sin archivo: queda un archivo vacío con dueño 1000:1000 y modo 0400"
  - "Con archivo 0644: queda 0400 y dueño 1000 con el mismo contenido byte a byte"
  - "El rollback también asegura el archivo antes de levantar el release"
created: 2026-11-24
updated: 2026-11-24
---

# TC-PLATFORM-HOSTOPS-005 — El deploy crea el archivo de la clave privada vacío con 0400 y dueño 1000, y normaliza uno existente sin tocarlo

## Intención

Requirement «Clave privada de las conexiones disponible solo para el worker» de `platform/delivery-pipeline` (change `add-host-restore-drill`, C5, C6 y C10 del despliegue N1).

## Escenario

```gherkin
Dado un host sin el archivo de la clave privada
Cuando se despliega un release
Entonces el archivo existe vacío con dueño 1000 y permisos 0400
```

## Notas

- Cubre también el scenario «Clave ya cargada con permisos abiertos». Las pruebas de dueño requieren root o un espacio de nombres de usuario; si el runner no lo permite, el harness comprueba los argumentos de install, chown y chmod.
- La clave del caso de prueba es ficticia; nunca una clave real (repositorio público).
