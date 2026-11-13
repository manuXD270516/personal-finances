## ADDED Requirements

### Requirement: Precisión de los pronósticos frente al real
Al evaluarse un periodo terminado, el sistema DEBE (MUST) comparar con el real cada punto de ese periodo publicado por las corridas conservadas para evaluarlo (la última corrida completada antes de que el periodo empezara y las de periodos anteriores que lo pronosticaron), por serie y por cantidad de periodos hacia adelante: el real calculado con la misma regla que la historia de la serie, el error (real menos esperado), el error absoluto y si el real quedó dentro del intervalo del 80 % y del 95 %. Una serie que la corrida no publicó (con datos insuficientes o descartada) NO DEBE (MUST NOT) evaluarse.
Trace: FR-FORECAST-009 · Priority: Should

#### Scenario: Error del gasto total de noviembre
- **CUANDO** la corrida del 2026-11-01 esperaba para el gasto total de 2026-11 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y el gasto real de 2026-11 fue 4512.40 BOB
- **ENTONCES** la evaluación de 2026-11 a 1 periodo hacia adelante registra error +162.40 BOB, error absoluto 162.40 BOB y real dentro del intervalo del 80 %

#### Scenario: Serie no publicada
- **CUANDO** la corrida del 2026-11-01 dejó "Gimnasio" con datos insuficientes
- **ENTONCES** la evaluación de 2026-11 no tiene filas para "Gimnasio"

### Requirement: Indicadores agregados de precisión
Para cada serie y cantidad de periodos hacia adelante, el sistema DEBE (MUST) informar sobre los últimos 12 periodos evaluados: el error absoluto medio en la moneda de la serie, la cobertura del intervalo del 80 % (porcentaje de reales dentro), el sesgo (promedio de esperado menos real, positivo si sobreestima) y el error escalado frente al pronóstico ingenuo, con la cantidad de periodos usados.
Trace: FR-FORECAST-009, FR-FORECAST-007 · Priority: Should

#### Scenario: Cuatro periodos evaluados
- **CUANDO** el gasto total a 1 periodo tiene 4 periodos evaluados con esperado menos real de −162.40 BOB, +210.00 BOB, −95.60 BOB y +300.00 BOB, y 3 de ellos dentro del intervalo del 80 %
- **ENTONCES** los indicadores informan error absoluto medio 192.00 BOB, cobertura del 80 % de 75.00 %, sesgo +63.00 BOB y 4 periodos

### Requirement: Evaluación al terminar el periodo con reevaluación acotada
Un periodo DEBE (MUST) evaluarse por primera vez en el trabajo diario posterior al fin del periodo más los días de gracia configurados (por omisión 5), y los 3 últimos periodos evaluados DEBEN (MUST) reevaluarse en cada trabajo diario si su real cambió (por ejemplo por un import tardío), guardando el instante de la última evaluación. Los periodos anteriores NO DEBEN (MUST NOT) reevaluarse.
Trace: FR-FORECAST-009 · Priority: Should

#### Scenario: Evaluación tras el periodo de gracia
- **CUANDO** el periodo 2026-11 termina el 2026-11-30 con 5 días de gracia
- **ENTONCES** el trabajo del 2026-12-05 no lo evalúa y el del 2026-12-06 lo evalúa

#### Scenario: Importación tardía dentro de la ventana
- **CUANDO** el 2026-12-20 se importan 80.00 BOB de gasto de 2026-11
- **ENTONCES** el trabajo del 2026-12-21 reevalúa 2026-11 con real 4592.40 BOB y error +242.40 BOB

#### Scenario: Periodo fuera de la ventana
- **CUANDO** el 2027-04-10 ya se evaluaron 2026-12, 2027-01, 2027-02 y 2027-03 y se edita un gasto de 2026-11
- **ENTONCES** la evaluación de 2026-11 no cambia

### Requirement: Indicador de pérdida de precisión
Cuando el error escalado a 1 periodo de una serie publicada supere 1.2 en cada uno de sus 3 últimos periodos evaluados, la vista de pronósticos DEBE (MUST) indicar que el pronóstico de esa serie perdió precisión, sin enviar notificaciones; el indicador DEBE (MUST) desaparecer cuando deje de cumplirse.
Trace: FR-FORECAST-009 · Priority: Could

#### Scenario: Tres periodos con error escalado alto
- **CUANDO** "Supermercado" tiene error escalado 1.35, 1.28 y 1.41 en sus 3 últimos periodos evaluados
- **ENTONCES** la vista indica que el pronóstico de "Supermercado" perdió precisión y no se crea ninguna notificación

### Requirement: Métricas de calidad del pronóstico
El sistema DEBE (MUST) exponer como métricas el error escalado medio y la cobertura del intervalo del 80 % por tipo de serie (total, grupo, categoría, ingreso y gasto variable líquido), agregados sin identificadores de workspace, de serie ni montos.
Trace: NFR-OBS-009, FR-FORECAST-009 · Priority: Should

#### Scenario: Métricas sin identificadores
- **CUANDO** se evalúa el periodo 2026-11 de dos workspaces
- **ENTONCES** las métricas de error escalado y cobertura se publican por tipo de serie sin etiquetas de workspace, serie ni montos
