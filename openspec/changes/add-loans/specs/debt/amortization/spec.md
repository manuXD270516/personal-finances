# Spec Delta

## Purpose

Calcula el cronograma de amortización de los préstamos de forma exacta y determinista: cuotas con desglose de principal, interés, comisiones, seguro e impuestos, redondeo HALF_EVEN a la escala de la moneda en cada componente y la última cuota absorbiendo el residuo para que la suma del principal sea exactamente el principal. Fija el cronograma de cada préstamo como una versión inmutable y permite compararlo, cuota por cuota y al centavo, con la tabla de amortización entregada por el banco, con un reporte de diferencias y su explicación.

## ADDED Requirements

### Requirement: Cronograma French de cuota constante
El sistema DEBE (MUST) calcular el cronograma francés con una cuota constante igual a `P × i / (1 − (1 + i)^−n)` redondeada HALF_EVEN a la escala de la moneda, donde `P` es el principal, `n` el número de cuotas e `i` la tasa nominal anual dividida por las cuotas por año (con tasa cero, `P / n`); en cada cuota el interés DEBE (MUST) ser el saldo al inicio del periodo por la tasa del periodo según la convención de días, redondeado HALF_EVEN, y el principal DEBE (MUST) ser la cuota menos el interés, con el cálculo intermedio en precisión decimal completa y sin punto flotante.
Trace: FR-DEBT-003, FR-DEBT-006, INV-001 · Priority: Must

#### Scenario: Tres cuotas al 1 % mensual
- **CUANDO** se calcula el cronograma francés de 1000.00 BOB al 12.00 % nominal anual, 30/360, mensual, 3 cuotas desde el 2026-11-15
- **ENTONCES** las cuotas son 340.02 BOB (principal 330.02, interés 10.00), 340.02 BOB (principal 333.32, interés 6.70) y 340.03 BOB (principal 336.66, interés 3.37)
- **Y** los saldos tras cada cuota son 669.98, 336.66 y 0.00 BOB

#### Scenario: Préstamo vehicular a 24 cuotas
- **CUANDO** se calcula el cronograma francés de 50000.00 BOB al 11.50 % nominal anual, 30/360, mensual, 24 cuotas con primera cuota el 2026-11-15
- **ENTONCES** la cuota es 2342.02 BOB, la cuota 1 tiene interés 479.17 BOB y principal 1862.85 BOB y la cuota 2 interés 461.31 BOB y principal 1880.71 BOB
- **Y** la cuota 24 del 2028-10-15 es de 2341.90 BOB (principal 2319.67, interés 22.23) y el interés total es 6208.36 BOB

#### Scenario: Tasa cero
- **CUANDO** se calcula el cronograma francés de 1000.00 BOB al 0.00 % en 3 cuotas mensuales
- **ENTONCES** las cuotas son 333.33, 333.33 y 333.34 BOB sin interés

### Requirement: Redondeo HALF_EVEN y residuo en la última cuota
Cada componente de cada cuota DEBE (MUST) redondearse HALF_EVEN a la escala de la moneda una sola vez y la última cuota DEBE (MUST) absorber el residuo de modo que la suma del principal de todas las cuotas sea exactamente el principal del préstamo (o el saldo pendiente en un préstamo en curso), el saldo final sea 0 y ningún componente sea negativo; total de la cuota DEBE (MUST) ser principal + interés + comisiones + seguro + impuestos.
Trace: FR-DEBT-006, INV-017, INV-016 · Priority: Must

#### Scenario: Suma exacta del principal
- **CUANDO** se calcula el cronograma del préstamo vehicular de 50000.00 BOB a 24 cuotas
- **ENTONCES** la suma del principal de las 24 cuotas es exactamente 50000.00 BOB y el saldo tras la cuota 24 es 0.00 BOB

#### Scenario: Propiedad para cualquier préstamo válido
- **CUANDO** se genera cualquier combinación válida de principal (0.01 a 10000000.00 en BOB o 0.000001 a 1000000.000000 en USDT), tasa (0 % a 100 %), plazo (1 a 600 cuotas), convención y periodicidad
- **ENTONCES** la suma del principal de las cuotas es igual al principal, ningún componente es negativo y cada total es igual a la suma de sus componentes

### Requirement: Convención de días y periodicidad
El sistema DEBE (MUST) admitir las convenciones de días 30/360 (por omisión), ACT/360 y ACT/365 y las periodicidades mensual (por omisión), bimestral, trimestral, semestral y anual; con 30/360 el interés de un periodo regular DEBE (MUST) ser el saldo por la tasa anual dividida por las cuotas por año, y con ACT/360 o ACT/365 el saldo por la tasa anual por los días reales del periodo divididos por 360 o 365.
Trace: FR-DEBT-001, FR-DEBT-003 · Priority: Must

