## MODIFIED Requirements

### Requirement: Los splits suman exactamente el total
La suma de los montos de los splits DEBE (MUST) ser exactamente igual al monto de la transacción en su moneda; de lo contrario el sistema DEBE (MUST) rechazar la operación con `SPLITS_DO_NOT_SUM` sin persistir nada, y cada split posteado DEBE (MUST) reflejarse como un movimiento nominal propio en el asiento. Además, la base de datos DEBE (MUST) rechazar al confirmar la transacción de base de datos toda transacción nominal cuyos splits vigentes no sumen el monto esperado, sea la escritura fila a fila, por conjunto o en varias sentencias.
Trace: FR-TRANSACTIONS-026, INV-021, INV-004 · Priority: Must

#### Scenario: Compra dividida en tres categorías
- **CUANDO** el usuario registra un gasto posteado de 150.00 BOB en "Bank A" (saldo 1000.00 BOB) dividido en 100.00 BOB "Groceries", 35.50 BOB "Household" y 14.50 BOB "Personal care"
- **ENTONCES** el asiento tiene tres movimientos de gasto de 100.00, 35.50 y 14.50 BOB, cada uno asociado a su split, y uno de -150.00 BOB en "Bank A"
- **Y** el saldo de "Bank A" es 850.00 BOB

#### Scenario: Splits que no cuadran por un centavo
- **CUANDO** el usuario registra un gasto de 150.00 BOB dividido en 100.00, 35.50 y 14.49 BOB (suma 149.99 BOB)
- **ENTONCES** se rechaza con el código `SPLITS_DO_NOT_SUM` y no se persiste ninguna transacción ni asiento

#### Scenario: Barrera de base de datos de los splits al confirmar
- **CUANDO** una escritura con el rol de aplicación revisa un gasto de 150.00 BOB a 175.00 BOB en tres sentencias de la misma transacción (cambia el monto, reemplaza el split vigente de 150.00 BOB e inserta uno de 175.00 BOB) y confirma
- **ENTONCES** la confirmación tiene éxito aunque el estado intermedio no sumaba
- **Y** si cambia el monto a 175.00 BOB sin reemplazar el split, la confirmación falla por la restricción `transaction_splits_sum_ck` y la transacción conserva 150.00 BOB
- **Y** una escritura por conjunto de 200 gastos de 18.00 BOB con un split de 17.00 BOB inyectado en el gasto 59 falla al confirmar y no deja ninguna de las 200 transacciones
