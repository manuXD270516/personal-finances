## ADDED Requirements

### Requirement: Resolución de tasas por lote con costo acotado
La valoración por lote (la tasa vigente de muchos pares e instantes en una sola lectura de tasas candidatas) DEBE (MUST) resolver cada solicitud con la misma regla que la consulta individual de la tasa vigente (tasa no reemplazada más reciente dentro de la ventana, tipo preferido del par, inversa vinculada, cruzada por pivote solo para valoración y selección con fallback entre providers) y con el mismo resultado, incluida la elección entre tasas con la misma vigencia. El costo de resolver el lote NO DEBE (MUST NOT) crecer con el producto entre solicitudes y tasas candidatas: cada candidata DEBE (MUST) interpretarse una sola vez por lote y cada solicitud DEBE (MUST) examinar solo las candidatas de su par y de su ventana.
Trace: FR-FX-004, FR-FX-006, NFR-PERF-006 · Priority: Should

#### Scenario: Misma tasa que la consulta individual
- **CUANDO** existen USD/BOB `PARALLEL` 9.70 del 2026-03-08 y 9.80 del 2026-03-15, y un lote pide USD/BOB al 2026-03-10, al 2026-03-16 y al 2026-03-25 con la ventana por defecto de 7 días
- **ENTONCES** el lote obtiene 9.70, 9.80 y ninguna tasa, con la misma fuente, vigencia y selección que la consulta individual de cada instante

#### Scenario: Lote grande con muchas candidatas
- **CUANDO** un lote de 2 000 solicitudes se resuelve contra 10 000 tasas candidatas de 3 años
- **ENTONCES** cada candidata se interpreta una vez y cada solicitud examina solo las tasas de su par dentro de su ventana