#### Scenario: Primer interés con ACT/365
- **CUANDO** se calcula el préstamo de 50000.00 BOB al 11.50 % con ACT/365, desembolsado el 2026-10-15 y con primera cuota el 2026-11-15 (31 días)
- **ENTONCES** el interés de la cuota 1 es 488.36 BOB

#### Scenario: Primer interés con ACT/360
- **CUANDO** se calcula el mismo préstamo con ACT/360
- **ENTONCES** el interés de la cuota 1 es 495.14 BOB

#### Scenario: Cuotas trimestrales
- **CUANDO** se calcula el cronograma francés de 12000.00 BOB al 12.00 % anual, 30/360, trimestral, 4 cuotas desde el 2027-01-15
- **ENTONCES** las cuotas son 3228.32, 3228.32, 3228.32 y 3228.34 BOB con intereses 360.00, 273.95, 185.32 y 94.03 BOB

### Requirement: Fechas de vencimiento de las cuotas
Las cuotas DEBEN (MUST) vencer cada `12 / cuotas por año` meses desde la fecha de la primera cuota conservando su día del mes y, en meses que no tienen ese día, el último día del mes; el interés del primer periodo DEBE (MUST) calcularse por los días entre el desembolso (o la fecha del saldo pendiente) y la primera cuota según la convención, aunque ese periodo no sea regular.
Trace: FR-DEBT-001, FR-DEBT-003 · Priority: Must

#### Scenario: Primera cuota el día 31
- **CUANDO** un préstamo mensual tiene primera cuota el 2027-01-31
- **ENTONCES** las cuotas 2, 3 y 4 vencen el 2027-02-28, el 2027-03-31 y el 2027-04-30

#### Scenario: Primer periodo largo con 30/360
- **CUANDO** el préstamo de 50000.00 BOB al 11.50 % con 30/360 se desembolsa el 2026-10-01 y su primera cuota vence el 2026-11-15 (44 días 30/360)
- **ENTONCES** el interés de la cuota 1 es 702.78 BOB
- **Y** la suma del principal de las 24 cuotas sigue siendo 50000.00 BOB

### Requirement: Cargos por cuota
Cada préstamo DEBE (MUST) admitir comisiones, seguro e impuestos por cuota, cada uno como monto fijo por cuota o como tasa mensual sobre el saldo al inicio del periodo, redondeados HALF_EVEN; los cargos DEBEN (MUST) sumarse al total de la cuota sin cambiar su principal ni su interés.
Trace: FR-DEBT-006 · Priority: Must

#### Scenario: Comisión fija y seguro sobre el saldo
- **CUANDO** el préstamo vehicular de 50000.00 BOB tiene una comisión fija de 10.00 BOB y un seguro del 0.0400 % mensual sobre el saldo
- **ENTONCES** la cuota 1 es 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)
- **Y** la cuota 2 es 2371.27 BOB con seguro 19.25 BOB sobre el saldo de 48137.15 BOB y la cuota 24 es 2352.83 BOB con seguro 0.93 BOB

### Requirement: Vista previa del cronograma
El sistema DEBE (MUST) calcular el cronograma de unas condiciones sin persistir nada, con las mismas reglas que el cronograma fijado al activar el préstamo, para que el usuario lo revise antes de registrar o desembolsar.
Trace: FR-DEBT-003 · Priority: Should

#### Scenario: Vista previa sin efectos
- **CUANDO** el VIEWER pide la vista previa de 1000.00 BOB al 12.00 % a 3 cuotas mensuales
- **ENTONCES** recibe las cuotas 340.02, 340.02 y 340.03 BOB y no se crea ningún préstamo ni transacción

### Requirement: Cronograma fijado como versión inmutable
Al activarse un préstamo, su cronograma DEBE (MUST) fijarse como versión 1 y las cuotas de una versión NO DEBEN (MUST NOT) recalcularse ni reescribirse después; las condiciones financieras de un préstamo activo (principal, tasa, plazo, convención, periodicidad, fechas y cargos) NO DEBEN (MUST NOT) editarse (`LOAN_TERMS_LOCKED`), mientras que el nombre, el prestamista y la cuenta de pago habitual sí.
Trace: FR-DEBT-003, FR-DEBT-006 · Priority: Must

#### Scenario: Cambiar la tasa de un préstamo activo
- **CUANDO** el EDITOR edita la tasa del "Préstamo vehicular" activo de 11.50 % a 10.00 %
- **ENTONCES** se rechaza con `LOAN_TERMS_LOCKED` y el cronograma versión 1 no cambia

#### Scenario: Renombrar un préstamo activo
- **CUANDO** el EDITOR renombra el "Préstamo vehicular" a "Auto 2026"
- **ENTONCES** el préstamo se llama "Auto 2026" y su cronograma versión 1 no cambia

