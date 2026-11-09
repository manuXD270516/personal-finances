## ADDED Requirements

### Requirement: Sugerencia por promedio de los periodos anteriores
El sistema DEBE (MUST) sugerir, para una línea de gasto o de ingreso de un plan, un monto igual al promedio del real de esa línea en los últimos N periodos financieros terminados (N entre 1 y 12; 6 si no se indica), calculado con la misma derivación del real y la misma valoración en la moneda del plan que el progreso del presupuesto, y redondeado HALF_EVEN a la escala de la moneda del plan. Un periodo terminado es el que termina antes de hoy en la zona horaria del workspace y antes del inicio del periodo que se planifica; el periodo en curso NO DEBE (MUST NOT) entrar en el promedio. Un periodo sin movimientos en la línea DEBE (MUST) contar como 0.00 y no como dato faltante.
Trace: FR-PLANNING-021, FR-PLANNING-023 · Priority: Could

#### Scenario: Promedio de cuatro periodos de supermercado
- **CUANDO** el EDITOR pide sugerencias para "2026-11" con N = 4 el 2026-11-04 y el real de "Supermercado" fue 1380.00 BOB en "2026-07", 1515.50 BOB en "2026-08", 1610.00 BOB en "2026-09" y 1474.50 BOB en "2026-10"
- **ENTONCES** la sugerencia de "Supermercado" es 1495.00 BOB con el método promedio de 4 periodos

#### Scenario: Periodo sin gasto cuenta como cero
- **CUANDO** el real de "Regalos" fue 0.00 BOB en "2026-08", 300.00 BOB en "2026-09" y 150.00 BOB en "2026-10" y se pide N = 3 para "2026-11"
- **ENTONCES** la sugerencia de "Regalos" es 150.00 BOB

#### Scenario: Planificar un periodo futuro excluye el periodo en curso
- **CUANDO** el 2026-11-20 el EDITOR pide sugerencias con N = 3 para el periodo en borrador "2026-12"
- **ENTONCES** los periodos considerados son "2026-08", "2026-09" y "2026-10"
- **Y** "2026-11" se informa como en curso (`IN_PROGRESS`) y no entra en el promedio

#### Scenario: Empate en el redondeo del promedio
- **CUANDO** con N = 2 el real de "Internet" fue 100.00 BOB en "2026-09" y 100.01 BOB en "2026-10"
- **ENTONCES** la sugerencia de "Internet" es 100.00 BOB (100.005 redondeado HALF_EVEN)

### Requirement: Exclusión de periodos incompletos
Un periodo de la ventana DEBE (MUST) excluirse del cálculo de una línea, informando el motivo, cuando empezó antes de la primera actividad registrada del workspace (`BEFORE_FIRST_ACTIVITY` si terminó antes de ella, `INCOMPLETE` si la contiene) o cuando el real de la línea en ese periodo no pudo convertirse por completo a la moneda del plan (`NO_RATE`); un periodo excluido NO DEBE (MUST NOT) contarse como 0.00.
Trace: FR-PLANNING-021, FR-PLANNING-023 · Priority: Could

#### Scenario: Primera actividad a mitad de un periodo
- **CUANDO** la primera actividad del workspace es del 2026-08-20, se pide N = 3 para "2026-11" y el real de "Restaurantes" fue 210.00 BOB en "2026-08", 610.00 BOB en "2026-09" y 650.00 BOB en "2026-10"
- **ENTONCES** "2026-08" se informa como `INCOMPLETE` y la sugerencia de "Restaurantes" es 630.00 BOB

#### Scenario: Gasto en dólares sin tasa en un periodo
- **CUANDO** el real de "Viajes" de "2026-09" incluye 40.00 USD de una fecha sin tasa de valoración dentro de la ventana de vigencia, y "2026-08" y "2026-10" tienen 300.00 BOB y 500.00 BOB
- **ENTONCES** "2026-09" se informa con el motivo `NO_RATE` para "Viajes" y la sugerencia es 400.00 BOB

### Requirement: Historia insuficiente
Una línea DEBE (MUST) quedar sin monto sugerido, con el estado `INSUFFICIENT_HISTORY`, cuando le quedan menos valores válidos que la mitad de N redondeada hacia arriba (al menos 1) después de excluir los periodos incompletos y los atípicos.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Un solo periodo válido de tres
- **CUANDO** la primera actividad del workspace es del 2026-09-10 y se pide N = 3 para "2026-11"
- **ENTONCES** cada línea queda en `INSUFFICIENT_HISTORY` con un solo valor válido ("2026-10") de 2 necesarios
- **Y** ninguna línea tiene monto sugerido

