# ledger/journal-posting Specification

## Purpose
Registra todo hecho económico del workspace como asientos de doble entrada multi-moneda, balanceados por moneda, inmutables y corregibles solo mediante reversas, con aritmética monetaria decimal exacta y redondeo determinista. El ledger es interno: el usuario nunca ve débitos ni créditos.

## Requirements

### Requirement: Asientos balanceados por moneda
El sistema DEBE (MUST) aceptar un asiento solo si, para cada moneda presente en sus postings, la suma de los montos es exactamente cero, sin conversión implícita entre monedas; un asiento desbalanceado DEBE (MUST) rechazarse con `LEDGER_UNBALANCED_ENTRY` sin persistir ningún posting, tanto en el dominio como al confirmar la transacción de base de datos.
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

### Requirement: Asiento con al menos dos postings distintos de cero
El sistema DEBE (MUST) rechazar un asiento con menos de dos postings con `LEDGER_ENTRY_TOO_FEW_POSTINGS` y un asiento con algún posting de monto cero con `LEDGER_ZERO_AMOUNT_POSTING`.
Trace: FR-LEDGER-001 · Priority: Must

#### Scenario: Asiento con un solo posting
- **CUANDO** se registra un asiento con un único posting de +150.00 BOB en `EXPENSE:BOB`
- **ENTONCES** se rechaza con `LEDGER_ENTRY_TOO_FEW_POSTINGS`

#### Scenario: Posting de monto cero
- **CUANDO** se registra un asiento con +150.00 BOB en `EXPENSE:BOB`, -150.00 BOB en "Efectivo BOB" y 0.00 BOB en `EQUITY:ADJUSTMENTS:BOB`
- **ENTONCES** se rechaza con `LEDGER_ZERO_AMOUNT_POSTING` y no se persiste nada

### Requirement: Moneda del posting igual a la de su cuenta contable
El sistema DEBE (MUST) rechazar con `CURRENCY_MISMATCH` todo posting cuya moneda difiera de la moneda de la cuenta contable a la que se imputa.
Trace: FR-LEDGER-003 · Priority: Must

#### Scenario: Posting en USD contra una cuenta en BOB
- **CUANDO** se registra un asiento con +20.00 USD en "Bank A" (cuenta contable en BOB) y -20.00 USD en "USD Savings"
- **ENTONCES** se rechaza con `CURRENCY_MISMATCH`
- **Y** no se persiste ningún posting

### Requirement: Convención de signo débito positivo y crédito negativo
El sistema DEBE (MUST) registrar los débitos como montos positivos y los créditos como montos negativos, de modo que el saldo contable de una cuenta sea la suma con signo de sus postings.
Trace: FR-LEDGER-002 · Priority: Must

#### Scenario: Gasto en efectivo
- **CUANDO** se registra un gasto de supermercado de 150.00 BOB pagado desde "Efectivo BOB"
- **ENTONCES** el asiento contiene +150.00 BOB en `EXPENSE:BOB` y -150.00 BOB en "Efectivo BOB"

#### Scenario: Compra con tarjeta de crédito
- **CUANDO** se registra una compra de 350.00 BOB con la tarjeta "Visa BOB" (pasivo)
- **ENTONCES** el asiento contiene +350.00 BOB en `EXPENSE:BOB` y -350.00 BOB en "Visa BOB"
- **Y** el saldo contable de "Visa BOB" disminuye en 350.00 BOB

### Requirement: Cuenta contable con naturaleza y moneda únicas e inmutables
Cada cuenta contable DEBE (MUST) tener exactamente una naturaleza (`ASSET`, `LIABILITY`, `EQUITY`, `INCOME` o `EXPENSE`) y exactamente una moneda, y ninguna de las dos NO DEBE (MUST NOT) cambiar después de su creación.
Trace: FR-LEDGER-003 · Priority: Must

#### Scenario: Intento de cambiar la moneda de una cuenta contable
- **CUANDO** se intenta cambiar la moneda de la cuenta contable de "Bank A" de BOB a USD
- **ENTONCES** la operación no existe o se rechaza
- **Y** la cuenta contable sigue en BOB con naturaleza `ASSET`

### Requirement: Cuenta contable respaldada por cada cuenta del usuario
El sistema DEBE (MUST) asociar a cada cuenta del usuario exactamente una cuenta contable de naturaleza `ASSET` o `LIABILITY` en la misma moneda, obtenida con una operación idempotente que nunca crea una segunda cuenta contable para la misma cuenta del usuario.
Trace: FR-ACCOUNTS-003, FR-LEDGER-003 · Priority: Must