### Requirement: Cargar la tabla del banco como referencia
El usuario DEBE (MUST) poder cargar la tabla de amortización del banco de un préstamo como referencia, subiendo un archivo CSV o pegando texto tabulado, con mapeo explícito de columnas (número de cuota, vencimiento, principal, interés y, opcionalmente, comisiones, seguro, impuestos, total y saldo), formato de fecha y separador decimal explícitos, o ingresándola fila por fila; DEBE (MUST) rechazar archivos de más de 256 KiB o más de 600 filas, filas con montos ilegibles, negativos o con escala mayor a la de la moneda indicando la fila, y totales que no coinciden con la suma de sus componentes; la referencia NO DEBE (MUST NOT) cambiar el cronograma del préstamo y cada carga DEBE (MUST) conservarse como una versión nueva.
Trace: FR-DEBT-003, FR-DEBT-006 · Priority: Must

#### Scenario: Tabla del banco pegada desde la planilla
- **CUANDO** el EDITOR pega 24 filas con separador decimal coma y fechas `dd/mm/aaaa` para el "Préstamo vehicular" y mapea las columnas "Nro", "Fecha", "Capital", "Interés" y "Cuota"
- **ENTONCES** se guarda la referencia versión 1 con 24 filas y el cronograma del préstamo no cambia

#### Scenario: Fila con total inconsistente
- **CUANDO** la fila 3 de la tabla cargada tiene capital 1898.73, interés 443.29 y cuota 2342.20
- **ENTONCES** se rechaza la carga indicando la fila 3 (2342.02 calculado frente a 2342.20 informado) y no se guarda ninguna referencia

### Requirement: Reporte de diferencias contra la tabla del banco
El sistema DEBE (MUST) comparar el cronograma vigente del préstamo con una referencia cargada, cuota por cuota por número, informando por cuota el vencimiento y cada componente de ambos lados con su diferencia (banco menos sistema) y si coincide exactamente al centavo; y un resumen con la cantidad de cuotas coincidentes, la primera cuota distinta, la suma de las diferencias por componente, la suma del principal de la referencia frente al principal del préstamo y las cuotas presentes en un solo lado; el reporte DEBE (MUST) poder exportarse en CSV.
Trace: FR-DEBT-003, FR-DEBT-006 · Priority: Must

#### Scenario: Tabla idéntica al cronograma
- **CUANDO** la referencia cargada del "Préstamo vehicular" tiene las mismas 24 cuotas, vencimientos y componentes que el cronograma vigente
- **ENTONCES** el reporte informa 24 de 24 cuotas coincidentes al centavo y diferencia 0.00 BOB en todos los componentes

#### Scenario: Diferencia de un centavo en la última cuota
- **CUANDO** la referencia coincide en las cuotas 1 a 23 y en la cuota 24 informa interés 22.22 BOB y cuota 2341.89 BOB
- **ENTONCES** el reporte informa 23 de 24 cuotas coincidentes, primera diferencia en la cuota 24 con −0.01 BOB de interés y −0.01 BOB de total

### Requirement: Explicación sugerida de las diferencias
El reporte de diferencias DEBERÍA sugerir explicaciones deterministas: recalcular el cronograma con las otras convenciones de días admitidas e informar cuántas cuotas coinciden con cada una, y señalar si las diferencias se limitan a los vencimientos, a los cargos, a la última cuota o a la suma del principal; el sistema DEBE (MUST) presentar las sugerencias sin cambiar el préstamo.
Trace: FR-DEBT-003, FR-DEBT-006 · Priority: Should

#### Scenario: El banco usa ACT/365
- **CUANDO** el préstamo está registrado con 30/360 y los intereses de la referencia del banco son iguales en las 24 cuotas a los del cálculo con ACT/365 (488.36 BOB en la cuota 1 frente a 479.17 BOB con 30/360)
- **ENTONCES** el reporte sugiere que la convención ACT/365 coincide en más cuotas que 30/360 y que las diferencias están en el interés
- **Y** el préstamo sigue registrado con 30/360

### Requirement: Diferencia explicada
El usuario DEBE (MUST) poder registrar una explicación de texto sobre una comparación con diferencias; cada comparación DEBE (MUST) quedar en estado coincidente (sin diferencias), explicada (con diferencias y explicación) o sin explicar, conservando la versión de la referencia y del cronograma comparados, el autor y la fecha.
Trace: FR-DEBT-003, FR-DEBT-006 · Priority: Must

#### Scenario: Centavo explicado por redondeo del banco
- **CUANDO** la comparación del "Préstamo vehicular" tiene −0.01 BOB de interés en la cuota 24 y el EDITOR registra la explicación "el banco trunca el interés de la última cuota"
- **ENTONCES** la comparación queda explicada con ese texto, su autor y su fecha, para la referencia versión 1 y el cronograma versión 1
