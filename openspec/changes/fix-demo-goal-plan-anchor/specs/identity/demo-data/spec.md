## MODIFIED Requirements

### Requirement: Contenido demo ficticio, realista y determinista
Los datos de demostración DEBEN (MUST) usar solo instituciones, comercios y personas ficticios con apariencia real, sin números de cuenta reales, y DEBEN (MUST) generarse de forma determinista desde el dataset versionado y la fecha ancla, por los mismos casos de uso que la operación real, de modo que todas las invariantes del ledger se cumplan. El dataset DEBE (MUST) incluir, además de cuentas, transacciones, transferencias, conversiones y tasas, suscripciones y compromisos recurrentes, tarjetas de crédito con sus ciclos, préstamos con su cronograma y metas de ahorro, todos creados por los casos de uso de sus contextos. Las fechas de esos elementos DEBEN (MUST) calcularse respecto de la fecha ancla de modo que sus estados se conserven con cualquier ancla. Las instituciones de la demo NO DEBEN (MUST NOT) tomarse del catálogo de referencia de instituciones del entorno, y las tasas de la demo DEBEN (MUST) ser tasas manuales ficticias, sin observaciones de proveedores de tasas.
Trace: FR-IDENTITY-014, FR-LEDGER-001 · Priority: Must

#### Scenario: Dos cargas con la misma ancla producen los mismos saldos
- **CUANDO** se cargan dos veces los datos de demostración con la versión de dataset 2 y la fecha ancla 2026-09-30, en dos workspaces de demostración distintos
- **ENTONCES** ambos workspaces tienen las mismas cuentas con los mismos saldos por moneda, iguales al resumen de referencia del dataset
- **Y** en ambos los movimientos de cada asiento suman 0.00 por moneda
- **Y** ambos tienen las mismas suscripciones, tarjetas, préstamos y metas con los mismos estados y cifras del resumen de referencia

#### Scenario: Instituciones ficticias
- **CUANDO** se cargan los datos de demostración
- **ENTONCES** las instituciones tienen nombres ficticios como "Banco Andino Demo" y los identificadores de cuenta llevan el prefijo `DEMO-`

#### Scenario: Instituciones independientes del catálogo de referencia
- **CUANDO** se cargan los datos de demostración en un entorno cuyo catálogo de referencia de instituciones contiene entidades reales
- **ENTONCES** ninguna institución del workspace de demostración proviene de ese catálogo y todas tienen nombres ficticios terminados en "Demo"

#### Scenario: Otra fecha ancla conserva los estados
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-10-05 en lugar de 2026-09-30
- **ENTONCES** la demo tiene las mismas suscripciones en los mismos estados (5 activas, 1 en trial, 1 pausada y 1 cancelada), el estado de cuenta en USD de "Tarjeta Kantuta Demo" anterior al último está vencido y el último está emitido sin vencer
- **Y** el "Préstamo de consumo" tiene al menos una cuota en mora, el "Préstamo familiar" está saldado, "Viaje" está atrasada respecto del plan y "Laptop" está alcanzada
- **Y** ningún movimiento de la demo tiene fecha posterior a la ancla, salvo las ocurrencias, cuotas y cargos futuros que generan los propios cronogramas

#### Scenario: Ancla de fin de mes con la cuota en día 29 a 31
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-11-20, de modo que `A − 20` cae el 2026-10-31
- **ENTONCES** la carga termina `READY` sin `DEMO_GOLDEN_MISMATCH`
- **Y** la cuota 8 del "Crédito educativo" vence el 2026-10-28 (día 28, no el 31) y está pagada, y la cuota 9 vence el 2026-11-28
- **Y** el primer periodo de cada préstamo mide 30 días 30/360 desde su desembolso, con cualquier ancla

#### Scenario: Ancla con el día del plan de metas en 29 a 31
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-11-25, de modo que `A − 25` cae el 2026-10-31 y el plan del "Fondo de emergencia" corre el día 31
- **ENTONCES** la carga termina `READY` sin `DEMO_LOAD_FAILED`
- **Y** los aportes del "Fondo de emergencia" caen en el último día de cada mes corto (2025-11-30, 2025-12-31, 2026-01-31, 2026-02-28), igual que las ocurrencias que genera la regla de la meta, con cualquier ancla
