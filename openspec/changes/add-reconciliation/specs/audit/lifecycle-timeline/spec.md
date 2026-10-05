# Spec Delta

## Purpose

Extiende el recorrido trazable (docs/31 D37) a la sesión de reconciliación, nuevo agregado con ciclo de vida de Phase 2, y hace visible en el recorrido de cada transacción en qué sesión y contra qué extracto se reconcilió.

## ADDED Requirements

### Requirement: Recorrido de una sesión de reconciliación
La sesión de reconciliación DEBE (MUST) declarar su máquina de estados —`IN_PROGRESS`, `COMPLETED` y `CANCELLED`, estos dos terminales, con las transiciones iniciar (a `IN_PROGRESS`), finalizar (`IN_PROGRESS` a `COMPLETED`, publica el hecho "reconciliación completada") y cancelar (`IN_PROGRESS` a `CANCELLED`)— y su recorrido DEBE (MUST) mostrar cada transición con actor, instante, motivo si lo hay, saldo del extracto, saldo confirmado, diferencia y, si hubo ajuste, la transacción de ajuste; los confirmados y desconfirmados dentro de la sesión y las des-reconciliaciones posteriores DEBEN (MUST) aparecer como anotaciones.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Recorrido de una sesión finalizada con ajuste
- **CUANDO** el usuario inicia la sesión de "Bank A" al 2026-03-31 por 3345.00 BOB, confirma el gasto de 45.90 BOB dentro de ella y la finaliza con un ajuste de 5.00 BOB
- **ENTONCES** el recorrido muestra iniciar y finalizar en orden, con saldo del extracto 3345.00 BOB, diferencia final 0.00 BOB y el ajuste de 5.00 BOB enlazado
- **Y** muestra la confirmación del gasto de 45.90 BOB como anotación

#### Scenario: Transición no declarada de una sesión
- **CUANDO** el usuario intenta finalizar una sesión `CANCELLED`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

### Requirement: Reconciliación en el recorrido de una transacción
La transición reconciliar de una transacción DEBE (MUST) registrar la sesión que la originó con su fecha y saldo de extracto, y la transacción de ajuste creada por una sesión DEBE (MUST) mostrar en su recorrido el registro y la reconciliación referenciando esa sesión.
Trace: FR-AUDIT-010, FR-TRANSACTIONS-030, FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Recorrido de un gasto reconciliado en sesión
- **CUANDO** el gasto de 150.00 BOB del 2026-03-05 se registró posteado, se confirmó y se reconcilió al finalizar la sesión de "Bank A" al 2026-03-31
- **ENTONCES** su recorrido muestra registrar, confirmar y reconciliar en orden, y la transición reconciliar enlaza la sesión al 2026-03-31 por 3350.00 BOB

#### Scenario: Recorrido del ajuste de una sesión
- **CUANDO** se consulta el recorrido del ajuste de 5.00 BOB creado al finalizar la sesión al 2026-03-31
- **ENTONCES** muestra registrar (con su asiento) y reconciliar, ambas referenciando esa sesión