#### Scenario: Obtención repetida de la cuenta contable
- **CUANDO** se solicita dos veces, incluso de forma concurrente, la cuenta contable de la cuenta del usuario "Binance USDT" (moneda USDT, tipo `crypto_wallet`)
- **ENTONCES** ambas solicitudes devuelven la misma cuenta contable `ASSET` en USDT
- **Y** existe una sola cuenta contable para "Binance USDT"

#### Scenario: Tarjeta de crédito como pasivo
- **CUANDO** se obtiene la cuenta contable de la cuenta del usuario "Visa BOB" (tipo `credit_card`, moneda BOB)
- **ENTONCES** la cuenta contable es de naturaleza `LIABILITY` y moneda BOB

### Requirement: Cuentas de sistema por moneda creadas bajo demanda
El sistema DEBE (MUST) crear de forma idempotente, la primera vez que se necesitan en un workspace y moneda, las cuentas de sistema `INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:OPENING_BALANCE:<CCY>`, `EQUITY:FX_TRADING:<CCY>` y `EQUITY:ADJUSTMENTS:<CCY>`, con a lo sumo una cuenta por código, workspace y moneda.
Trace: FR-LEDGER-004 · Priority: Must

#### Scenario: Primer gasto en USDT
- **CUANDO** se registra el primer gasto en USDT del workspace por 0.100000 USDT
- **ENTONCES** se crea la cuenta `EXPENSE:USDT` de naturaleza `EXPENSE` y moneda USDT
- **Y** un segundo gasto de 2.000000 USDT reutiliza la misma cuenta `EXPENSE:USDT`

#### Scenario: Creación concurrente de la misma cuenta de sistema
- **CUANDO** dos asientos concurrentes requieren por primera vez `EQUITY:FX_TRADING:BOB`
- **ENTONCES** ambos asientos se registran contra la misma y única cuenta `EQUITY:FX_TRADING:BOB`

### Requirement: Asiento de saldo inicial contra patrimonio de apertura
El sistema DEBE (MUST) registrar un saldo inicial distinto de cero como un asiento de tipo apertura, con la fecha del saldo inicial, contra `EQUITY:OPENING_BALANCE:<CCY>` en la moneda de la cuenta, sin postings de ingreso.
Trace: FR-ACCOUNTS-004, FR-LEDGER-004 · Priority: Must

#### Scenario: Saldos iniciales de un activo y un pasivo
- **CUANDO** se registran el 2026-01-01 un saldo inicial de 2500.00 BOB para "Bank C" (activo) y una deuda inicial de 800.00 BOB para "Card X" (pasivo)
- **ENTONCES** se registran dos asientos de apertura: "Bank C" +2500.00 BOB con `EQUITY:OPENING_BALANCE:BOB` -2500.00 BOB, y "Card X" -800.00 BOB con `EQUITY:OPENING_BALANCE:BOB` +800.00 BOB
- **Y** `EQUITY:OPENING_BALANCE:BOB` se crea una sola vez y el patrimonio neto resultante es 1700.00 BOB
- **Y** no existe ningún posting en `INCOME:BOB`

### Requirement: Postings nominales referencian su split
Todo posting a una cuenta `INCOME` o `EXPENSE` DEBE (MUST) referenciar el split de la transacción que lo origina; un posting nominal sin split DEBE (MUST) rechazarse con `LEDGER_SPLIT_REQUIRED`. El ledger NO DEBE (MUST NOT) almacenar categorías.
Trace: FR-LEDGER-008 · Priority: Must

#### Scenario: Gasto dividido en tres splits
- **CUANDO** se registra una compra de 300.00 BOB con splits s1 220.00 BOB, s2 50.00 BOB y s3 30.00 BOB
- **ENTONCES** el asiento contiene +220.00 BOB, +50.00 BOB y +30.00 BOB en `EXPENSE:BOB` referenciando s1, s2 y s3, y -300.00 BOB en "Bank A" sin split

#### Scenario: Posting de gasto sin split
- **CUANDO** se registra un asiento con +15.00 BOB en `EXPENSE:BOB` sin split y -15.00 BOB en "Bank A"
- **ENTONCES** se rechaza con `LEDGER_SPLIT_REQUIRED`

### Requirement: Metadatos de trazabilidad del asiento
Cada asiento DEBE (MUST) registrar su fecha de negocio, su tipo (`STANDARD`, `REVERSAL` u `OPENING`), el origen (contexto, tipo, identificador y revisión), el actor, el identificador de correlación, el instante de creación en UTC, un número de secuencia monotónico por workspace y, si es una reversa, el asiento que revierte.
Trace: FR-LEDGER-009 · Priority: Must

