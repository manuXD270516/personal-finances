## MODIFIED Requirements

### Requirement: Reportes ampliados en el catálogo
Los reportes de gastos por etiqueta, gastos por cuenta, tendencias mensuales, metas de ahorro, evolución de deudas, costos recurrentes, evolución de suscripciones, conversiones de moneda y cripto y comisiones DEBEN (MUST) figurar como disponibles en el catálogo, y con la precisión de los pronósticos el reporte de pronóstico vs real DEBE (MUST) figurar también como disponible, de modo que los 16 reportes del catálogo estén disponibles. Con la función de pronóstico deshabilitada, el reporte de pronóstico vs real DEBE (MUST) seguir listado como disponible y explicar al abrirse que la función no está habilitada, sin cifras ni ceros de relleno.
Trace: FR-REPORTING-008, FR-REPORTING-001, FR-FORECAST-009 · Priority: Should

#### Scenario: Catálogo completo de Phase 7
- **CUANDO** un miembro consulta el catálogo
- **ENTONCES** los 16 reportes figuran como disponibles, incluido "Pronóstico vs real"

#### Scenario: Catálogo sin la función de pronóstico
- **CUANDO** la función de pronóstico está deshabilitada y un miembro abre "Pronóstico vs real" desde el catálogo
- **ENTONCES** el reporte explica que la función no está habilitada, sin cifras

## ADDED Requirements

### Requirement: Reporte de pronóstico vs real
El reporte de pronóstico vs real DEBE (MUST) mostrar, para la serie y la cantidad de periodos hacia adelante elegidas (por omisión el gasto total a 1 periodo) y para los últimos 12 periodos evaluados (o el rango elegido), el real y el esperado de cada periodo con su intervalo del 80 %, la tabla de errores por periodo y los indicadores agregados (error absoluto medio, cobertura del 80 %, sesgo y error escalado), el modelo y la versión de la corrida evaluada en cada periodo, y DEBE (MUST) poder exportarse en CSV como los demás reportes.
Trace: FR-REPORTING-008, FR-REPORTING-012, FR-FORECAST-009 · Priority: Should

#### Scenario: Pronóstico vs real del gasto total
- **CUANDO** un VIEWER abre el reporte para el gasto total a 1 periodo y 2026-11 tiene esperado 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y real 4512.40 BOB
- **ENTONCES** la fila de 2026-11 muestra real 4512.40 BOB, esperado 4350.00 BOB, el intervalo, error +162.40 BOB y dentro del intervalo

#### Scenario: Exportación del reporte
- **CUANDO** el VIEWER exporta el reporte en CSV
- **ENTONCES** el archivo tiene una fila por periodo con real, esperado, límites del 80 %, error y si quedó dentro, con montos con punto decimal

### Requirement: Detalle de un periodo del pronóstico vs real
Desde un periodo del reporte de pronóstico vs real DEBE (MUST) poder abrirse el reporte de gastos por categoría de ese periodo con las mismas monedas, y para una serie de categoría, la lista de sus movimientos del periodo.
Trace: FR-REPORTING-010, FR-FORECAST-009 · Priority: Could

#### Scenario: Detalle de noviembre
- **CUANDO** un miembro abre el detalle de 2026-11 desde el reporte del gasto total
- **ENTONCES** se abre el reporte de gastos por categoría del periodo 2026-11

### Requirement: Pronóstico vs real sin periodos evaluados
Sin periodos evaluados para la serie elegida, el reporte DEBE (MUST) explicarlo e indicar el primer periodo que se evaluará y desde qué fecha, sin cifras ni ceros de relleno.
Trace: FR-FORECAST-009, FR-REPORTING-008 · Priority: Should

#### Scenario: Primera corrida reciente
- **CUANDO** la primera corrida completada es del 2026-12-01, el periodo 2026-12 termina el 2026-12-31 y la gracia es de 5 días
- **ENTONCES** el reporte indica que el primer periodo evaluado será 2026-12 a partir del 2027-01-06
