## ADDED Requirements

### Requirement: Protección del stack de desarrollo del owner
Los comandos `pnpm stack:*` y `pnpm restore:local` DEBEN (MUST) tomar el proyecto Compose de `PF_COMPOSE_PROJECT` o, si no existe, de `PF_E2E_PROJECT`, y usar `pfos` solo cuando ninguna está definida; `PF_E2E_PROJECT` DEBE (MUST) empezar con `pfos-e2e` y, si se definen ambas con valores distintos, el comando DEBE (MUST) fallar. Toda operación que borre datos (`stack:down --volumes`, `stack:reset`, `restore:local`) sobre el proyecto `pfos` DEBE (MUST) negarse cuando no hay terminal interactiva, aunque se pase `--yes`, salvo que `PF_ALLOW_DEV_STACK_WIPE=pfos` esté definida, y el mensaje de error DEBE (MUST) explicar el motivo.
Trace: NFR-PORT-001 · Priority: Must

#### Scenario: PF_E2E_PROJECT elige el proyecto
- **CUANDO** se ejecuta un comando `stack` con `PF_E2E_PROJECT=pfos-e2e-pwa` y sin `PF_COMPOSE_PROJECT`
- **ENTONCES** opera sobre el proyecto `pfos-e2e-pwa` y no sobre `pfos`

#### Scenario: Variables contradictorias o fuera de convención
- **CUANDO** `PF_E2E_PROJECT` no empieza con `pfos-e2e`, o `PF_COMPOSE_PROJECT` y `PF_E2E_PROJECT` difieren
- **ENTONCES** el comando falla antes de invocar Docker

#### Scenario: Borrado sobre pfos sin terminal
- **CUANDO** se ejecuta `stack:down --volumes --yes` (o `stack:reset`, o `restore:local`) sobre `pfos` sin terminal interactiva y sin `PF_ALLOW_DEV_STACK_WIPE=pfos`
- **ENTONCES** el comando se niega con un mensaje que explica el motivo y no invoca Docker

#### Scenario: Terminal interactiva o proyecto desechable
- **CUANDO** el owner ejecuta la operación en una terminal interactiva, o el proyecto es distinto de `pfos`
- **ENTONCES** el comportamiento no cambia (confirmación interactiva o `--yes`)
