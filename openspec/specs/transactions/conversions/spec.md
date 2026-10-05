# transactions/conversions Specification

## Purpose
Registra manualmente el intercambio de dinero entre cuentas de monedas distintas (fiat y cripto, en las cuatro direcciones) como una única transacción con su detalle de precio inmutable, con las comisiones como gasto en la moneda en que se pagaron y sin recalcular jamás una conversión pasada con tasas posteriores.

## Requirements

### Requirement: Conversión exige monedas distintas
Una conversión DEBE (MUST) tener cuenta origen y cuenta destino de monedas distintas, con el monto entregado en la moneda de la cuenta origen y el monto recibido en la moneda de la cuenta destino; si ambas cuentas tienen la misma moneda, el registro DEBE (MUST) rechazarse con `CONVERSION_SAME_CURRENCY` indicando usar una transferencia.
Trace: FR-TRANSACTIONS-020, FR-TRANSACTIONS-004 · Priority: Must

#### Scenario: Misma moneda en origen y destino
- **CUANDO** el usuario intenta convertir 100.00 BOB de "Banco BOB" a "Caja BOB"
- **ENTONCES** la operación se rechaza con `CONVERSION_SAME_CURRENCY`
- **Y** no se crea ninguna transacción ni asiento

#### Scenario: Monto en moneda distinta a la de la cuenta
- **CUANDO** el usuario indica 100.00 USD como monto entregado desde la cuenta "Wallet USDT"
- **ENTONCES** la operación se rechaza con `CURRENCY_MISMATCH`

### Requirement: Conversión registrada como una transacción con patas balanceadas por moneda
Una conversión posteada DEBE (MUST) producir una sola transacción de tipo conversión con un único asiento contable que, para cada moneda involucrada, suma cero, usando la cuenta de sistema de trading de divisas de cada moneda como contrapartida; los montos del detalle DEBEN (MUST) coincidir con los movimientos del asiento.
Trace: FR-TRANSACTIONS-021, FR-TRANSACTIONS-001, NFR-DATA-004 · Priority: Must

#### Scenario: Ejemplo canónico USDT a BOB
- **CUANDO** el usuario vende 100.000000 USDT de "Wallet USDT" y recibe 685.00 BOB en "Banco BOB" con cotizada 6.90 y fee de proveedor de 5.00 BOB
- **ENTONCES** se registra una transacción con un asiento: Wallet USDT −100.000000 USDT; FX_TRADING:USDT +100.000000 USDT; FX_TRADING:BOB −690.00 BOB; Banco BOB +685.00 BOB; gasto Fees +5.00 BOB
- **Y** la suma en USDT es 0.000000 y la suma en BOB es 0.00
- **Y** el saldo de "Wallet USDT" baja 100.000000 USDT y el de "Banco BOB" sube 685.00 BOB

### Requirement: Las cuatro direcciones de conversión
El sistema DEBE (MUST) permitir registrar conversiones fiat→fiat, fiat→cripto, cripto→fiat y cripto→cripto con las mismas reglas de balance por moneda, detalle de precio y fees.
Trace: FR-TRANSACTIONS-021 · Priority: Must

#### Scenario: Fiat a fiat (USD a BOB)
- **CUANDO** el usuario vende 100.00 USD al banco a cotizada 6.96 con fee bancario de 5.00 BOB y recibe 691.00 BOB
- **ENTONCES** el asiento es: Caja USD −100.00 USD; FX_TRADING:USD +100.00 USD; FX_TRADING:BOB −696.00 BOB; Banco BOB +691.00 BOB; gasto Fees +5.00 BOB
- **Y** la tasa efectiva es USD/BOB 6.91

#### Scenario: Fiat a cripto (BOB a USDT)
- **CUANDO** el usuario paga 700.00 BOB por 100.000000 USDT a cotizada 7.00 y la plataforma descuenta 0.100000 USDT de fee
- **ENTONCES** el asiento es: Banco BOB −700.00 BOB; FX_TRADING:BOB +700.00 BOB; FX_TRADING:USDT −100.000000 USDT; Wallet USDT +99.900000 USDT; gasto Fees +0.100000 USDT

#### Scenario: Cripto a fiat (USDT a BOB)
- **CUANDO** el usuario vende 100.000000 USDT y recibe 685.00 BOB con fee de 5.00 BOB
- **ENTONCES** el asiento cuadra en USDT y en BOB como en el ejemplo canónico

