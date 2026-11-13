## ADDED Requirements

### Requirement: Banda de gasto variable predicho en el calendario
Cuando el pronóstico vigente tiene la serie de gasto variable líquido de una moneda para los periodos del horizonte, el calendario DEBE (MUST) informar para esa moneda tres series adicionales: la serie principal menos el gasto variable predicho acumulado con el valor esperado, con el límite superior y con el límite inferior del intervalo del 80 %. El gasto de cada periodo DEBE (MUST) repartirse en partes iguales por día: en el periodo en curso, lo que falta (el valor del pronóstico menos el gasto variable ya hecho en el periodo, nunca menos de cero) entre los días desde hoy hasta el fin del periodo, ambos incluidos; en los siguientes, el valor del periodo entre sus días. Estas series NO DEBEN (MUST NOT) sumarse a la serie principal ni a la del gasto planificado.
Trace: FR-FORECAST-008, FR-REPORTING-014 · Priority: Should

#### Scenario: Banda del periodo en curso
- **CUANDO** hoy es 2026-11-21, el periodo 2026-11 va del 2026-11-01 al 2026-11-30, el gasto variable líquido predicho de 2026-11 en BOB es 1500.00 BOB con intervalo del 80 % de 1200.00 BOB a 1900.00 BOB, ya se gastaron 1050.00 BOB variables en el periodo y la serie principal en BOB vale 5000.00 BOB todos los días
- **ENTONCES** el calendario de 7 días informa el 2026-11-28 la serie con gasto esperado en 4640.00 BOB, con gasto alto en 4320.00 BOB y con gasto bajo en 4880.00 BOB
- **Y** la serie principal del 2026-11-28 sigue en 5000.00 BOB

#### Scenario: Gasto ya superado en el periodo en curso
- **CUANDO** ya se gastaron 2000.00 BOB variables en 2026-11
- **ENTONCES** lo que falta del periodo es 0.00 BOB para el valor esperado y para el límite superior, y las series adicionales coinciden con la principal hasta el 2026-11-30

#### Scenario: Periodo siguiente dentro del horizonte
- **CUANDO** el calendario de 30 días llega al 2026-12-20 y el gasto variable predicho de 2026-12 es 1550.00 BOB
- **ENTONCES** cada día de diciembre del horizonte resta 50.00 BOB en la serie con gasto esperado

### Requirement: Probabilidad de déficit con el gasto variable predicho
Para cada moneda con banda, el calendario DEBE (MUST) informar la probabilidad de déficit con el gasto predicho: probable si el saldo más bajo de la serie con gasto esperado queda por debajo del umbral del riesgo (la reserva mínima o cero), posible si solo queda por debajo la serie con gasto alto, e improbable en otro caso, con la fecha del primer día por debajo del umbral; sin banda DEBE (MUST) informarse como no disponible. La respuesta DEBE (MUST) aclarar que el gasto alto corresponde al límite superior del intervalo del 80 %.
Trace: FR-FORECAST-008, FR-REPORTING-015 · Priority: Should

#### Scenario: Déficit posible solo con gasto alto
- **CUANDO** la reserva mínima es 1500.00 BOB y en el horizonte el saldo más bajo es 2600.00 BOB en la serie principal, 2150.00 BOB con gasto esperado y 1380.00 BOB con gasto alto el 2026-12-14
- **ENTONCES** la probabilidad de déficit en BOB es posible con fecha 2026-12-14

#### Scenario: Déficit probable con gasto esperado
- **CUANDO** el saldo más bajo con gasto esperado es 1420.00 BOB el 2026-12-10
- **ENTONCES** la probabilidad de déficit en BOB es probable con fecha 2026-12-10

### Requirement: Calendario sin pronóstico disponible
Sin pronóstico vigente, con la función deshabilitada, sin serie de gasto variable líquido para una moneda, con esa serie con datos insuficientes o sin punto para el periodo en curso, el calendario DEBE (MUST) omitir la banda de esa moneda e informar el motivo, y todo lo demás del calendario DEBE (MUST) quedar igual que sin la función de pronóstico.
Trace: FR-FORECAST-006, FR-FORECAST-008 · Priority: Should

#### Scenario: Función deshabilitada
- **CUANDO** la función de pronóstico está deshabilitada y un miembro pide el calendario de 30 días
- **ENTONCES** el calendario no tiene bandas, informa el motivo función no habilitada y sus demás cifras son las mismas que sin la función

#### Scenario: Serie en dólares con datos insuficientes
- **CUANDO** la serie de gasto variable líquido en USD tiene 2 periodos de historia
- **ENTONCES** el calendario muestra la banda en BOB y para USD informa datos insuficientes sin banda

### Requirement: Riesgo y alerta de déficit sin cambios por el pronóstico
El nivel de riesgo de déficit, el episodio de riesgo y su alerta DEBEN (MUST) seguir calculándose solo con la serie principal; la banda y la probabilidad de déficit con el gasto predicho NO DEBEN (MUST NOT) cambiar el nivel de riesgo, abrir o cerrar episodios ni enviar notificaciones.
Trace: FR-REPORTING-015, FR-FORECAST-008 · Priority: Should

#### Scenario: Banda por debajo del umbral sin riesgo principal
- **CUANDO** la serie principal en BOB no baja de 2600.00 BOB, la reserva mínima es 1500.00 BOB y la serie con gasto esperado baja a 1420.00 BOB
- **ENTONCES** el nivel de riesgo en BOB es el mismo que sin la banda y no se abre ningún episodio
- **Y** la probabilidad de déficit con el gasto predicho es probable

### Requirement: Rendimiento del calendario con la banda predicha
Con la banda, el calendario de 90 días DEBE (MUST) seguir respondiendo con un p95 de 500 ms o menos en el workspace del benchmark, leyendo el pronóstico vigente en la misma transacción de lectura, sin llamar al servicio de pronósticos.
Trace: NFR-PERF-010, FR-FORECAST-006 · Priority: Should

#### Scenario: Workspace grande con pronóstico
- **CUANDO** el workspace del benchmark tiene 40 cuentas líquidas, 300 ocurrencias no resueltas en 90 días y un pronóstico vigente con series en BOB y USD
- **ENTONCES** el p95 del calendario de 90 días es como máximo 0.50 s
