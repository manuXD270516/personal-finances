## ADDED Requirements

### Requirement: Observación de tasa por cada conversión propia
Cada conversión posteada DEBE (MUST) registrarse en el historial de tasas del workspace como una observación con origen conversión propia: el par en la orientación de visualización de la conversión, su tasa efectiva como valor, el instante de ejecución como vigencia y la referencia a la conversión y su revisión; la observación DEBE (MUST) ser inmutable como cualquier tasa, registrarse una sola vez por conversión y revisión aunque el hecho se procese varias veces, y las conversiones posteadas antes de este cambio DEBEN (MUST) registrarse con la misma regla.
Trace: FR-FX-011, FR-FX-003, FR-FX-007 · Priority: Should

#### Scenario: Venta de USDT observada
- **CUANDO** se postea la venta de 100.000000 USDT por 1190.00 BOB netos ejecutada el 2026-10-05T10:00:00-04:00
- **ENTONCES** el historial de USDT/BOB tiene una observación con origen conversión propia, valor 11.900000000000000000 y vigencia 2026-10-05T10:00:00-04:00 que referencia esa conversión
- **Y** procesar otra vez el mismo hecho no registra una segunda observación

#### Scenario: Conversión anterior a este cambio
- **CUANDO** el workspace tenía 12 conversiones posteadas antes de habilitar las observaciones
- **ENTONCES** la carga inicial registra 12 observaciones y repetirla no registra ninguna más

### Requirement: Las observaciones de conversiones nunca se usan para valorar
Las observaciones con origen conversión propia NO DEBEN (MUST NOT) usarse para valorar saldos ni flujos, ni como tasa de referencia resuelta automáticamente de otra conversión, ni como tasa componente de una tasa cruzada, aunque sean más recientes que cualquier otra tasa del par; DEBEN (MUST) seguir visibles en el historial del par con su origen.
Trace: FR-FX-006, FR-FX-008 · Priority: Must

#### Scenario: Observación más reciente que la tasa del provider
- **CUANDO** la última tasa `PARALLEL` USDT/BOB de paralelo.bo es 12.02 con vigencia 2026-10-05T13:50:00Z y la venta de las 2026-10-05T14:00:00Z dejó una observación de 11.90
- **Y** se valoran 100.000000 USDT a las 2026-10-05T14:05:00Z
- **ENTONCES** el resultado es 1202.00 BOB con la tasa 12.02 de paralelo.bo
- **Y** una conversión registrada a las 14:10Z sin referencia indicada no toma 11.90 como referencia

### Requirement: Observación de una conversión revisada o anulada
Cuando una conversión se revisa financieramente, el sistema DEBE (MUST) registrar la observación de la revisión nueva reemplazando a la anterior con el motivo "conversión revisada", sin modificarla; cuando una conversión se anula, DEBE (MUST) marcar su observación vigente como anulada sin borrarla ni cambiar su valor.
Trace: FR-FX-003, FR-FX-011 · Priority: Should

#### Scenario: Venta revisada
- **CUANDO** la venta de 100.000000 USDT por 1190.00 BOB se revisa a 100.000000 USDT por 1188.00 BOB
- **ENTONCES** el historial tiene la observación 11.880000000000000000 que reemplaza a la de 11.900000000000000000 con el motivo "conversión revisada"
- **Y** la observación de 11.900000000000000000 sigue consultable con su valor, marcada como reemplazada

#### Scenario: Venta anulada
- **CUANDO** en cambio la venta se anula
- **ENTONCES** la observación de 11.900000000000000000 sigue consultable con su valor y marcada como anulada
