# fx/conversion-pricing Specification

## Purpose
Calcula, a partir de los montos reales de una conversión, la tasa efectiva, el spread frente a la tasa de referencia vigente y el costo total, y deja registrada la tasa de referencia utilizada, de modo que el costo real de cada conversión sea explicable y nunca se recalcule con tasas posteriores.

## Requirements

### Requirement: Tasa efectiva derivada de los montos reales
El sistema DEBE (MUST) calcular la tasa efectiva de una conversión como monto neto recibido dividido por monto bruto entregado, con precisión interna de 40 dígitos, expresada en la orientación de visualización del par y guardada con 18 decimales redondeados HALF_EVEN; los fees pagados en una tercera moneda NO DEBEN (MUST NOT) entrar en ese cálculo.
Trace: FR-FX-007, FR-TRANSACTIONS-022, NFR-DATA-002 · Priority: Must

#### Scenario: Venta de USDT por BOB
- **CUANDO** se entregan 100.000000 USDT y se reciben 685.00 BOB netos
- **ENTONCES** la tasa efectiva es USDT/BOB = 6.850000000000000000

#### Scenario: Compra de USDT con BOB y fee en USDT
- **CUANDO** se entregan 700.00 BOB y se reciben 99.900000 USDT netos
- **ENTONCES** la tasa efectiva es USDT/BOB = 7.007007007007007007

#### Scenario: Swap de cripto con fee de red en tercera moneda
- **CUANDO** se entregan 1000.000000 USDT, se reciben 0.01600000 BTC y se paga un fee de red de 15.000000 TRX desde otra cuenta
- **ENTONCES** la tasa efectiva es BTC/USDT = 62500.000000000000000000
- **Y** el fee en TRX no modifica la tasa efectiva

### Requirement: Spread frente a la tasa de referencia
Cuando la conversión tiene tasa cotizada y tasa de referencia, el sistema DEBE (MUST) calcular el spread porcentual como (referencia − cotizada) / referencia × 100 si el usuario vende la moneda base, o (cotizada − referencia) / referencia × 100 si la compra (positivo = desfavorable), y el monto del spread como |cotizada − referencia| × monto convertido de la base, en la moneda quote.
Trace: FR-FX-007, FR-TRANSACTIONS-022 · Priority: Must

#### Scenario: Ejemplo canónico de venta USDT a BOB
- **CUANDO** se venden 100.000000 USDT con tasa cotizada USDT/BOB 6.90 y la referencia vigente es 6.95
- **ENTONCES** el spread es 0.719424460431654676 %
- **Y** el monto del spread es 5.00 BOB

#### Scenario: Compra de USDT pagando BOB
- **CUANDO** se compran 100.000000 USDT pagando 700.00 BOB con tasa cotizada 7.00 y referencia 6.95
- **ENTONCES** el spread es 0.719424460431654676 %
- **Y** el monto del spread es 5.00 BOB

### Requirement: Spread no determinable
Si la conversión no tiene tasa cotizada o no existe una tasa de referencia directa o inversa vigente al instante de ejecución, el sistema DEBE (MUST) registrar el spread como no determinable y NO DEBE (MUST NOT) estimarlo ni usar un valor por defecto.
Trace: FR-FX-007 · Priority: Must

#### Scenario: Sin tasa de referencia
- **CUANDO** se registra la venta de 100.000000 USDT por 685.00 BOB con cotizada 6.90 y no hay tasa USDT/BOB dentro de la ventana de vigencia
- **ENTONCES** la conversión se registra con referencia y spread vacíos
- **Y** la tasa efectiva 6.85 se calcula igualmente

#### Scenario: Sin tasa cotizada
- **CUANDO** se registra la venta de 100.000000 USDT por 685.00 BOB sin tasa cotizada y con referencia 6.95
- **ENTONCES** el spread queda vacío
- **Y** la referencia 6.95 sí queda registrada

### Requirement: Costo total de la conversión en moneda de reporte
El sistema DEBE (MUST) informar el costo total de una conversión en la moneda de reporte como la suma de los fees y del monto del spread, cada uno valorado a la tasa de referencia del instante de ejecución, redondeando HALF_EVEN solo el total; si falta alguna tasa necesaria, el costo DEBE (MUST) marcarse como incompleto.
Trace: FR-FX-007, FR-TRANSACTIONS-025 · Priority: Must

#### Scenario: Costo del ejemplo canónico
- **CUANDO** se venden 100.000000 USDT a cotizada 6.90 con fee de 5.00 BOB, referencia 6.95 y moneda de reporte BOB
- **ENTONCES** el costo total es 10.00 BOB (5.00 BOB de fee + 5.00 BOB de spread)
- **Y** coincide con 100.000000 × 6.95 − 685.00

#### Scenario: Fee en la moneda comprada
- **CUANDO** se compran USDT pagando 700.00 BOB a cotizada 7.00, con fee de 0.100000 USDT, referencia 6.95 y moneda de reporte BOB
- **ENTONCES** el costo total es 5.70 BOB (0.695 BOB de fee + 5.00 BOB de spread, redondeado una sola vez)

#### Scenario: Costo incompleto por falta de tasa
- **CUANDO** una conversión USDT→BTC paga un fee de red de 15.000000 TRX y no existe tasa TRX/BOB vigente
- **ENTONCES** el costo total se informa marcado como incompleto, indicando que falta valorar 15.000000 TRX

### Requirement: Discrepancia entre la tasa cotizada y los montos
Si la diferencia entre el monto destino bruto y el monto convertido por la tasa cotizada supera una unidad mínima de la moneda destino, el sistema DEBE (MUST) registrar la conversión con los montos reales, conservar la tasa cotizada como informativa marcándola discrepante y advertir al usuario; los montos reales prevalecen.
Trace: FR-FX-007 · Priority: Must

#### Scenario: Diferencia mayor a la tolerancia
- **CUANDO** se venden 100.000000 USDT a cotizada 6.90, con fee de 5.00 BOB y 684.00 BOB netos recibidos (bruto 689.00 BOB frente a 690.00 BOB esperados)
- **ENTONCES** la conversión se registra con 684.00 BOB netos y tasa efectiva 6.84
- **Y** la respuesta advierte una discrepancia de 1.00 BOB y la tasa cotizada queda marcada como discrepante

#### Scenario: Diferencia dentro de la tolerancia
- **CUANDO** se venden 100.000000 USDT a cotizada 6.90, con fee de 5.00 BOB y 685.01 BOB netos recibidos
- **ENTONCES** la conversión se registra sin advertencia de discrepancia

### Requirement: Registro de la tasa de referencia usada
Cada conversión DEBE (MUST) guardar el identificador de la versión exacta de la tasa de referencia usada (la indicada explícitamente por el usuario o la resuelta al instante de ejecución con el tipo preferido del par), y esa referencia NO DEBE (MUST NOT) cambiar aunque la tasa se reemplace después.
Trace: FR-FX-008, FR-FX-003 · Priority: Must

#### Scenario: Referencia resuelta automáticamente
- **CUANDO** se registra una conversión USDT→BOB ejecutada el 2026-09-30T14:42:00-04:00 sin indicar referencia y la tasa `P2P` vigente es R2 = 6.95
- **ENTONCES** la conversión queda vinculada a R2 con valor 6.95 y su fuente

#### Scenario: Reemplazo posterior de la referencia
- **CUANDO** después de registrar la conversión, R2 se reemplaza por R3 = 6.97
- **ENTONCES** la conversión sigue mostrando la referencia R2 = 6.95 y el spread 0.719424460431654676 %