#### Scenario: Asiento de un gasto registrado
- **CUANDO** el usuario U1 registra con la correlación C1 la transacción T1 (revisión 1) de 45.50 BOB con fecha de negocio 2026-03-10
- **ENTONCES** el asiento resultante registra fecha 2026-03-10, tipo `STANDARD`, origen T1 revisión 1, actor U1, correlación C1, instante de creación en UTC y una secuencia mayor que la de cualquier asiento previo del workspace

### Requirement: Registro idempotente respecto al origen
El sistema DEBE (MUST) producir como máximo un asiento vigente por origen y revisión: registrar de nuevo el mismo origen y revisión NO DEBE (MUST NOT) crear un segundo asiento y DEBE (MUST) devolver el asiento existente.
Trace: FR-LEDGER-010 · Priority: Must

#### Scenario: Reintento del registro de una transacción
- **CUANDO** se solicita dos veces el registro del asiento de la transacción T1 revisión 1 por 120.00 BOB
- **ENTONCES** existe un único asiento para T1 revisión 1 y ambas solicitudes devuelven su identificador
- **Y** el saldo de "Bank A" refleja -120.00 BOB una sola vez

### Requirement: Ledger de solo inserción (append-only)
Los asientos y postings registrados NO DEBEN (MUST NOT) modificarse ni eliminarse por ninguna vía de la aplicación; la base de datos DEBE (MUST) rechazar toda actualización, eliminación o vaciado de asientos, postings y vínculos de reversa realizada con el rol de aplicación.
Trace: FR-LEDGER-005, NFR-DATA-005 · Priority: Must

#### Scenario: Intento de modificar un posting a nivel de base de datos
- **CUANDO** con el rol de aplicación se intenta cambiar el monto del posting P1 de +120.00 BOB a +100.00 BOB, o eliminar el posting P2 de -120.00 BOB
- **ENTONCES** la base de datos rechaza ambas sentencias
- **Y** P1 sigue en +120.00 BOB y P2 en -120.00 BOB

### Requirement: Correcciones mediante asientos de reversa
El sistema DEBE (MUST) corregir un asiento solo mediante un asiento de reversa que use las mismas cuentas contables y splits con montos exactamente negados y que referencie al original, dejando el original sin cambios.
Trace: FR-LEDGER-005 · Priority: Must

#### Scenario: Reversa de un gasto
- **CUANDO** "Bank A" tenía 1000.00 BOB antes del asiento E1 del 2026-03-10 (+120.00 BOB en `EXPENSE:BOB` con split s1 y -120.00 BOB en "Bank A") y se revierte E1 con fecha 2026-03-20
- **ENTONCES** se registra el asiento R1 de tipo `REVERSAL` que referencia a E1 con -120.00 BOB en `EXPENSE:BOB` (split s1) y +120.00 BOB en "Bank A"
- **Y** E1 no cambia y el saldo de "Bank A" vuelve a 1000.00 BOB

#### Scenario: Reversa de una conversión multi-moneda
- **CUANDO** se revierte la conversión de -100.000000 USDT, +100.000000 USDT, -690.00 BOB, +685.00 BOB y +5.00 BOB
- **ENTONCES** la reversa contiene +100.000000 USDT, -100.000000 USDT, +690.00 BOB, -685.00 BOB y -5.00 BOB en las mismas cuentas
- **Y** la suma por cuenta, split y moneda del original más la reversa es cero

### Requirement: Un asiento se revierte a lo sumo una vez
El sistema DEBE (MUST) rechazar con `LEDGER_ENTRY_ALREADY_REVERSED` la reversa de un asiento ya revertido y con `LEDGER_ENTRY_NOT_REVERSIBLE` la reversa de un asiento de tipo `REVERSAL`, también bajo solicitudes concurrentes.
Trace: FR-LEDGER-005 · Priority: Must

#### Scenario: Segunda reversa del mismo asiento
- **CUANDO** se solicita revertir por segunda vez el asiento E1 de 120.00 BOB ya revertido por R1
- **ENTONCES** se rechaza con `LEDGER_ENTRY_ALREADY_REVERSED` y el saldo de "Bank A" no cambia

#### Scenario: Reversas concurrentes
- **CUANDO** dos solicitudes concurrentes intentan revertir el asiento E2 de 45.00 BOB
- **ENTONCES** exactamente una se registra y la otra se rechaza con `LEDGER_ENTRY_ALREADY_REVERSED`

#### Scenario: Reversa de una reversa
- **CUANDO** se solicita revertir el asiento de reversa R1
- **ENTONCES** se rechaza con `LEDGER_ENTRY_NOT_REVERSIBLE`