### Requirement: Exclusión de valores atípicos
Con 4 o más valores válidos, el cálculo DEBE (MUST) excluir como atípico (`OUTLIER`) todo valor fuera del intervalo [Q1 − 1.5 × RIC, Q3 + 1.5 × RIC], donde Q1 y Q3 son las medianas de la mitad inferior y de la mitad superior de los valores ordenados (con un número impar de valores la mediana no entra en ninguna mitad) y RIC = Q3 − Q1, todo con aritmética decimal exacta; con menos de 4 valores válidos NO DEBE (MUST NOT) excluirse ninguno y la explicación DEBE (MUST) indicarlo.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Mes del viaje excluido
- **CUANDO** con N = 6 para "2026-11" el real de "Supermercado" fue 1420.00, 1515.50, 1380.00, 3950.00, 1610.00 y 1474.50 BOB de "2026-05" a "2026-10"
- **ENTONCES** Q1 es 1420.00 BOB, Q3 es 1610.00 BOB, el límite superior es 1895.00 BOB y "2026-08" con 3950.00 BOB queda excluido como atípico
- **Y** la sugerencia es 1480.00 BOB, el promedio de los otros 5 periodos

#### Scenario: Muestra chica sin exclusión
- **CUANDO** con N = 3 el real de "Supermercado" fue 1380.00, 3950.00 y 1474.50 BOB
- **ENTONCES** ningún valor se excluye, la sugerencia es 2268.17 BOB
- **Y** la explicación indica que con menos de 4 valores no se excluyen atípicos

### Requirement: Exclusión e inclusión manual de periodos
En la vista previa el EDITOR DEBE (MUST) poder excluir de una línea cualquier periodo de la ventana y volver a incluir uno marcado como atípico; el periodo excluido a mano DEBE (MUST) informarse con el motivo `USER_EXCLUDED` y un periodo incompleto o sin tasa NO DEBE (MUST NOT) poder incluirse.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Excluir el mes del aguinaldo
- **CUANDO** con N = 4 el real de "Ropa" fue 300.00, 280.00, 320.00 y 300.00 BOB de "2026-07" a "2026-10" y el EDITOR excluye "2026-10"
- **ENTONCES** la sugerencia de "Ropa" es 300.00 BOB con 3 periodos usados
- **Y** "2026-10" figura con el motivo `USER_EXCLUDED`

#### Scenario: Volver a incluir el mes del viaje
- **CUANDO** en el caso del viaje el EDITOR vuelve a incluir "2026-08"
- **ENTONCES** la sugerencia de "Supermercado" es 1891.67 BOB, el promedio de los 6 periodos

### Requirement: Sugerencia por el mismo periodo del año anterior
El sistema DEBE (MUST) ofrecer como método alternativo por línea el real del periodo que empezó 12 periodos antes del que se planifica, multiplicado por (1 + ajuste ÷ 100) con un ajuste entre −100.00 y 1000.00 por ciento (0.00 si no se indica) y redondeado HALF_EVEN a la escala de la moneda del plan; si ese periodo no existe, es incompleto o no tiene tasa, la línea DEBE (MUST) quedar en `INSUFFICIENT_HISTORY`. El mismo ajuste DEBE (MUST) poder aplicarse también al método promedio.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Noviembre del año pasado más 10 %
- **CUANDO** el real de "Hogar" en "2025-11" fue 1000.15 BOB y el EDITOR pide el método del año anterior con ajuste 10.00 % para "2026-11"
- **ENTONCES** la sugerencia de "Hogar" es 1100.16 BOB (1100.165 redondeado HALF_EVEN)

#### Scenario: Sin el mismo periodo del año anterior
- **CUANDO** la primera actividad del workspace es del 2026-02-01 y se pide el método del año anterior para "2026-11"
- **ENTONCES** cada línea queda en `INSUFFICIENT_HISTORY` con el motivo `BEFORE_FIRST_ACTIVITY` para "2025-11"

### Requirement: Redondeo opcional a un múltiplo
La vista previa DEBE (MUST) admitir un incremento de redondeo opcional (1, 5, 10, 50 o 100 unidades de la moneda del plan) que lleva cada sugerencia al múltiplo más cercano con HALF_EVEN, después del ajuste porcentual; sin incremento, la sugerencia DEBE (MUST) quedar en la escala de la moneda.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Supermercado a múltiplos de 50
- **CUANDO** la sugerencia de "Supermercado" es 1480.00 BOB y el EDITOR elige el incremento 50
- **ENTONCES** la sugerencia mostrada es 1500.00 BOB