#### Scenario: Cripto a cripto (USDT a BTC)
- **CUANDO** el usuario entrega 1000.000000 USDT, el proveedor cobra 2.000000 USDT y recibe 0.01600000 BTC
- **ENTONCES** el asiento incluye Wallet USDT −1000.000000 USDT; FX_TRADING:USDT +998.000000 USDT; gasto Fees +2.000000 USDT; FX_TRADING:BTC −0.01600000 BTC; Wallet BTC +0.01600000 BTC
- **Y** la suma en USDT y en BTC es cero

### Requirement: Comisiones registradas como gasto en su propia moneda
Cada fee de una conversión DEBE (MUST) registrarse por tipo (`PROVIDER`, `NETWORK`, `BANK`, `TAX` u `OTHER`) como gasto con la categoría de sistema Fees en la moneda en que se pagó: descontado del monto entregado, del monto recibido o pagado desde una tercera cuenta indicada; NO DEBE (MUST NOT) compensarse en silencio dentro de la tasa.
Trace: FR-TRANSACTIONS-023, FR-TRANSACTIONS-022 · Priority: Must

#### Scenario: Fee de red pagado en una tercera moneda
- **CUANDO** el usuario convierte 1000.000000 USDT a 0.01600000 BTC con fee de proveedor 2.000000 USDT y fee de red 15.000000 TRX pagado desde "Wallet TRX"
- **ENTONCES** el mismo asiento incluye Wallet TRX −15.000000 TRX y gasto Fees +15.000000 TRX de tipo `NETWORK`
- **Y** la suma en TRX es cero y el detalle lista ambos fees con su tipo y moneda

#### Scenario: Fee de red descontado del activo de origen
- **CUANDO** el usuario entrega 0.01250000 BTC, de los cuales 0.00050000 BTC son fee de red, y recibe 600.000000 USDT
- **ENTONCES** el asiento registra gasto Fees +0.00050000 BTC y FX_TRADING:BTC +0.01200000 BTC

### Requirement: Consistencia entre montos y comisiones
El sistema DEBE (MUST) rechazar con `CONVERSION_AMOUNTS_INCONSISTENT` una conversión en la que los fees en moneda origen igualen o superen el monto entregado, los fees en moneda destino deban restarse de un bruto no positivo, o un fee en una tercera moneda no indique la cuenta que lo paga en esa moneda.
Trace: FR-TRANSACTIONS-022 · Priority: Must

#### Scenario: Fee mayor que el monto entregado
- **CUANDO** el usuario entrega 1.000000 USDT con un fee de proveedor de 1.500000 USDT descontado del origen
- **ENTONCES** la operación se rechaza con `CONVERSION_AMOUNTS_INCONSISTENT`
- **Y** no se crea ninguna transacción

#### Scenario: Fee en tercera moneda sin cuenta pagadora
- **CUANDO** el usuario registra un fee de red de 15.000000 TRX sin indicar desde qué cuenta TRX se paga
- **ENTONCES** la operación se rechaza con `CONVERSION_AMOUNTS_INCONSISTENT`

### Requirement: Montos de la conversión respetan la escala de su moneda
Los montos entregado, recibido y de cada fee DEBEN (MUST) ser mayores que cero y tener como máximo los decimales de la escala de su moneda; un monto con más decimales DEBE (MUST) rechazarse con `AMOUNT_SCALE_EXCEEDED` y nunca redondearse en silencio.
Trace: FR-TRANSACTIONS-005, FR-FX-001 · Priority: Must

#### Scenario: Demasiados decimales en USDT
- **CUANDO** el usuario indica 100.0000001 USDT como monto entregado
- **ENTONCES** la operación se rechaza con `AMOUNT_SCALE_EXCEEDED`

#### Scenario: Escala exacta de BTC aceptada
- **CUANDO** el usuario indica 0.01600000 BTC como monto recibido
- **ENTONCES** el monto se acepta sin redondeo

### Requirement: Detalle de la conversión inmutable
Cada conversión DEBE (MUST) guardar un detalle inmutable con monto bruto entregado, monto convertido, monto bruto destino, monto neto recibido, tasa cotizada, tasa efectiva, fees por tipo y moneda, tasa de referencia, spread, proveedor o canal, instante de ejecución y referencia externa opcional; NO DEBE (MUST NOT) existir operación que lo modifique.
Trace: FR-TRANSACTIONS-022, NFR-DATA-006 · Priority: Must

#### Scenario: Consultar el detalle del ejemplo canónico
- **CUANDO** el usuario consulta la conversión de 100.000000 USDT a 685.00 BOB ejecutada en "Binance P2P"
- **ENTONCES** el detalle muestra entregado 100.000000 USDT, convertido 100.000000 USDT, bruto destino 690.00 BOB, neto 685.00 BOB, cotizada 6.90, efectiva 6.85, fee `PROVIDER` 5.00 BOB, referencia 6.95, spread 0.719424460431654676 % (5.00 BOB), proveedor e instante