### Requirement: Los periodos bloqueados rechazan asientos
El sistema DEBE (MUST) rechazar con `PERIOD_CLOSED`, en el dominio y en la base de datos, todo asiento (incluidas reversas y aperturas) cuya fecha de negocio caiga dentro de un periodo bloqueado del workspace, sin persistir nada; los periodos no bloqueados aceptan asientos.
Trace: FR-LEDGER-011, FR-PLANNING-005 · Priority: Must

#### Scenario: Asiento con fecha en un periodo bloqueado
- **CUANDO** el periodo del 2026-08-01 al 2026-08-31 está bloqueado, "Bank A" tiene 1000.00 BOB y se registra un asiento de gasto de 45.00 BOB con fecha 2026-08-15
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y los saldos de agosto de 2026 no cambian
- **Y** el mismo gasto con fecha 2026-09-01 se acepta y "Bank A" queda en 955.00 BOB

#### Scenario: Reversa fechada en un periodo bloqueado
- **CUANDO** se solicita revertir con fecha 2026-08-10 un asiento de 120.00 BOB mientras agosto de 2026 está bloqueado
- **ENTONCES** se rechaza con `PERIOD_CLOSED`

#### Scenario: Escritura directa en la base de datos durante el bloqueo
- **CUANDO** con el rol de aplicación se inserta directamente un asiento con fecha 2026-08-31 mientras agosto de 2026 está bloqueado
- **ENTONCES** la base de datos rechaza la inserción

#### Scenario: Sin bloqueos en Phase 1
- **CUANDO** no existe ningún periodo bloqueado en el workspace
- **ENTONCES** se aceptan asientos balanceados con cualquier fecha de negocio, como 2025-12-31 o 2026-08-15

### Requirement: Aislamiento de workspace en el ledger
Todos los postings de un asiento y sus cuentas contables DEBEN (MUST) pertenecer al workspace del asiento; el sistema NO DEBE (MUST NOT) leer ni escribir datos del ledger de otro workspace, y una operación sin contexto de workspace DEBE (MUST) fallar en lugar de devolver resultados vacíos.
Trace: NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Posting contra una cuenta contable de otro workspace
- **CUANDO** en el workspace W1 se registra un asiento con +10.00 BOB en `EXPENSE:BOB` de W1 y -10.00 BOB contra la cuenta contable de "Bank A" del workspace W2
- **ENTONCES** se rechaza con `REFERENCE_NOT_FOUND` y no se persiste nada en W1 ni en W2

#### Scenario: Consulta sin contexto de workspace
- **CUANDO** se consultan los postings del ledger sin haber establecido el workspace de la transacción
- **ENTONCES** la consulta falla
- **Y** desde W1 nunca se observan los postings de W2

### Requirement: Publicación del evento de asiento registrado
Por cada asiento registrado, incluidas reversas y aperturas, el sistema DEBE (MUST) publicar el evento de asiento registrado en la misma transacción de base de datos que el asiento, con todos sus postings y montos como decimales con moneda, y NO DEBE (MUST NOT) publicarlo si el asiento se rechaza.
Trace: NFR-REL-008, FR-LEDGER-001 · Priority: Must

#### Scenario: Evento de una conversión
- **CUANDO** se registra el asiento de conversión de -100.000000 USDT, +100.000000 USDT, -690.00 BOB, +685.00 BOB y +5.00 BOB
- **ENTONCES** se publica exactamente un evento de asiento registrado con los cinco postings, montos "-100.000000" USDT y "685.00" BOB como texto decimal, y suma cero por moneda

#### Scenario: Asiento rechazado no publica evento
- **CUANDO** un asiento con +50.00 BOB y -49.00 BOB se rechaza con `LEDGER_UNBALANCED_ENTRY`
- **ENTONCES** no se publica ningún evento de asiento registrado

### Requirement: Aritmética monetaria decimal exacta
El sistema DEBE (MUST) representar y operar todo monto como un decimal exacto acompañado de su moneda, nunca como punto flotante; las sumas y restas en la misma moneda DEBEN (MUST) ser exactas, conmutativas y asociativas, y un valor que no sea un decimal válido DEBE (MUST) rechazarse con `MONEY_INVALID_AMOUNT`.
Trace: FR-LEDGER-007, NFR-DATA-001 · Priority: Must

#### Scenario: Suma que falla en punto flotante
- **CUANDO** se suman 0.10 BOB y 0.20 BOB
- **ENTONCES** el resultado es exactamente 0.30 BOB

