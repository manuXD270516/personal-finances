# transactions/transfers Specification

## Purpose
Define el movimiento de dinero entre dos cuentas propias del workspace en la misma moneda, incluido el pago de una tarjeta de crédito, como un único hecho que preserva el patrimonio neto (salvo una comisión explícita) y nunca se cuenta como ingreso ni como gasto.

## Requirements

### Requirement: Transferencia entre cuentas propias
El sistema DEBE (MUST) registrar una transferencia entre dos cuentas propias de la misma moneda como un único asiento balanceado (entrada en destino, salida en origen) que preserva el patrimonio neto y NO DEBE (MUST NOT) contarse como ingreso ni como gasto.
Trace: FR-TRANSACTIONS-018, FR-LEDGER-001, INV-009, INV-004 · Priority: Must

#### Scenario: La transferencia preserva el patrimonio neto
- **CUANDO** el usuario transfiere 300.00 BOB de la cuenta "A" (saldo 1000.00 BOB) a la cuenta "B" (saldo 0.00 BOB) el 2026-03-15
- **ENTONCES** el saldo de "A" es 700.00 BOB y el de "B" es 300.00 BOB
- **Y** el patrimonio neto sigue siendo 1000.00 BOB
- **Y** los movimientos del asiento suman 0.00 BOB y los ingresos y gastos de marzo de 2026 no cambian

### Requirement: Origen y destino distintos
El sistema DEBE (MUST) rechazar con `TRANSFER_SAME_ACCOUNT` una transferencia cuyo origen y destino sean la misma cuenta, sin persistir nada.
Trace: FR-TRANSACTIONS-018 · Priority: Must

#### Scenario: Transferir a la misma cuenta
- **CUANDO** el usuario transfiere 100.00 BOB de "Bank A" (saldo 1000.00 BOB) a "Bank A"
- **ENTONCES** se rechaza con el código `TRANSFER_SAME_ACCOUNT` y el saldo sigue en 1000.00 BOB

### Requirement: Transferencia entre monedas distintas orientada a conversión
El sistema DEBE (MUST) rechazar con `TRANSFER_CURRENCY_MISMATCH` una transferencia entre cuentas de monedas distintas, indicando en la respuesta que el movimiento debe registrarse como conversión, sin persistir nada.
Trace: FR-TRANSACTIONS-020, FR-TRANSACTIONS-004, INV-002 · Priority: Must

#### Scenario: Bolivianos hacia una cuenta en dólares
- **CUANDO** el usuario transfiere 100.00 BOB de "Bank A" (BOB, saldo 1000.00 BOB) a "USD Savings" (USD, saldo 500.00 USD)
- **ENTONCES** se rechaza con el código `TRANSFER_CURRENCY_MISMATCH` y el detalle sugiere registrar una conversión
- **Y** los saldos siguen en 1000.00 BOB y 500.00 USD

### Requirement: Transferencia con comisión
Una transferencia PUEDE incluir una comisión pagada desde la cuenta origen; cuando la incluye, el sistema DEBE (MUST) registrarla en el mismo asiento como gasto en la categoría de sistema "Fees" (u otra categoría de gasto indicada), de modo que el patrimonio neto baje exactamente el monto de la comisión. La comisión DEBE (MUST) estar en la moneda de la transferencia; una comisión en otra moneda NO DEBE (MUST NOT) aceptarse como comisión de transferencia: se rechaza con `TRANSFER_CURRENCY_MISMATCH` sin persistir nada y se registra como conversión o como gasto aparte (docs/31 D40).
Trace: FR-TRANSACTIONS-019, INV-009, INV-004 · Priority: Should

#### Scenario: Transferencia interbancaria con comisión
- **CUANDO** el usuario transfiere 1000.00 BOB de "Bank A" (saldo 2000.00 BOB) a "Bank B" (saldo 0.00 BOB) con una comisión de 10.00 BOB
- **ENTONCES** el saldo de "Bank A" es 990.00 BOB y el de "Bank B" es 1000.00 BOB
- **Y** el gasto en "Fees" aumenta 10.00 BOB y el patrimonio neto baja exactamente 10.00 BOB
- **Y** el asiento suma 0.00 BOB (1000.00 + 10.00 - 1010.00)

