## MODIFIED Requirements

### Requirement: Asientos balanceados por moneda
El sistema DEBE (MUST) aceptar un asiento solo si, para cada moneda presente en sus postings, la suma de los montos es exactamente cero, sin conversión implícita entre monedas; un asiento desbalanceado DEBE (MUST) rechazarse con `LEDGER_UNBALANCED_ENTRY` sin persistir ningún posting, tanto en el dominio como al confirmar la transacción de base de datos, sea la escritura asiento a asiento o por conjunto; un asiento desbalanceado en una escritura por conjunto DEBE (MUST) revertir todas las filas de esa transacción.
Trace: FR-LEDGER-001, NFR-DATA-004 · Priority: Must

#### Scenario: Asiento entre monedas balanceado solo por valor
- **CUANDO** se registra un asiento con los postings +100.00 USD en "USD Savings" y -690.00 BOB en "Bank A"
- **ENTONCES** se rechaza con `LEDGER_UNBALANCED_ENTRY` indicando el residuo +100.00 USD y -690.00 BOB
- **Y** no se persiste ningún posting ni se publica ningún evento

#### Scenario: Diferencia de una unidad menor en la misma moneda
- **CUANDO** se registra un asiento con +100.00 BOB en `EXPENSE:BOB` y -99.99 BOB en "Bank A"
- **ENTONCES** se rechaza con `LEDGER_UNBALANCED_ENTRY` indicando el residuo +0.01 BOB

#### Scenario: Conversión USDT a BOB balanceada por moneda
- **CUANDO** se registra un asiento con -100.000000 USDT en "Binance USDT", +100.000000 USDT en `EQUITY:FX_TRADING:USDT`, -690.00 BOB en `EQUITY:FX_TRADING:BOB`, +685.00 BOB en "Bank A" y +5.00 BOB en `EXPENSE:BOB`
- **ENTONCES** el asiento se acepta porque la suma en USDT es 0.000000 USDT y la suma en BOB es 0.00 BOB

#### Scenario: Transferencia en la misma moneda balancea y preserva el patrimonio
- **CUANDO** se registra el asiento de una transferencia de 300.00 BOB con +300.00 BOB en "Bank B" (saldo 0.00 BOB) y -300.00 BOB en "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** el asiento se acepta con exactamente dos postings que suman 0.00 BOB
- **Y** el saldo de "Bank A" es 700.00 BOB, el de "Bank B" es 300.00 BOB y la suma de ambos sigue siendo 1000.00 BOB

#### Scenario: Barrera de base de datos al confirmar
- **CUANDO** una escritura directa en la base de datos con el rol de aplicación inserta un asiento con +50.00 BOB y -49.00 BOB y confirma la transacción
- **ENTONCES** la confirmación falla y no queda ninguna fila del asiento
- **Y** un asiento con +50.00 BOB y -50.00 BOB insertado posting a posting en la misma transacción se confirma con éxito

#### Scenario: Barrera de base de datos en una escritura por conjunto
- **CUANDO** una escritura por conjunto con el rol de aplicación inserta en una transacción 200 asientos de +18.00 BOB y -18.00 BOB, salvo el asiento 137, que lleva +18.00 BOB y -17.00 BOB, y confirma la transacción
- **ENTONCES** la confirmación falla con `LEDGER_UNBALANCED_ENTRY`
- **Y** no queda ninguna fila de los 200 asientos ni de sus postings

### Requirement: Asiento con al menos dos postings distintos de cero
El sistema DEBE (MUST) rechazar un asiento con menos de dos postings con `LEDGER_ENTRY_TOO_FEW_POSTINGS` y un asiento con algún posting de monto cero con `LEDGER_ZERO_AMOUNT_POSTING`.
Trace: FR-LEDGER-001 · Priority: Must

#### Scenario: Asiento con un solo posting
- **CUANDO** se registra un asiento con un único posting de +150.00 BOB en `EXPENSE:BOB`
- **ENTONCES** se rechaza con `LEDGER_ENTRY_TOO_FEW_POSTINGS`

#### Scenario: Barrera de base de datos para un asiento sin postings suficientes
- **CUANDO** una escritura por conjunto con el rol de aplicación inserta en una transacción 3 asientos, dos con +18.00 BOB y -18.00 BOB y uno solo con +18.00 BOB, y confirma la transacción
- **ENTONCES** la confirmación falla con `LEDGER_ENTRY_TOO_FEW_POSTINGS` y no queda ninguna fila de los 3 asientos
- **Y** con las mismas filas, `SET CONSTRAINTS ALL IMMEDIATE` falla en ese momento con el mismo código antes de confirmar

#### Scenario: Posting de monto cero
- **CUANDO** se registra un asiento con +150.00 BOB en `EXPENSE:BOB`, -150.00 BOB en "Efectivo BOB" y 0.00 BOB en `EQUITY:ADJUSTMENTS:BOB`
- **ENTONCES** se rechaza con `LEDGER_ZERO_AMOUNT_POSTING` y no se persiste nada
