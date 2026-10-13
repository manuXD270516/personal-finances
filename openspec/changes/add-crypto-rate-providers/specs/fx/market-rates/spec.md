## MODIFIED Requirements

### Requirement: Registro manual de tasas de referencia
Un miembro con permiso de edición DEBE (MUST) poder registrar una tasa de referencia indicando par base/quote (1 base = valor quote), instante de vigencia, valor decimal exacto, tipo (`OFFICIAL`, `PARALLEL`, `P2P`, `BANK`, `CUSTOM` o `MARKET`) y fuente descriptiva; la tasa queda asociada al workspace con origen manual. El tipo `MARKET` identifica precios spot de mercado (por ejemplo de una criptomoneda frente a USDT) y conserva el significado de `PARALLEL` para el dólar paralelo.
Trace: FR-FX-002 · Priority: Must

#### Scenario: Registrar la tasa P2P de USDT
- **CUANDO** el usuario registra USDT/BOB = 6.95 tipo `P2P`, vigente desde 2026-09-29T15:00:00-04:00, fuente "Mediana Binance P2P"
- **ENTONCES** la tasa queda registrada con un identificador propio, origen manual y valor exacto "6.95"
- **Y** al consultarla se obtienen el par, el valor, el tipo, la fuente y el instante tal como se registraron

#### Scenario: Valor con más decimales que la escala de las monedas
- **CUANDO** el usuario registra USD/BOB = 6.965432109876543210 tipo `PARALLEL`
- **ENTONCES** la tasa se guarda sin pérdida con sus 18 decimales, porque las tasas no se redondean a la escala de la moneda

#### Scenario: Precio manual de bitcoin
- **CUANDO** el usuario registra BTC/USDT = 64990.50 tipo `MARKET`, vigente desde 2026-10-13T10:00:00-04:00, fuente "Precio del exchange"
- **ENTONCES** la tasa queda registrada con origen manual, tipo `MARKET` y valor exacto "64990.50"

### Requirement: Tasas cruzadas por moneda pivote solo para valoración
Si no hay tasa directa ni inversa, el sistema DEBE (MUST) poder derivar una tasa cruzada a través de una moneda pivote indicando las tasas componentes: la moneda quote del par automático configurado de la moneda a valorar cuando no es la moneda destino (USDT para BTC/USDT), y USD en los demás casos; cada tasa componente DEBE (MUST) resolverse con el tipo preferido de su propio par. Una tasa cruzada NO DEBE (MUST NOT) usarse como referencia de una conversión real.
Trace: FR-FX-005 · Priority: Should

#### Scenario: USDT a BOB vía USD
- **CUANDO** existen USDT/USD = 0.9990 y USD/BOB = 6.96 y no existe USDT/BOB
- **Y** se valoran 100.000000 USDT en BOB
- **ENTONCES** se usa la tasa cruzada 6.95304 y el resultado es 695.30 BOB
- **Y** la respuesta identifica ambas tasas componentes y marca el valor como aproximado

#### Scenario: Conversión real sin referencia cruzada
- **CUANDO** para USDT/BOB solo es posible una tasa cruzada
- **Y** se registra una conversión de USDT a BOB
- **ENTONCES** la conversión queda sin tasa de referencia y sin spread

#### Scenario: Bitcoin a BOB vía USDT
- **CUANDO** el workspace configura BTC/USDT, existen BTC/USDT `MARKET` = 65000.00 y USDT/BOB `PARALLEL` = 12.02, y no existe BTC/BOB
- **Y** se valoran 0.01500000 BTC en BOB
- **ENTONCES** se usa la tasa cruzada 781300.00 y el resultado es 11719.50 BOB
- **Y** la respuesta identifica BTC/USDT `MARKET` 65000.00 y USDT/BOB `PARALLEL` 12.02 como componentes y marca el valor como aproximado

### Requirement: Tipo de tasa preferido por par para valoración
El workspace DEBE (MUST) poder fijar, por par, el tipo de tasa preferido para valorar saldos (por ejemplo `OFFICIAL` para USD/BOB y `P2P` para USDT/BOB); la valoración DEBE (MUST) usar ese tipo y mostrar la tasa, su tipo, su fuente y su fecha. Sin preferencia para el par, la valoración DEBE (MUST) usar por defecto el tipo `MARKET` si la moneda base del par es una criptomoneda volátil cotizada frente a USDT, y el tipo `PARALLEL` en los demás casos (el mismo default de los pares con BOB), indicando el tipo usado.
Trace: FR-FX-006 · Priority: Must

#### Scenario: USD valorado con la tasa oficial
- **CUANDO** USD/BOB tiene `OFFICIAL` = 6.96 y `PARALLEL` = 9.80, ambas del 2026-09-30, y la preferencia del par es `OFFICIAL`
- **Y** se valoran 100.00 USD en BOB al 2026-09-30
- **ENTONCES** el resultado es 696.00 BOB
- **Y** se informa que se usó la tasa `OFFICIAL` 6.96 del 2026-09-30 con su fuente

#### Scenario: Cambiar la preferencia no altera datos
- **CUANDO** el usuario cambia la preferencia de USD/BOB a `PARALLEL`
- **ENTONCES** la siguiente valoración de 100.00 USD da 980.00 BOB
- **Y** ninguna tasa ni transacción registrada cambia

#### Scenario: Par sin preferencia usa el tipo paralelo
- **CUANDO** USD/BOB no tiene preferencia de tipo, tiene `PARALLEL` = 9.80 del 2026-09-30 y `OFFICIAL` = 6.96 del 2026-10-01 (más reciente)
- **Y** se valoran 100.00 USD en BOB al 2026-10-01
- **ENTONCES** el resultado es 980.00 BOB
- **Y** se informa que se usó la tasa `PARALLEL` 9.80 del 2026-09-30, no la `OFFICIAL` más reciente

#### Scenario: Par cripto sin preferencia usa el precio de mercado
- **CUANDO** BTC/USDT no tiene preferencia de tipo y tiene `MARKET` = 65000.00 del 2026-10-13T14:00:00Z
- **Y** se valoran 0.01000000 BTC en USDT a las 2026-10-13T14:05:00Z
- **ENTONCES** el resultado es 650.000000 USDT y se informa que se usó la tasa `MARKET` 65000.00