#### Scenario: Comisión en otra moneda rechazada
- **CUANDO** el usuario transfiere 1000.00 BOB de "Bank A" (saldo 2000.00 BOB) a "Bank B" (saldo 0.00 BOB) con una comisión de 1.50 USD
- **ENTONCES** se rechaza con el código `TRANSFER_CURRENCY_MISMATCH` señalando la moneda de la comisión, y no se crea asiento ni evento de transferencia
- **Y** los saldos siguen en 2000.00 BOB y 0.00 BOB, y la comisión en USD debe registrarse como conversión o como gasto aparte

### Requirement: Pago de tarjeta de crédito como transferencia
El pago de una tarjeta de crédito desde una cuenta de activo DEBE (MUST) registrarse como transferencia de la cuenta de activo a la cuenta de pasivo de la tarjeta, reduciendo la deuda y el saldo del activo por el mismo monto, y NO DEBE (MUST NOT) contarse como gasto.
Trace: FR-TRANSACTIONS-018, INV-030, INV-009 · Priority: Must

#### Scenario: Pagar el consumo del mes de la tarjeta
- **CUANDO** "Credit Card" adeuda 350.00 BOB por un gasto en "Household" y el usuario transfiere 350.00 BOB de "Bank A" (saldo 1000.00 BOB) a "Credit Card" el 2026-03-25
- **ENTONCES** el saldo de "Bank A" es 650.00 BOB y la deuda de "Credit Card" es 0.00 BOB
- **Y** el gasto de marzo de 2026 en "Household" sigue en 350.00 BOB y el patrimonio neto no cambia con el pago

#### Scenario: Pagar la tarjeta con QR
- **CUANDO** "Credit Card" adeuda 350.00 BOB y el usuario paga 350.00 BOB con QR desde "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** se registra una transferencia con medio de pago `QR`, el saldo de "Bank A" es 650.00 BOB y la deuda de "Credit Card" es 0.00 BOB
- **Y** el pago no se cuenta como gasto

### Requirement: Medio de pago en transferencias
Una transferencia DEBE (MUST) admitir el mismo medio de pago opcional que las demás transacciones (incluido `QR` para transferencias entre cuentas propias o pagos de tarjeta), sin alterar sus asientos.
Trace: FR-TRANSACTIONS-034 · Priority: Must

#### Scenario: Transferencia por QR entre cuentas propias
- **CUANDO** el usuario transfiere 200.00 BOB por QR de "Bank A" (1000.00 BOB) a "Bank B" (0.00 BOB)
- **ENTONCES** "Bank A" queda en 800.00 BOB, "Bank B" en 200.00 BOB, el patrimonio neto no cambia y la transferencia tiene medio de pago `QR`

### Requirement: Cuentas no activas en transferencias
El sistema DEBE (MUST) rechazar una transferencia cuyo origen o destino sea una cuenta archivada (`ACCOUNT_ARCHIVED`) o cerrada (`ACCOUNT_CLOSED`), sin persistir nada.
Trace: FR-ACCOUNTS-007, INV-026 · Priority: Must

#### Scenario: Transferir hacia una cuenta archivada
- **CUANDO** el usuario transfiere 100.00 BOB de "Bank A" (saldo 1000.00 BOB) a "Bank B" archivada
- **ENTONCES** se rechaza con el código `ACCOUNT_ARCHIVED` y el saldo de "Bank A" sigue en 1000.00 BOB

### Requirement: Publicación de transferencia completada
Cuando una transferencia queda posteada (al crearse posteada o al pasar de `pending` a `posted`), el sistema DEBE (MUST) publicar en la misma transacción de base de datos el evento `transactions.TransferCompleted.v1` con origen, destino, monto y comisión; una transferencia `pending` NO DEBE (MUST NOT) publicarlo ni tener asiento.
Trace: FR-TRANSACTIONS-018, FR-TRANSACTIONS-007, INV-023 · Priority: Must

#### Scenario: Transferencia pendiente que luego se postea
- **CUANDO** el usuario registra como `pending` una transferencia de 300.00 BOB de "Bank A" a "Bank B"
- **ENTONCES** no existe asiento ni evento de transferencia completada y los saldos no cambian
- **Y** al postearla se publica exactamente un evento de transferencia completada con monto 300.00 BOB y comisión nula
