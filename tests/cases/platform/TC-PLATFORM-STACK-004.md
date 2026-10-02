---
id: TC-PLATFORM-STACK-004
title: El backup local y su restore devuelven la base y el object storage al estado respaldado
spec: platform/local-environment
related_specs: []
requirement: Comandos operativos
scenario: Ida y vuelta de backup y restore
requirement_status: confirmed
fr: []
nfr:
- NFR-PORT-004
invariants: []
priority: high
type: platform
level: container-integration
automation_status: automated
automated_tests: ["scripts/stack/test/stack/stack.stack.test.ts"]
status: automated
regression_suite: false
phase: 1
tags:
- backup
- restore
- windows
error_code: null
preconditions:
- Stack core en ejecución con la Minimal Seed cargada
- Al menos un objeto almacenado en el object storage local
- Huella (conteos por tabla + checksums de objetos) tomada antes del backup
input:
  backup_command: pnpm backup:local
  restore_command: pnpm restore:local
  shells:
  - PowerShell (Windows)
  - bash (Linux CI)
steps:
- Ejecutar el backup local
- Modificar datos en la base y borrar/agregar un objeto en el object storage
- Ejecutar el restore local con el backup generado
- Comparar base y objetos con la huella tomada antes del backup
expected_result:
- Ambos comandos terminan con código 0 en Windows (PowerShell) y en Linux
- Tras el restore, conteos por tabla y checksums de objetos coinciden con la huella previa
- Los cambios hechos después del backup ya no existen
- El invariant checker del ledger no reporta violaciones
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-004 — El backup local y su restore devuelven la base y el object storage al estado respaldado

## Intención

Los comandos operativos deben ser multiplataforma y el backup local es la red de seguridad del uso real antes de cloud (NFR-REL-004).

## Escenario

```gherkin
Dado un backup local recién generado
Cuando el desarrollador modifica datos y ejecuta el restore con ese backup
Entonces la base y el object storage vuelven al estado respaldado
```

## Notas

- Se ejecuta también en PowerShell para verificar que ningún comando depende de un shell exclusivo de POSIX.
- El invariant checker del ledger se aplica cuando exista el contexto Ledger; mientras tanto el dataset de plataforma se verifica por conteos y `platform.seed_run`.
