## ADDED Requirements

### Requirement: Líneas en riesgo de exceder en el Home
Junto al disponible para gastar (Q5), el Home DEBE (MUST) mostrar hasta 3 líneas del plan del periodo en curso con riesgo «probable» de exceder su tope, ordenadas por fecha estimada del exceso, cada una con su nombre, la proyección, la referencia y la fecha, e indicar cuántas más hay con el enlace al plan; sin líneas en riesgo o sin plan, la tarjeta NO DEBE (MUST NOT) cambiar. Mostrar las líneas en riesgo NO DEBE (MUST NOT) modificar el cálculo del disponible para gastar.
Trace: FR-REPORTING-020, FR-REPORTING-001 · Priority: Should

#### Scenario: Dos líneas en riesgo
- **CUANDO** el 2026-11-10 "Restaurantes" tiene riesgo «probable» con exceso estimado el 2026-11-22 y "Servicios" con exceso estimado el 2026-11-21
- **ENTONCES** la tarjeta de Q5 muestra primero "Servicios" (21/11/2026) y luego "Restaurantes" (22/11/2026), con el enlace al plan
- **Y** el disponible para gastar es el mismo que sin las líneas en riesgo

#### Scenario: Sin líneas en riesgo
- **CUANDO** ninguna línea del plan tiene riesgo «probable»
- **ENTONCES** la tarjeta de Q5 se muestra como hasta ahora