#### Scenario: Empate al múltiplo par
- **CUANDO** la sugerencia de "Taxi" es 125.00 BOB y el incremento es 50
- **ENTONCES** la sugerencia mostrada es 100.00 BOB (2.5 múltiplos redondeado HALF_EVEN a 2)

### Requirement: Explicación de cada sugerencia
Cada línea de la vista previa DEBE (MUST) explicar su sugerencia con el método, N, cada periodo de la ventana con su rango de fechas, su real en la moneda del plan y su estado (`USED`, `OUTLIER`, `INCOMPLETE`, `BEFORE_FIRST_ACTIVITY`, `NO_RATE`, `IN_PROGRESS` o `USER_EXCLUDED`) e indicando si está cerrado, la cantidad de valores usados, el promedio y la mediana de los valores usados, el ajuste y el redondeo aplicados, el monto vigente de la línea si existe y la diferencia con la sugerencia; los textos DEBEN (MUST) armarse en la interfaz desde códigos y montos, sin texto libre del servidor.
Trace: FR-PLANNING-021, NFR-USAB-104 · Priority: Could

#### Scenario: Explicación del supermercado
- **CUANDO** la línea "Supermercado" del plan de "2026-11" tiene un máximo vigente de 1500.00 BOB y la sugerencia del caso del viaje es 1480.00 BOB
- **ENTONCES** la explicación lista los 6 periodos con sus reales, "2026-08" como atípico, 5 valores usados, promedio 1480.00 BOB y mediana 1474.50 BOB
- **Y** muestra el vigente 1500.00 BOB y la diferencia −20.00 BOB

### Requirement: Líneas a las que se aplica la sugerencia
La sugerencia DEBE (MUST) calcularse para las líneas existentes del plan del periodo y reemplazar el monto de referencia de cada tipo (planificado de fijo, máximo e ingreso esperado; mínimo de mínimo; máximo de rango); una línea de porcentaje de ingresos DEBE (MUST) quedar con el estado `NOT_APPLICABLE`. Si el periodo no tiene plan, la vista previa DEBE (MUST) proponer líneas nuevas para las categorías raíz de gasto y de ingreso no archivadas con sugerencia mayor que 0.00, y NO DEBE (MUST NOT) proponer un objetivo que se solape con otra línea del plan.
Trace: FR-PLANNING-021, FR-PLANNING-015 · Priority: Could

#### Scenario: Porcentaje de ingresos no aplica
- **CUANDO** el plan de "2026-11" tiene "Donaciones" como 10 % de los ingresos esperados
- **ENTONCES** la vista previa muestra "Donaciones" con `NOT_APPLICABLE` y sin monto sugerido

#### Scenario: Periodo sin plan
- **CUANDO** "2026-12" no tiene plan y en la ventana hubo gasto en "Alimentación" y "Transporte" y ningún gasto en "Mascotas"
- **ENTONCES** la vista previa propone líneas nuevas para "Alimentación" y "Transporte" y ninguna para "Mascotas"

### Requirement: Aplicación revisable con confirmación explícita
Pedir sugerencias NO DEBE (MUST NOT) modificar el plan ni auditar nada. Solo una confirmación explícita del EDITOR DEBE (MUST) aplicar las líneas que elija, con el monto sugerido o con el monto que él escriba (validado como cualquier monto de línea), en una sola operación atómica: crea el plan del periodo si no existe y crea o actualiza las líneas elegidas; cada línea aplicada DEBE (MUST) guardar la base de su sugerencia (método, N, ajuste, redondeo, periodos y estados, monto sugerido y monto aplicado) y una línea originada en un template DEBE (MUST) quedar marcada como modificada sin cambiar el template.
Trace: FR-PLANNING-021, FR-PLANNING-013 · Priority: Must

#### Scenario: Vista previa sin efectos
- **CUANDO** el EDITOR pide sugerencias para "2026-11" y cierra la pantalla sin confirmar
- **ENTONCES** el plan de "2026-11" y su historial no cambian

#### Scenario: Aplicar dos de tres líneas
- **CUANDO** la vista previa sugiere 1480.00 BOB para "Supermercado" (máximo vigente 1500.00 BOB desde "Mes estándar"), 630.00 BOB para "Restaurantes" y 8000.00 BOB para "Salario", y el EDITOR confirma "Supermercado" y "Restaurantes" con 650.00 BOB escrito a mano
- **ENTONCES** "Supermercado" queda con máximo 1480.00 BOB marcada como modificada y "Mes estándar" no cambia
- **Y** "Restaurantes" queda con 650.00 BOB y su base registra sugerido 630.00 BOB y aplicado 650.00 BOB
- **Y** "Salario" conserva su monto