### Requirement: Las conversiones históricas no se recalculan
Registrar, corregir o reemplazar tasas después de una conversión NO DEBE (MUST NOT) modificar sus montos, su tasa efectiva, su referencia, su spread ni sus movimientos contables.
Trace: FR-TRANSACTIONS-024, NFR-DATA-006 · Priority: Must

#### Scenario: Nueva tasa posterior
- **CUANDO** existe la conversión canónica del 2026-09-30 y luego se registra USDT/BOB = 7.10 para el 2026-10-15
- **ENTONCES** la conversión sigue mostrando 685.00 BOB recibidos, efectiva 6.85, referencia 6.95 y el mismo asiento

### Requirement: Edición de una conversión por reversa y nuevo detalle
Corregir montos, cuentas, fecha o fees de una conversión posteada DEBE (MUST) generar un asiento de reversa del original, un asiento nuevo y un detalle nuevo; el detalle y el asiento anteriores DEBEN (MUST) conservarse consultables y la corrección DEBE (MUST) quedar auditada.
Trace: FR-TRANSACTIONS-024, FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Corregir el monto recibido
- **CUANDO** el usuario corrige la conversión canónica de 685.00 BOB a 686.00 BOB recibidos (fee 4.00 BOB)
- **ENTONCES** se registra la reversa exacta del asiento original y un asiento nuevo con Banco BOB +686.00 BOB y gasto Fees +4.00 BOB
- **Y** el detalle vigente muestra efectiva 6.86 y el detalle anterior con 685.00 BOB sigue consultable en el historial
- **Y** el saldo neto de "Banco BOB" refleja solo +686.00 BOB

### Requirement: Notificación de la conversión registrada
Al postear por primera vez una conversión el sistema DEBE (MUST) publicar, en la misma unidad de trabajo, exactamente un hecho "conversión registrada" con los montos, tasas, fees, referencia, spread y proveedor; cada corrección financiera posterior DEBE (MUST) publicar, en la misma unidad de trabajo, un hecho "conversión revisada" con la revisión anterior y la nueva y los asientos revertido, de reversa y nuevo, y NO DEBE (MUST NOT) volver a publicar "conversión registrada"; la reentrega de cualquiera de los dos NO DEBE (MUST NOT) duplicar efectos en los consumidores.
Trace: FR-TRANSACTIONS-022, FR-TRANSACTIONS-024, NFR-REL-007 · Priority: Must

#### Scenario: Publicación única con el detalle
- **CUANDO** se postea la conversión canónica
- **ENTONCES** se publica un único hecho "conversión registrada" con origen 100.000000 USDT, destino 685.00 BOB, cotizada 6.90, efectiva 6.85, referencia 6.95, fee `PROVIDER` 5.00 BOB y spread 0.719424460431654676 %

#### Scenario: Reentrega del hecho
- **CUANDO** el hecho "conversión registrada" se entrega dos veces a un consumidor
- **ENTONCES** el consumidor aplica su efecto una sola vez

#### Scenario: Corrección publica una revisión
- **CUANDO** el usuario corrige la conversión canónica de 685.00 BOB a 686.00 BOB recibidos (fee 4.00 BOB)
- **ENTONCES** se publica un único hecho "conversión revisada" de la revisión 1 a la 2 con el asiento original revertido, su reversa y el asiento nuevo, origen 100.000000 USDT, destino 686.00 BOB y efectiva 6.86
- **Y** no se publica un segundo hecho "conversión registrada"
- **Y** su reentrega no duplica efectos en los consumidores

### Requirement: Vista previa del cálculo antes de confirmar
El sistema DEBE (MUST) permitir, sin registrar nada, ingresar dos de {monto entregado, monto recibido, tasa cotizada} más los fees y obtener el tercer valor, la tasa efectiva y el costo total en la moneda de reporte, con los mismos cálculos que el registro definitivo.
Trace: FR-TRANSACTIONS-025, FR-FX-007 · Priority: Should

#### Scenario: Calcular el monto recibido
- **CUANDO** el usuario ingresa 100.000000 USDT entregados, cotizada 6.90 y fee de 5.00 BOB descontado del destino, con referencia 6.95
- **ENTONCES** la vista previa muestra 685.00 BOB a recibir, tasa efectiva 6.85 y costo total 10.00 BOB
- **Y** no se crea ninguna transacción

#### Scenario: Calcular la tasa a partir de los montos
- **CUANDO** el usuario ingresa 100.000000 USDT entregados y 690.00 BOB brutos a recibir
- **ENTONCES** la vista previa muestra la tasa cotizada 6.90
