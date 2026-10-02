# Spec Delta

## Purpose

Mantiene el catálogo de monedas (fiat y cripto, con su escala) y el historial inmutable de tasas de referencia registradas manualmente, y resuelve la tasa vigente a una fecha para valorar saldos y para comparar conversiones. Este change cubre las tasas manuales; los providers automáticos de tasa paralela (también Phase 1, docs/31 D29) se especifican en `fx/market-rate-providers` y registran sus tasas en este mismo historial inmutable.

## ADDED Requirements

### Requirement: Catálogo de monedas con tipo y escala
El sistema DEBE (MUST) ofrecer un catálogo de monedas donde cada moneda tiene código, nombre, símbolo opcional, tipo (`FIAT` o `CRYPTO` en Phase 1) y escala de decimales válidos; el catálogo base DEBE (MUST) incluir al menos BOB (2), USD (2), USDT (6), BTC (8) y ETH (18), y la escala de una moneda NO DEBE (MUST NOT) cambiar una vez usada.
Trace: FR-FX-001 · Priority: Must

#### Scenario: Catálogo base disponible
- **CUANDO** un miembro del workspace consulta el catálogo de monedas
- **ENTONCES** obtiene BOB tipo `FIAT` escala 2, USD tipo `FIAT` escala 2, USDT tipo `CRYPTO` escala 6, BTC tipo `CRYPTO` escala 8 y ETH tipo `CRYPTO` escala 18

#### Scenario: Filtrar por tipo
- **CUANDO** se consulta el catálogo filtrando por tipo `CRYPTO`
- **ENTONCES** la respuesta incluye USDT, BTC y ETH
- **Y** no incluye BOB ni USD

### Requirement: Registro manual de tasas de referencia
Un miembro con permiso de edición DEBE (MUST) poder registrar una tasa de referencia indicando par base/quote (1 base = valor quote), instante de vigencia, valor decimal exacto, tipo (`OFFICIAL`, `PARALLEL`, `P2P`, `BANK` o `CUSTOM`) y fuente descriptiva; la tasa queda asociada al workspace con origen manual.
Trace: FR-FX-002 · Priority: Must

#### Scenario: Registrar la tasa P2P de USDT
- **CUANDO** el usuario registra USDT/BOB = 6.95 tipo `P2P`, vigente desde 2026-09-29T15:00:00-04:00, fuente "Mediana Binance P2P"
- **ENTONCES** la tasa queda registrada con un identificador propio, origen manual y valor exacto "6.95"
- **Y** al consultarla se obtienen el par, el valor, el tipo, la fuente y el instante tal como se registraron

#### Scenario: Valor con más decimales que la escala de las monedas
- **CUANDO** el usuario registra USD/BOB = 6.965432109876543210 tipo `PARALLEL`
- **ENTONCES** la tasa se guarda sin pérdida con sus 18 decimales, porque las tasas no se redondean a la escala de la moneda

### Requirement: Validez de una tasa de cambio
El sistema NO DEBE (MUST NOT) aceptar una tasa cuyo valor sea menor o igual a cero ni una tasa cuya moneda base sea igual a la moneda quote; ambos casos DEBEN (MUST) rechazarse con error de validación sin registrar nada.
Trace: FR-FX-002 · Priority: Must

#### Scenario: Tasa cero rechazada
- **CUANDO** el usuario intenta registrar USDT/BOB = 0.00
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED`
- **Y** no se crea ninguna tasa

#### Scenario: Par con la misma moneda rechazado
- **CUANDO** el usuario intenta registrar BOB/BOB = 1.00
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED`

### Requirement: Tasas históricas inmutables
Una tasa registrada NO DEBE (MUST NOT) modificarse ni eliminarse: el valor leído de una tasa por su identificador DEBE (MUST) ser siempre el mismo, aun después de registrar tasas nuevas o correcciones del mismo par.
Trace: FR-FX-003, NFR-DATA-006 · Priority: Must

#### Scenario: Una tasa nueva no altera la anterior
- **CUANDO** existe la tasa R1 USDT/BOB = 6.95 del 2026-09-29
- **Y** se registra USDT/BOB = 7.10 para el 2026-10-15
- **ENTONCES** R1 sigue leyéndose con valor 6.95 y fecha 2026-09-29

#### Scenario: No existe operación de modificación
- **CUANDO** un cliente intenta modificar o borrar la tasa R1 por cualquier vía
- **ENTONCES** la operación no está disponible o se rechaza
- **Y** R1 conserva su valor 6.95

