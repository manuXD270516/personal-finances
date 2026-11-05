## MODIFIED Requirements

### Requirement: Disponible para gastar libre de compromisos
El Home DEBE (MUST) responder "¿Cuánto puedo gastar?" (Q5) para el horizonte del disponible (por omisión, el periodo financiero que contiene hoy) con el disponible para gastar, calculado por moneda como el saldo de las cuentas líquidas menos lo reservado por metas en ellas, menos lo comprometido pagadero desde cuentas líquidas dentro del horizonte, menos los aportes planificados pendientes a metas, menos los esenciales presupuestados restantes cuando el workspace los activa y menos la reserva mínima de liquidez del workspace, mostrando cada término por separado y el horizonte usado; los ingresos esperados NO DEBEN (MUST NOT) sumarse.
Trace: FR-PLANNING-024, FR-GOALS-009, FR-COMMITMENTS-011, FR-REPORTING-002 · Priority: Must

#### Scenario: Disponible de octubre
- **CUANDO** el 2026-10-20, con periodos que empiezan el día 1, las cuentas líquidas son "Banco BOB" 12000.00 BOB, "Efectivo BOB" 800.00 BOB y "Ahorro BOB" 3000.00 BOB; las metas reservan 3000.00 BOB de aportes reales en "Ahorro BOB" y 2000.00 BOB en "Banco BOB"; lo comprometido desde cuentas líquidas es 3179.00 BOB; "Fondo de emergencia" tiene 600.00 BOB pendientes de su aporte planificado del periodo; y la reserva mínima es 1500.00 BOB
- **ENTONCES** el disponible para gastar es 5521.00 BOB
- **Y** se muestran los términos 15800.00 BOB líquidos, −5000.00 BOB reservados para metas, −3179.00 BOB comprometidos, −600.00 BOB de aportes planificados y −1500.00 BOB de reserva mínima

#### Scenario: Ingreso esperado no suma
- **CUANDO** además existe la ocurrencia de ingreso "Sueldo" de 8000.00 BOB del 2026-10-30
- **ENTONCES** el disponible para gastar sigue siendo 5521.00 BOB

#### Scenario: Sin reserva mínima
- **CUANDO** el workspace no tiene reserva mínima de liquidez
- **ENTONCES** el disponible para gastar es 7021.00 BOB y no se muestra el término de reserva mínima

#### Scenario: Esenciales no activados
- **CUANDO** el workspace no activó los esenciales presupuestados
- **ENTONCES** el disponible para gastar es 5521.00 BOB y no se muestra el término de esenciales

### Requirement: Periodo del disponible en la zona del workspace
El horizonte del disponible para gastar DEBE (MUST) ser el que fija el ajuste del workspace: por omisión, el periodo financiero que contiene la fecha de hoy en la zona horaria del workspace, según el día de inicio del mes financiero; con el modo "hasta el próximo ingreso", el que define el requirement "Horizonte del disponible hasta el próximo ingreso". Las ocurrencias con vencimiento posterior al fin del horizonte NO DEBEN (MUST NOT) descontarse.
Trace: FR-PLANNING-024, NFR-USAB-004 · Priority: Must

#### Scenario: Mes financiero que empieza el día 25
- **CUANDO** el día de inicio es 25, hoy es 2026-10-20 (periodo del 2026-09-25 al 2026-10-24) y, con los datos del disponible de octubre, "Pago Tarjeta X" vence el 2026-10-25 y "Luz" el 2026-10-28
- **ENTONCES** el término comprometido es 499.00 BOB y el disponible para gastar 8201.00 BOB

## ADDED Requirements

### Requirement: Horizonte del disponible hasta el próximo ingreso
Con el modo "hasta el próximo ingreso" el horizonte del disponible DEBE (MUST) ir desde hoy hasta la fecha de vencimiento, inclusive, de la primera ocurrencia de ingreso no resuelta con vencimiento posterior a hoy en la zona del workspace; si no hay ninguna dentro de los próximos 90 días DEBE (MUST) usar 30 días desde hoy, indicándolo. En ese horizonte el término comprometido DEBE (MUST) sumar los ítems con vencimiento o fecha hasta su fin con las mismas reglas de exclusión, y el de aportes planificados el pendiente del periodo en curso más lo planificado completo de cada periodo financiero posterior que el horizonte alcanza. Las ocurrencias de ingreso vencidas sin resolver NO DEBEN (MUST NOT) fijar el horizonte.
Trace: FR-PLANNING-024, FR-REPORTING-014, FR-GOALS-009 · Priority: Should

