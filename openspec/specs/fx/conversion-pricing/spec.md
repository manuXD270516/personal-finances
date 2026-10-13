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

### Requirement: Análisis de costo de conversiones por canal, par y periodo
El sistema DEBE (MUST) informar, para un rango de periodos, el costo de las conversiones posteadas agrupado por periodo, canal y par, donde el canal es la contraparte de la conversión más su cuenta de origen y su cuenta de destino. Por grupo DEBE (MUST) informar la cantidad de conversiones, el monto convertido (la cantidad convertida de la moneda base del par, valorada en la moneda de reporte con la tasa de referencia registrada de cada conversión y, si el par no incluye la moneda de reporte, con la tasa de valoración vigente al instante de la conversión), el spread promedio ponderado por ese monto, el monto del spread, los fees y el costo total (spread más fees), todo en la moneda de reporte con redondeo HALF_EVEN solo al presentar; solo DEBE (MUST) usarse la revisión vigente de cada conversión y NO DEBEN (MUST NOT) contarse conversiones anuladas ni pendientes.
Trace: FR-FX-011 · Priority: Should

#### Scenario: Canal Binance P2P en octubre
- **CUANDO** en el periodo "2026-10" de un workspace con moneda de reporte BOB se vendieron por la contraparte "Binance P2P" desde "Wallet USDT" hacia "Banco BOB" 100.000000 USDT a 11.90 con referencia 12.00 y sin fee, y 300.000000 USDT a 11.94 con referencia 12.00 y fee de 2.00 BOB
- **ENTONCES** el grupo "2026-10", "Binance P2P" ("Wallet USDT" → "Banco BOB"), USDT/BOB informa 2 conversiones, monto convertido 4800.00 BOB, spread promedio 0.5833 %, monto del spread 28.00 BOB, fees 2.00 BOB y costo total 30.00 BOB

#### Scenario: Conversión revisada
- **CUANDO** la venta de 300.000000 USDT se revisa a 250.000000 USDT a 11.94 con referencia 12.00
- **ENTONCES** el grupo cuenta solo la revisión vigente: monto convertido 4200.00 BOB y monto del spread 25.00 BOB

#### Scenario: Conversión anulada
- **CUANDO** en cambio la venta de 100.000000 USDT se anula
- **ENTONCES** el grupo informa 1 conversión, monto convertido 3600.00 BOB y spread promedio 0.5000 %

### Requirement: Conversiones sin contraparte agrupadas como Sin canal
Las conversiones sin contraparte DEBEN (MUST) agruparse en el canal "Sin canal" de su par y periodo, separadas por su cuenta de origen y su cuenta de destino, sin inferir una contraparte.
Trace: FR-FX-011 · Priority: Should

#### Scenario: Compra de USDT sin contraparte
- **CUANDO** en "2026-10" se compraron 50.000000 USDT pagando 610.00 BOB desde "Banco BOB" hacia "Wallet USDT" a 12.20 con referencia 12.00 y sin contraparte
- **ENTONCES** el grupo "2026-10", "Sin canal" ("Banco BOB" → "Wallet USDT"), USDT/BOB informa 1 conversión, monto convertido 600.00 BOB, spread 1.6667 % y monto del spread 10.00 BOB

### Requirement: Conversiones sin referencia excluidas y contadas aparte
Una conversión sin tasa de referencia registrada, o cuyo monto convertido no puede valorarse en la moneda de reporte dentro de la ventana de vigencia, NO DEBE (MUST NOT) entrar en los promedios ni en los totales de su grupo y DEBE (MUST) contarse aparte por grupo con el motivo y el monto convertido en su moneda original; NO DEBE (MUST NOT) estimarse un spread para ella.
Trace: FR-FX-011, FR-FX-007 · Priority: Should

#### Scenario: Venta sin referencia
- **CUANDO** además en "2026-10" se vendieron por "Binance P2P" 20.000000 USDT por 238.00 BOB sin tasa de referencia registrada
- **ENTONCES** los promedios y totales del grupo "Binance P2P" no cambian
- **Y** el grupo informa 1 conversión excluida por falta de referencia con 20.000000 USDT convertidos

### Requirement: Periodo financiero o mes calendario en el análisis de costo
El análisis DEBE (MUST) agrupar por periodo financiero del workspace por defecto y por mes calendario si se pide, asignando cada conversión por su fecha de negocio en la zona horaria del workspace.
Trace: FR-FX-011, FR-PLANNING-001 · Priority: Should

#### Scenario: Mes financiero que empieza el día 25
- **CUANDO** el mes financiero del workspace empieza el día 25 y hay una conversión con fecha de negocio 2026-10-27
- **ENTONCES** por periodo financiero pertenece al periodo del 2026-10-25 al 2026-11-24
- **Y** por mes calendario pertenece a octubre de 2026

### Requirement: Exportación CSV del análisis de costo
Un miembro del workspace DEBE (MUST) poder exportar el análisis de costo de un rango como CSV con una fila por grupo y las columnas de periodo, canal, cuenta de origen, cuenta de destino, par, conversiones, monto convertido, spread promedio, monto del spread, fees, costo total y conversiones excluidas, con montos como texto decimal en la moneda de reporte y las celdas de texto neutralizadas contra fórmulas.
Trace: FR-FX-011, NFR-SEC-015 · Priority: Should

#### Scenario: Exportar octubre
- **CUANDO** un VIEWER exporta el análisis de "2026-10" con los grupos "Binance P2P" y "Sin canal"
- **ENTONCES** obtiene un CSV con 2 filas de datos, la de "Binance P2P" con monto convertido "4800.00", monto del spread "28.00", fees "2.00", costo total "30.00" y 1 conversión excluida

#### Scenario: Contraparte con fórmula
- **CUANDO** una contraparte se llama "=HYPERLINK(1)"
- **ENTONCES** la celda del CSV la muestra como texto y no como fórmula

### Requirement: Análisis de costo solo de lectura y aislado por workspace
Todo miembro activo del workspace (OWNER, EDITOR o VIEWER) DEBE (MUST) poder consultar el análisis de costo; la consulta NO DEBE (MUST NOT) modificar conversiones, tasas ni ningún otro dato, y NO DEBE (MUST NOT) incluir conversiones de otro workspace.
Trace: FR-FX-011, NFR-SEC-003 · Priority: Should

#### Scenario: Otro workspace
- **CUANDO** "W2" tiene conversiones por "Binance P2P" en "2026-10" y un miembro de "W1" consulta el análisis de "2026-10"
- **ENTONCES** el resultado de "W1" no incluye ninguna conversión de "W2"

### Requirement: Spread recalculado contra la compra o venta paralela del día
Cuando se pida, el análisis DEBE (MUST) informar además un spread alternativo de cada grupo calculado contra la tasa paralela de compra (para conversiones que compran la moneda base del par) o de venta (para las que la venden) vigente al instante de cada conversión, excluyendo y contando aparte las conversiones sin esa tasa; el spread contra la referencia registrada NO DEBE (MUST NOT) cambiar.
Trace: FR-FX-011 · Priority: Could

#### Scenario: Venta comparada con la venta paralela
- **CUANDO** se vendieron 100.000000 USDT a 11.90 y al instante de la conversión la tasa USDT/BOB `PARALLEL_SELL` vigente era 11.92
- **ENTONCES** el spread alternativo de esa conversión es 0.1678 % y su spread contra la referencia sigue siendo 0.8333 %