### Requirement: Corrección de tasa por reemplazo auditado
Para corregir una tasa errónea el usuario DEBE (MUST) registrar una tasa nueva que reemplaza a la anterior indicando un motivo; la anterior DEBE (MUST) seguir consultable marcada como reemplazada, la corrección DEBE (MUST) quedar en la auditoría y una tasa ya reemplazada NO DEBE (MUST NOT) reemplazarse de nuevo.
Trace: FR-FX-003 · Priority: Must

#### Scenario: Corregir un error de tipeo
- **CUANDO** R1 USDT/BOB = 9.65 del 2026-09-29 se registró por error
- **Y** el usuario la reemplaza por 6.95 con motivo "error de tipeo"
- **ENTONCES** se crea R2 = 6.95 con la misma fecha de vigencia que reemplaza a R1
- **Y** R1 sigue consultable con valor 9.65 y marcada como reemplazada por R2
- **Y** la auditoría registra quién reemplazó R1, cuándo y con qué motivo

#### Scenario: Reemplazar una tasa ya reemplazada
- **CUANDO** el usuario intenta reemplazar R1 por segunda vez
- **ENTONCES** la operación se rechaza con `FX_RATE_ALREADY_SUPERSEDED`
- **Y** se le indica que corrija la versión vigente R2

### Requirement: Consulta de la tasa vigente a una fecha
El sistema DEBE (MUST) resolver la tasa de un par y tipo a un instante dado como la tasa no reemplazada más reciente con vigencia menor o igual a ese instante y dentro de una ventana máxima configurable (por defecto 7 días); si no existe, DEBE (MUST) responder `FX_RATE_NOT_FOUND` y NO DEBE (MUST NOT) inventar un valor.
Trace: FR-FX-004 · Priority: Must

#### Scenario: Última tasa anterior dentro de la ventana
- **CUANDO** existen USDT/BOB `P2P` = 6.93 del 2026-09-25 y 6.95 del 2026-09-29
- **Y** se consulta la tasa `P2P` de USDT/BOB al 2026-09-30T23:59:59-04:00
- **ENTONCES** se obtiene 6.95 con su identificador, fecha de vigencia 2026-09-29 y fuente

#### Scenario: Sin tasa dentro de la ventana
- **CUANDO** la última tasa `P2P` de USDT/BOB es del 2026-09-29
- **Y** se consulta al 2026-10-10 con la ventana por defecto de 7 días
- **ENTONCES** la consulta responde `FX_RATE_NOT_FOUND`
- **Y** no se devuelve ningún valor aproximado ni 1:1

#### Scenario: Una tasa reemplazada no se usa
- **CUANDO** R1 = 9.65 fue reemplazada por R2 = 6.95 para el 2026-09-29
- **Y** se consulta la tasa vigente al 2026-09-30
- **ENTONCES** se obtiene R2 = 6.95

### Requirement: Uso de la tasa inversa sin pérdida de precisión
Cuando solo existe la tasa en la orientación opuesta, el sistema DEBE (MUST) derivar la inversa desde el valor original con precisión interna de 40 dígitos y redondear HALF_EVEN a 18 decimales solo al mostrarla; al convertir montos DEBE (MUST) usar la tasa original y cuantizar una sola vez a la escala de la moneda destino.
Trace: FR-FX-004, NFR-DATA-002 · Priority: Must

#### Scenario: Inversa de USD/BOB
- **CUANDO** solo existe USD/BOB = 6.96
- **Y** se consulta la tasa BOB/USD
- **ENTONCES** se obtiene 0.143678160919540230 marcada como derivada de la tasa USD/BOB original

#### Scenario: Valorar BOB en USD con la tasa original
- **CUANDO** solo existe USD/BOB = 6.96
- **Y** se valoran 1000.00 BOB en USD
- **ENTONCES** el resultado es 143.68 USD, calculado como 1000.00 / 6.96 y redondeado HALF_EVEN una sola vez a 2 decimales

### Requirement: Tasas cruzadas por moneda pivote solo para valoración
Si no hay tasa directa ni inversa, el sistema DEBE (MUST) poder derivar una tasa cruzada a través de una moneda pivote (por defecto USD) indicando las tasas componentes; una tasa cruzada NO DEBE (MUST NOT) usarse como referencia de una conversión real.
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

### Requirement: Tipo de tasa preferido por par para valoración
El workspace DEBE (MUST) poder fijar, por par, el tipo de tasa preferido para valorar saldos (por ejemplo `OFFICIAL` para USD/BOB y `P2P` para USDT/BOB); la valoración DEBE (MUST) usar ese tipo y mostrar la tasa, su tipo, su fuente y su fecha. Sin preferencia, se usa la tasa más reciente de cualquier tipo, indicando cuál.
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