#### Scenario: Monto escrito inválido
- **CUANDO** el EDITOR confirma "Restaurantes" con −10.00 BOB
- **ENTONCES** la confirmación se rechaza con `BUDGET_INVALID_AMOUNTS` y ninguna línea cambia

### Requirement: Sugerencia obsoleta al confirmar
La confirmación DEBE (MUST) recalcular las sugerencias de las líneas elegidas y rechazarse completa con `BUDGET_SUGGESTION_STALE` si alguna difiere de la que mostró la vista previa o si el plan cambió de versión desde entonces.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Gasto registrado entre la vista previa y la confirmación
- **CUANDO** después de la vista previa se registra un gasto de 200.00 BOB en "Supermercado" con fecha 2026-09-12 y el EDITOR confirma "Supermercado"
- **ENTONCES** la confirmación se rechaza con `BUDGET_SUGGESTION_STALE` y el plan no cambia

### Requirement: Sin aplicación automática de sugerencias históricas
Las sugerencias históricas NO DEBEN (MUST NOT) aplicarse sin una confirmación del EDITOR: la creación automática de periodos y planes, el template predeterminado, el clonado del plan anterior, la propagación a futuro y el rollover NO DEBEN (MUST NOT) calcularlas, y una línea ya aplicada NO DEBE (MUST NOT) recalcularse cuando cambia la historia; el clonado DEBE (MUST) copiar el monto de la línea sin su base histórica.
Trace: FR-PLANNING-021, FR-PLANNING-014 · Priority: Must

#### Scenario: Periodo nuevo desde el template predeterminado
- **CUANDO** se crea automáticamente el periodo "2027-01" y su plan desde "Mes estándar", que tiene "Supermercado" máximo 1600.00 BOB
- **ENTONCES** "Supermercado" queda con 1600.00 BOB aunque el promedio histórico sea 1480.00 BOB

#### Scenario: Historia corregida después de aplicar
- **CUANDO** "Supermercado" se aplicó con 1480.00 BOB y luego se anula un gasto de 300.00 BOB de "2026-09"
- **ENTONCES** la línea sigue con 1480.00 BOB y su base registrada no cambia

#### Scenario: Clonado sin base histórica
- **CUANDO** se crea el plan de "2026-12" clonando "2026-11", cuyo "Supermercado" se aplicó desde el historial con 1480.00 BOB
- **ENTONCES** "Supermercado" de "2026-12" tiene 1480.00 BOB sin base histórica

### Requirement: Permisos, periodos cerrados y auditoría de las sugerencias
Todo miembro (incluido VIEWER) DEBE (MUST) poder pedir la vista previa; confirmar DEBE (MUST) exigir rol EDITOR u OWNER (`INSUFFICIENT_ROLE`), DEBE (MUST) rechazarse con `PERIOD_CLOSED` en un periodo cerrado y DEBE (MUST) auditar cada línea con antes, después y la base de la sugerencia con un identificador de operación común, en la misma unidad de trabajo; la vista previa NO DEBE (MUST NOT) leer datos de otro workspace.
Trace: FR-IDENTITY-006, FR-AUDIT-001, FR-PLANNING-005, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER ve pero no confirma
- **CUANDO** un VIEWER pide sugerencias para "2026-11" e intenta confirmarlas
- **ENTONCES** la vista previa responde y la confirmación se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Periodo cerrado
- **CUANDO** el EDITOR confirma sugerencias para "2026-10", que está cerrado
- **ENTONCES** la confirmación se rechaza con `PERIOD_CLOSED` y el plan conserva sus montos

#### Scenario: Confirmación auditada
- **CUANDO** el EDITOR confirma "Supermercado" de 1500.00 BOB a 1480.00 BOB y "Restaurantes" de 600.00 BOB a 650.00 BOB
- **ENTONCES** el historial del plan registra dos cambios con el mismo identificador de operación, los valores antes y después y el método promedio de 6 periodos

### Requirement: Rendimiento de la vista previa histórica
La vista previa con N = 12 y 60 líneas sobre el seed `large` DEBE (MUST) responder con p95 ≤ 800 ms del servidor y DEBE (MUST) leer los flujos de la ventana con una sola consulta de agregados y resolver las tasas en un solo lote.
Trace: NFR-PERF-006, FR-PLANNING-021 · Priority: Should

#### Scenario: Doce periodos en el seed large
- **CUANDO** el benchmark nightly pide sugerencias con N = 12 para un plan de 60 líneas del seed `large`
- **ENTONCES** el p95 del servidor es 800 ms o menos