#### Scenario: Sueldo antes de la luz
- **CUANDO** con los datos del disponible de octubre ("Internet" del 2026-10-22, "Pago Tarjeta X" del 2026-10-25, "Luz" del 2026-10-28 y la pendiente "Cena") el modo es "hasta el próximo ingreso" y "Sueldo" vence el 2026-10-26
- **ENTONCES** el horizonte es del 2026-10-20 al 2026-10-26, el término comprometido 2999.00 BOB y el disponible para gastar 5701.00 BOB

#### Scenario: Horizonte que cruza al periodo siguiente
- **CUANDO** hoy es 2026-10-27 con periodos que empiezan el día 1, el modo es "hasta el próximo ingreso", el próximo ingreso esperado es "Sueldo" del 2026-11-05, las cuentas líquidas suman 15800.00 BOB con 5000.00 BOB reservados para metas, las ocurrencias no resueltas desde cuentas líquidas son "Luz" 180.00 BOB del 2026-10-28, "Alquiler" 2500.00 BOB del 2026-11-01 e "Internet" 199.00 BOB del 2026-11-22, "Fondo de emergencia" tiene 600.00 BOB pendientes en "2026-10" y planifica 1500.00 BOB por mes, y la reserva mínima es 1500.00 BOB
- **ENTONCES** el horizonte es del 2026-10-27 al 2026-11-05
- **Y** los términos son 2680.00 BOB comprometidos y 2100.00 BOB de aportes planificados, y el disponible para gastar es 4520.00 BOB

#### Scenario: Sin ingreso esperado
- **CUANDO** el 2026-10-20 el modo es "hasta el próximo ingreso" y no hay ocurrencias de ingreso no resueltas en los próximos 90 días
- **ENTONCES** el horizonte es del 2026-10-20 al 2026-11-19 y se indica que no hay ingreso esperado

#### Scenario: Ingreso atrasado ignorado
- **CUANDO** el ingreso "Sueldo" del 2026-10-18 sigue sin resolver el 2026-10-20 y el siguiente vence el 2026-11-18
- **ENTONCES** el horizonte termina el 2026-11-18

### Requirement: Esenciales presupuestados restantes descontados del disponible
Cuando el workspace activa los esenciales presupuestados, el disponible DEBE (MUST) restar por moneda del plan, por cada línea de gasto del plan cuyo objetivo es una categoría marcada como esencial, lo planificado menos lo gastado menos lo ya descontado como comprometido de esa categoría en el horizonte, no negativo: completo para el periodo en curso y, para cada periodo posterior que el horizonte alcanza, proporcional a los días del periodo dentro del horizonte, sin redondeo intermedio. Un periodo sin plan o una categoría esencial sin línea NO DEBEN (MUST NOT) restar, y DEBEN (MUST) indicarse.
Trace: FR-PLANNING-024, FR-REPORTING-002 · Priority: Should

#### Scenario: Supermercado esencial
- **CUANDO** con los datos del disponible de octubre los esenciales están activados con "Supermercado" y el plan de "2026-10" tiene la línea "Supermercado" con 1200.00 BOB planificados y 750.00 BOB gastados
- **ENTONCES** el término de esenciales es 450.00 BOB y el disponible para gastar 5071.00 BOB

#### Scenario: Compromiso esencial sin doble conteo
- **CUANDO** además la ocurrencia "Canasta" de 200.00 BOB del 2026-10-25, de categoría "Supermercado", se paga desde "Banco BOB"
- **ENTONCES** el término comprometido es 3379.00 BOB, el de esenciales 250.00 BOB y el disponible para gastar sigue siendo 5071.00 BOB

#### Scenario: Esenciales del periodo siguiente proporcionales
- **CUANDO** con los datos de "Horizonte que cruza al periodo siguiente" los esenciales están activados con "Supermercado", la línea de "2026-10" tiene 1200.00 BOB planificados y 750.00 BOB gastados, y el plan de "2026-11" (del 2026-11-01 al 2026-11-30) planifica 1200.00 BOB para "Supermercado"
- **ENTONCES** el término de esenciales es 650.00 BOB (450.00 + 1200.00 × 5 / 30) y el disponible para gastar 3870.00 BOB

#### Scenario: Categoría esencial sin línea en el plan
- **CUANDO** "Transporte" está marcada como esencial y el plan de "2026-10" no tiene línea para ella
- **ENTONCES** "Transporte" no resta y se indica que no tiene línea en el plan

