## ADDED Requirements

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
