## MODIFIED Requirements

### Requirement: Anulación o revisión de la transacción de un movimiento
Cuando se anule una transacción que respalda un aporte real o un retiro de una meta, el sistema DEBE (MUST) registrar un movimiento inverso por el mismo monto que referencia el movimiento original, sin borrar ni editar el original; cuando se revise financieramente una transferencia que respalda un aporte real, DEBE (MUST) registrar el inverso del aporte anterior y, si el destino revisado sigue vinculado a la meta, un aporte real nuevo por el monto revisado. Cada movimiento derivado DEBE (MUST) auditarse con actor de proceso. Si el inverso deja negativos los fondos de la meta en esa cuenta, porque después del aporte hubo retiros o reasignaciones, la anulación NO DEBE (MUST NOT) bloquearse: antes de confirmarla el sistema DEBE (MUST) avisar, para cada meta afectada, la cuenta y los fondos que quedarán, y después la meta DEBE (MUST) informar esos fondos negativos de la cuenta como faltante a regularizar hasta que vuelvan a ser cero o positivos.
Trace: FR-GOALS-002, FR-GOALS-005, INV-018 · Priority: Must

#### Scenario: Transferencia anulada
- **CUANDO** "Fondo de emergencia" tiene 1500.00 BOB, 500.00 BOB de ellos por la transferencia vinculada del 2026-10-20, y esa transferencia se anula
- **ENTONCES** la meta registra un movimiento inverso de −500.00 BOB que referencia el aporte original y su saldo acumulado es 1000.00 BOB
- **Y** el historial conserva el aporte original y el inverso

#### Scenario: Transferencia revisada a 450.00 BOB
- **CUANDO** en cambio esa transferencia se revisa de 500.00 BOB a 450.00 BOB con el mismo destino
- **ENTONCES** la meta registra el inverso de −500.00 BOB y un aporte real de 450.00 BOB, y su saldo acumulado es 1450.00 BOB

#### Scenario: Destino revisado a una cuenta no vinculada
- **CUANDO** en cambio esa transferencia se revisa para que su destino sea "Efectivo BOB", no vinculada
- **ENTONCES** la meta registra solo el inverso de −500.00 BOB y su saldo acumulado es 1000.00 BOB

#### Scenario: Aviso antes de anular un aporte con un retiro posterior
- **CUANDO** "Fondo de emergencia" tiene en "Ahorro BOB" un aporte real de 1000.00 BOB por la transferencia del 2026-10-01 y un retiro de 400.00 BOB del 2026-10-10, y el EDITOR pide anular la transferencia del 2026-10-01
- **ENTONCES** antes de confirmar se le avisa que "Fondo de emergencia" quedará con −400.00 BOB en "Ahorro BOB"
- **Y** la anulación no se rechaza

#### Scenario: Fondos negativos después de anular
- **CUANDO** el EDITOR confirma esa anulación
- **ENTONCES** la meta registra el inverso de −1000.00 BOB, su saldo acumulado es −400.00 BOB y conserva el aporte, el retiro y el inverso en el historial
- **Y** la meta informa fondos negativos de −400.00 BOB en "Ahorro BOB" como faltante a regularizar