#### Scenario: Valores no decimales
- **CUANDO** se intenta crear un monto en BOB a partir de "1e3", "1,00", " 1.00", "Infinity", "NaN" o un texto vacío
- **ENTONCES** cada intento se rechaza con `MONEY_INVALID_AMOUNT`

### Requirement: Serialización canónica de montos
El sistema DEBE (MUST) transmitir todo monto en la API y en los eventos como texto decimal completado a la escala de su moneda junto con el código de moneda, nunca como número JSON, y DEBE (MUST) almacenarlo y recuperarlo sin pérdida de precisión.
Trace: FR-LEDGER-007, NFR-DATA-010 · Priority: Must

#### Scenario: Monto entero en BOB
- **CUANDO** se expone un monto de 685 BOB
- **ENTONCES** se serializa como `{"amount":"685.00","currency":"BOB"}`

#### Scenario: Ida y vuelta por la base de datos
- **CUANDO** se almacenan y se leen los montos 0.00000001 BTC, -100.000000 USDT y 12345678901234567890.123456789012345678 en una moneda de escala 18
- **ENTONCES** cada valor leído es idéntico, dígito a dígito, al almacenado

### Requirement: Operaciones monetarias solo entre la misma moneda
El sistema DEBE (MUST) rechazar con `CURRENCY_MISMATCH` toda suma, resta o comparación de orden entre montos de monedas distintas; la igualdad entre monedas distintas DEBE (MUST) ser falsa sin comparar solo los montos.
Trace: FR-LEDGER-007 · Priority: Must

#### Scenario: Suma de BOB y USD
- **CUANDO** se suman 10.00 BOB y 10.00 USD
- **ENTONCES** la operación se rechaza con `CURRENCY_MISMATCH`
- **Y** la igualdad entre 10.00 BOB y 10.00 USD es falsa

### Requirement: Escala de montos por moneda
El sistema DEBE (MUST) rechazar con `AMOUNT_SCALE_EXCEEDED`, sin redondear, todo monto ingresado o registrado con más decimales que la escala de su moneda (BOB 2, USD 2, USDT 6, BTC 8, JPY 0); los montos dentro de la escala, incluidos ceros finales, DEBEN (MUST) aceptarse sin cambios.
Trace: FR-LEDGER-007, FR-TRANSACTIONS-005, NFR-DATA-001 · Priority: Must

#### Scenario: Montos que exceden la escala
- **CUANDO** se registran postings de 10.125 BOB o de 1.1234567 USDT
- **ENTONCES** cada uno se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se persiste nada

#### Scenario: Montos dentro de la escala
- **CUANDO** se registran postings de 10.10 BOB y de 0.00000001 BTC
- **ENTONCES** se aceptan con exactamente esos valores

### Requirement: Redondeo HALF_EVEN determinista
Cuando un cálculo produce más decimales que la escala de la moneda, el sistema DEBE (MUST) redondear una sola vez, en el punto de materialización, con HALF_EVEN a la escala de la moneda, obteniendo siempre el mismo resultado para la misma entrada en cualquier entorno.
Trace: FR-LEDGER-007, NFR-DATA-002 · Priority: Must

#### Scenario: Empates en BOB
- **CUANDO** se materializan en BOB los valores 2.345, 2.355 y -2.345
- **ENTONCES** los resultados son 2.34 BOB, 2.36 BOB y -2.34 BOB

#### Scenario: Empate en USDT y conversión con una sola cuantización
- **CUANDO** se materializa 1.2345665 USDT y se convierte 123.456789 USDT a la tasa 6.97 BOB por USDT
- **ENTONCES** los resultados son 1.234566 USDT y 860.49 BOB

### Requirement: Distribución determinista por mayor residuo
El sistema DEBE (MUST) repartir un monto entre partes ponderadas truncando cada parte hacia cero a la escala de la moneda y asignando las unidades menores restantes a los mayores residuos, con desempate por menor índice, de modo que las partes sumen exactamente el total.
Trace: NFR-DATA-003, FR-LEDGER-007 · Priority: Must

#### Scenario: Tres partes iguales
- **CUANDO** se reparten 100.00 BOB en tres partes iguales
- **ENTONCES** las partes son 33.34 BOB, 33.33 BOB y 33.33 BOB, que suman 100.00 BOB

#### Scenario: Pesos 50/30/20
- **CUANDO** se reparten 99.99 BOB con pesos 50, 30 y 20
- **ENTONCES** las partes son 49.99 BOB, 30.00 BOB y 20.00 BOB, que suman 99.99 BOB

#### Scenario: Total negativo
- **CUANDO** se reparten -100.00 BOB en tres partes iguales
- **ENTONCES** las partes son -33.34 BOB, -33.33 BOB y -33.33 BOB
