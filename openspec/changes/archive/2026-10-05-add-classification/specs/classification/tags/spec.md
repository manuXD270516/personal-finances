# Spec Delta

## Purpose

Etiquetas (tags) transversales a la jerarquía de categorías: marcas libres que el usuario aplica a sus movimientos (por ejemplo un viaje, un proyecto o un evento) para agruparlos y consultarlos, con archivado en lugar de borrado y sin efecto alguno sobre el ledger.

## ADDED Requirements

### Requirement: Gestión de tags
El sistema DEBE (MUST) permitir crear tags con nombre y color opcional, y editarlos. El nombre DEBE (MUST) ser único, sin distinguir mayúsculas ni acentos, entre los tags activos del workspace; un duplicado DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-CLASSIFICATION-008 · Priority: Must

#### Scenario: Tag creado
- **CUANDO** el usuario crea el tag "Viaje Santa Cruz 2026" con color "#1565C0"
- **ENTONCES** el tag queda activo y disponible en el selector de tags

#### Scenario: Nombre de tag duplicado
- **CUANDO** existe el tag activo "Trabajo" y el usuario crea el tag "trabajo"
- **ENTONCES** la operación se rechaza con `NAME_TAKEN`

### Requirement: Múltiples tags por porción de transacción
Cada porción de una transacción DEBE (MUST) admitir cero o más tags distintos. Un movimiento con varios tags DEBE (MUST) contarse completo en el total de cada uno de sus tags, sin duplicar su monto en los totales por categoría ni en el total de gastos.
Trace: FR-CLASSIFICATION-008 · Priority: Must

#### Scenario: Gasto con dos tags
- **CUANDO** el usuario registra un gasto de 230.00 BOB en "Restaurantes" con los tags "Viaje Santa Cruz 2026" y "Trabajo"
- **ENTONCES** el total del tag "Viaje Santa Cruz 2026" incluye 230.00 BOB y el del tag "Trabajo" incluye 230.00 BOB
- **Y** el gasto total del mes aumenta exactamente 230.00 BOB

#### Scenario: Tag repetido en la misma porción
- **CUANDO** el usuario asigna dos veces el tag "Trabajo" a la misma porción
- **ENTONCES** la porción queda con el tag "Trabajo" una sola vez

### Requirement: Los tags se archivan en lugar de eliminarse
El sistema NO DEBE (MUST NOT) eliminar tags: solo archivarlos. Archivar un tag NO DEBE (MUST NOT) quitarlo de las transacciones que ya lo tienen, y los históricos DEBEN (MUST) seguir mostrándolo como archivado.
Trace: FR-CLASSIFICATION-008 · Priority: Must

#### Scenario: Archivar un tag con historial
- **CUANDO** el tag "Viaje Santa Cruz 2026" está en 4 gastos que suman 1,180.00 BOB y el usuario lo archiva
- **ENTONCES** los 4 gastos conservan el tag
- **Y** el reporte por tag muestra "Viaje Santa Cruz 2026" = 1,180.00 BOB marcado como archivado

### Requirement: Un tag archivado no es asignable
Un tag archivado NO DEBE (MUST NOT) aparecer en los selectores ni añadirse a transacciones nuevas o editadas; el intento DEBE (MUST) rechazarse con `TAG_ARCHIVED`.
Trace: FR-CLASSIFICATION-008 · Priority: Must

#### Scenario: Asignar un tag archivado
- **CUANDO** el usuario registra un gasto de 95.00 BOB con el tag archivado "Viaje Santa Cruz 2026"
- **ENTONCES** la operación se rechaza con `TAG_ARCHIVED`

### Requirement: Desarchivar un tag
El sistema DEBE (MUST) permitir desarchivar un tag, que vuelve a ser asignable; si su nombre ya lo usa otro tag activo, DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-CLASSIFICATION-008 · Priority: Should

#### Scenario: Tag desarchivado
- **CUANDO** el usuario desarchiva "Viaje Santa Cruz 2026" y registra un gasto de 95.00 BOB con ese tag
- **ENTONCES** el gasto se acepta con el tag

### Requirement: Renombrar un tag no altera el historial
Las transacciones DEBEN (MUST) referenciar los tags por identidad: renombrar un tag DEBE (MUST) reflejarse en todos los históricos sin modificar transacciones ni montos.
Trace: FR-CLASSIFICATION-008 · Priority: Must

#### Scenario: Renombrar un tag
- **CUANDO** el tag "Viaje SCZ" está en gastos por 600.00 BOB y el usuario lo renombra a "Viaje Santa Cruz 2026"
- **ENTONCES** el reporte por tag muestra "Viaje Santa Cruz 2026" = 600.00 BOB

### Requirement: Etiquetar no modifica el ledger
Añadir o quitar tags de una transacción NO DEBE (MUST NOT) crear, modificar ni revertir asientos contables ni alterar ningún saldo de cuenta.
Trace: FR-LEDGER-008, FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Añadir un tag a un gasto contabilizado
- **CUANDO** a un gasto contabilizado de 100.000000 USDT desde "Wallet USDT" (saldo 500.000000 USDT) se le añade el tag "Trabajo"
- **ENTONCES** el número de asientos contables no cambia y el saldo de "Wallet USDT" sigue siendo 500.000000 USDT
