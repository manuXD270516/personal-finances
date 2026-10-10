# Spec Delta

## ADDED Requirements

### Requirement: Recorrido de una definición recurrente
La definición recurrente DEBE (MUST) declarar su máquina de estados —`ACTIVE`, `PAUSED` y `ENDED`, este terminal, con las transiciones crear (a `ACTIVE`), pausar (`ACTIVE` a `PAUSED`), reanudar (`PAUSED` a `ACTIVE`), revisar (`ACTIVE` o `PAUSED` al mismo estado, con versión nueva y fecha efectiva) y terminar (`ACTIVE` o `PAUSED` a `ENDED`), cada una con el hecho que publica— y su recorrido DEBE (MUST) mostrar cada transición con actor, instante, motivo si lo hay, versión de la definición y cantidad de ocurrencias canceladas, reinstauradas o reescritas; renombrar o cambiar la descripción DEBEN (MUST) aparecer como anotaciones; una transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-AUDIT-009, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Recorrido del alquiler revisado
- **CUANDO** el EDITOR crea el "Alquiler" de 3500.00 BOB, lo pausa el 2026-10-10, lo reanuda el 2026-10-12 y lo revisa a 3800.00 BOB desde 2027-01-05
- **ENTONCES** el recorrido muestra crear, pausar, reanudar y revisar en orden, con la versión 2 y la fecha efectiva 2027-01-05 en la revisión

#### Scenario: Reanudar una definición terminada
- **CUANDO** el EDITOR intenta reanudar el "Internet" terminado
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

### Requirement: Recorrido de una ocurrencia recurrente
La ocurrencia recurrente DEBE (MUST) declarar su máquina de estados —`SCHEDULED`, `DUE`, `OVERDUE`, `MATERIALIZED`, `MATCHED`, `SKIPPED` y `CANCELLED`, siendo `SKIPPED` terminal— con las transiciones generar, pasar a próxima, atrasar, materializar, vincular, omitir, liberar (de `MATERIALIZED` o `MATCHED` a `DUE` u `OVERDUE`), cancelar y reinstaurar (de `CANCELLED` a `SCHEDULED`); su recorrido DEBE (MUST) mostrar cada transición con actor (usuario o proceso), instante, motivo y la transacción creada o vinculada, y la edición de monto o fecha DEBE (MUST) aparecer como anotación; una transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-AUDIT-009, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Recorrido del internet de octubre
- **CUANDO** se genera la ocurrencia del 2026-10-20 del "Internet", pasa a próxima el 2026-10-17, el EDITOR cambia su monto a 210.00 BOB y la aprueba el 2026-10-20
- **ENTONCES** el recorrido muestra generar, pasar a próxima y materializar en orden, con la edición a 210.00 BOB como anotación y el gasto creado enlazado

#### Scenario: Omitir una ocurrencia materializada
- **CUANDO** el EDITOR intenta omitir la ocurrencia ya materializada del 2026-10-20
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y la ocurrencia no cambia
