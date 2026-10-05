# transactions/splits Specification

## Purpose
Define cómo la porción nominal de un ingreso, gasto o reembolso se divide en splits clasificados (categoría, tags, notas) que suman exactamente el monto de la transacción, de modo que la clasificación viva fuera del ledger y pueda cambiar sin reescribir asientos.

## Requirements

### Requirement: Al menos un split por transacción nominal
Todo ingreso, gasto o reembolso DEBE (MUST) tener al menos un split; si el usuario no indica splits, el sistema DEBE (MUST) crear uno solo por el monto total en la categoría de sistema "Uncategorized".
Trace: FR-TRANSACTIONS-026, FR-CLASSIFICATION-003 · Priority: Must

#### Scenario: Gasto sin categoría
- **CUANDO** el usuario registra un gasto de 75.00 BOB en "Bank A" sin indicar splits
- **ENTONCES** la transacción tiene un único split de 75.00 BOB en "Uncategorized"

### Requirement: Los splits suman exactamente el total
La suma de los montos de los splits DEBE (MUST) ser exactamente igual al monto de la transacción en su moneda; de lo contrario el sistema DEBE (MUST) rechazar la operación con `SPLITS_DO_NOT_SUM` sin persistir nada, y cada split posteado DEBE (MUST) reflejarse como un movimiento nominal propio en el asiento.
Trace: FR-TRANSACTIONS-026, INV-021, INV-004 · Priority: Must

#### Scenario: Compra dividida en tres categorías
- **CUANDO** el usuario registra un gasto posteado de 150.00 BOB en "Bank A" (saldo 1000.00 BOB) dividido en 100.00 BOB "Groceries", 35.50 BOB "Household" y 14.50 BOB "Personal care"
- **ENTONCES** el asiento tiene tres movimientos de gasto de 100.00, 35.50 y 14.50 BOB, cada uno asociado a su split, y uno de -150.00 BOB en "Bank A"
- **Y** el saldo de "Bank A" es 850.00 BOB

#### Scenario: Splits que no cuadran por un centavo
- **CUANDO** el usuario registra un gasto de 150.00 BOB dividido en 100.00, 35.50 y 14.49 BOB (suma 149.99 BOB)
- **ENTONCES** se rechaza con el código `SPLITS_DO_NOT_SUM` y no se persiste ninguna transacción ni asiento

### Requirement: Reparto determinista por porcentaje o partes iguales
Al repartir un monto por porcentajes o en partes iguales, el sistema DEBE (MUST) redondear a la escala de la moneda con el método de mayor residuo (desempate por el índice menor), de modo que la suma sea exacta y el mismo pedido produzca siempre el mismo resultado.
Trace: FR-TRANSACTIONS-027, NFR-DATA-003, INV-020 · Priority: Must

#### Scenario: Tres partes iguales de 100.00 BOB
- **CUANDO** el usuario reparte un gasto de 100.00 BOB en tres partes iguales
- **ENTONCES** los splits son 33.34, 33.33 y 33.33 BOB y suman 100.00 BOB

#### Scenario: Porcentajes sobre un monto en USDT
- **CUANDO** el usuario reparte un gasto de 10.000001 USDT en 50 % y 50 %
- **ENTONCES** los splits son 5.000001 y 5.000000 USDT y repetir el reparto da el mismo resultado

### Requirement: Cambiar montos de splits repostea la transacción
Cambiar los montos de los splits de una transacción posteada DEBE (MUST) generar la reversa del asiento activo y un asiento nuevo con los nuevos splits, conservando los splits anteriores como históricos referenciados por los asientos previos.
Trace: FR-TRANSACTIONS-028, INV-008, INV-021 · Priority: Must

#### Scenario: Mover 20.00 BOB entre categorías de un gasto dividido
- **CUANDO** un gasto posteado de 150.00 BOB con splits 100.00 BOB "Groceries" y 50.00 BOB "Household" cambia a 80.00 BOB "Groceries" y 70.00 BOB "Household"
- **ENTONCES** existe una reversa del asiento anterior y un asiento nuevo con movimientos de gasto de 80.00 y 70.00 BOB
- **Y** el saldo de la cuenta no cambia y el gasto de marzo es 80.00 BOB en "Groceries" y 70.00 BOB en "Household"

### Requirement: Cambiar la clasificación de un split sin tocar el ledger
Cambiar solo la categoría, los tags o las notas de un split DEBE (MUST) aplicarse sin crear, modificar ni revertir asientos, auditarse con diff y publicar el evento `transactions.TransactionCategorized.v1` con el cambio por split.
Trace: FR-TRANSACTIONS-028, FR-LEDGER-008, INV-033 · Priority: Must

#### Scenario: Recategorizar un split de 35.50 BOB
- **CUANDO** el usuario cambia de "Household" a "Personal care" el split de 35.50 BOB de un gasto posteado de 150.00 BOB
- **ENTONCES** la cantidad de asientos y el saldo de la cuenta no cambian
- **Y** el gasto de marzo en "Household" baja 35.50 BOB y en "Personal care" sube 35.50 BOB
- **Y** se publica un evento de transacción categorizada con la categoría anterior y la nueva del split

### Requirement: Categorías válidas para un split
Un split nuevo o reclasificado DEBE (MUST) usar una categoría activa del workspace cuyo tipo coincida con la transacción (ingreso o gasto; un reembolso usa categoría de gasto); una categoría archivada DEBE (MUST) rechazarse con `CATEGORY_ARCHIVED` y un tipo incompatible con `CATEGORY_KIND_MISMATCH`.
Trace: FR-TRANSACTIONS-026, FR-CLASSIFICATION-002, INV-019 · Priority: Must

#### Scenario: Categoría archivada
- **CUANDO** el usuario registra un gasto de 40.00 BOB con un split en la categoría archivada "Old Gym"
- **ENTONCES** se rechaza con el código `CATEGORY_ARCHIVED`

#### Scenario: Categoría de ingreso en un gasto
- **CUANDO** el usuario registra un gasto de 40.00 BOB con un split en la categoría de ingreso "Salary"
- **ENTONCES** se rechaza con el código `CATEGORY_KIND_MISMATCH`
