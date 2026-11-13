## ADDED Requirements

### Requirement: Gasto esperado del periodo en el Home
Con un pronóstico vigente que tenga el gasto total del periodo en curso, la tarjeta "¿Cuánto gasté?" (Q3) del Home DEBE (MUST) mostrar, junto al gasto del periodo, el gasto total esperado del periodo con su rango probable del 80 % y el texto "Esperado"; sin ese pronóstico la tarjeta NO DEBE (MUST NOT) cambiar.
Trace: FR-FORECAST-001, FR-FORECAST-004, FR-REPORTING-001 · Priority: Should

#### Scenario: Gasto esperado del periodo
- **CUANDO** el 2026-12-12 el gasto del periodo 2026-12 es 2980.00 BOB y el pronóstico vigente espera 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB
- **ENTONCES** la tarjeta Q3 muestra 2980.00 BOB gastados y el gasto esperado de 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB (80 %), con los formatos del locale

#### Scenario: Sin pronóstico
- **CUANDO** el workspace no tiene pronóstico vigente
- **ENTONCES** la tarjeta Q3 muestra solo el gasto del periodo como hasta ahora

### Requirement: Probabilidad de déficit en la tarjeta de Q8
Con banda en el calendario de 30 días, la tarjeta "¿Qué pagos vienen?" (Q8) DEBE (MUST) mostrar la probabilidad de déficit con el gasto predicho de la moneda con la probabilidad más alta, con su fecha, separada del riesgo de la serie principal y con el enlace al calendario.
Trace: FR-FORECAST-008, FR-REPORTING-015 · Priority: Should

#### Scenario: Déficit posible en el Home
- **CUANDO** el riesgo de la serie principal es `NONE` en todas las monedas y la probabilidad de déficit con el gasto predicho es posible en BOB con fecha 2026-12-14
- **ENTONCES** la tarjeta de Q8 muestra que los pagos conocidos no tienen riesgo y, aparte, un déficit posible en BOB el 2026-12-14 si el gasto variable es alto