### Requirement: Ajustes del disponible del workspace
El OWNER DEBE (MUST) poder definir el modo de horizonte del disponible (periodo financiero o hasta el próximo ingreso), activar o desactivar los esenciales presupuestados y la lista de categorías esenciales (hasta 50 categorías de gasto no archivadas), con control de versión; todo miembro DEBE (MUST) poder leerlos. Una categoría de ingreso DEBE (MUST) rechazarse con `CATEGORY_KIND_MISMATCH`, una archivada con `CATEGORY_ARCHIVED`, un rol menor que OWNER con `INSUFFICIENT_ROLE` y una versión vencida con `PRECONDITION_FAILED`, sin cambiar los ajustes; cada cambio DEBE (MUST) auditarse con los valores anterior y nuevo y los ajustes DEBEN (MUST) viajar en la exportación y la importación del workspace.
Trace: FR-PLANNING-024, FR-IDENTITY-005, FR-AUDIT-001 · Priority: Should

#### Scenario: El OWNER activa el próximo ingreso y los esenciales
- **CUANDO** el OWNER guarda el modo "hasta el próximo ingreso", activa los esenciales y marca "Supermercado" y "Transporte"
- **ENTONCES** los ajustes quedan guardados con la versión 2 y el cambio queda auditado con los valores anterior y nuevo
- **Y** la siguiente consulta del disponible usa el horizonte hasta el próximo ingreso y el término de esenciales

#### Scenario: Categoría de ingreso rechazada
- **CUANDO** el OWNER marca como esencial la categoría de ingreso "Salario"
- **ENTONCES** la respuesta es 422 con código `CATEGORY_KIND_MISMATCH` y los ajustes no cambian

#### Scenario: EDITOR no puede cambiarlos
- **CUANDO** un EDITOR intenta cambiar el modo de horizonte
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE`
- **Y** un VIEWER puede leer los ajustes vigentes

#### Scenario: Versión vencida
- **CUANDO** el OWNER guarda los ajustes con la versión 1 mientras la vigente es la 2
- **ENTONCES** la respuesta es 412 con código `PRECONDITION_FAILED` y los ajustes no cambian

### Requirement: Variación por categoría frente al periodo anterior
Para completar "¿Cómo estoy respecto al mes pasado?" (Q7), cada categoría de los tops de gasto e ingreso DEBE (MUST) informar su variación frente al periodo de comparación en valor absoluto y porcentaje con dos decimales, "nuevo" cuando el monto anterior es cero y no disponible cuando el monto anterior no lo está; en los gastos un aumento DEBE (MUST) indicarse como desfavorable y en los ingresos como favorable.
Trace: FR-REPORTING-018, FR-REPORTING-004 · Priority: Should

#### Scenario: Supermercado y Fees contra agosto
- **CUANDO** el 2026-09-15 Supermercado suma 1305.00 BOB del 1 al 15 de septiembre y 1200.00 BOB del 1 al 15 de agosto, y Fees 5.00 BOB solo en septiembre
- **ENTONCES** Supermercado informa +105.00 BOB y +8.75 % como aumento desfavorable
- **Y** Fees informa +5.00 BOB y "nuevo"

### Requirement: Las nueve preguntas del Home respondidas por completo
Con al menos una cuenta líquida, una definición recurrente activa y una meta, el Home DEBE (MUST) mostrar las nueve preguntas disponibles, cada una con su respuesta completa: Q1 dinero disponible por moneda y consolidado; Q2 y Q3 ingresos y gastos del periodo con sus tops de categorías; Q4 comprometido del periodo; Q5 disponible para gastar con su horizonte y desglose; Q6 ahorro, tasa de ahorro y aportes netos a metas; Q7 variación de ingresos, gastos, ahorro y de cada categoría de los tops frente al periodo anterior; Q8 pagos de los próximos 7 días con el saldo más bajo esperado y el riesgo de déficit de los próximos 30 días; y Q9 metas en curso. Ninguna tarjeta DEBE (MUST) mostrar un número inventado ni un cero sustituto.
Trace: FR-REPORTING-001, FR-REPORTING-002 · Priority: Must

#### Scenario: Checklist de aceptación del Home
- **CUANDO** el workspace demo con cuentas líquidas en BOB y USD, compromisos, una tarjeta, un préstamo y metas abre el Home
- **ENTONCES** las nueve tarjetas muestran su respuesta con cifras y ninguna se declara no disponible ni sin datos
- **Y** la tarjeta de Q8 muestra el saldo más bajo esperado de los próximos 30 días y su riesgo, y la de Q7 la variación de cada categoría de los tops
