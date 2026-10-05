# Spec Delta

## Purpose

Permite al usuario definir campos personalizados tipados para transacciones y cuentas (texto, número entero, decimal, fecha, booleano y selección), asignarles valores validados sin tocar nunca el ledger, archivarlos conservando los valores históricos y proteger las definiciones que ya tienen valores (FR-CLASSIFICATION-009).

## ADDED Requirements

### Requirement: Definir un custom field
Un EDITOR u OWNER DEBERÍA poder definir un custom field con clave, etiqueta, tipo (`TEXT`, `NUMBER` entero, `DECIMAL`, `DATE`, `BOOLEAN` o `SELECT`), entidad objetivo (`TRANSACTION` o `ACCOUNT`), obligatoriedad y, para `SELECT`, al menos una opción con clave y etiqueta únicas; cuando se ofrece, una definición incompleta o un `SELECT` sin opciones DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-CLASSIFICATION-009 · Priority: Should

#### Scenario: Definir el centro de costo de las transacciones
- **CUANDO** el usuario define el custom field "centro_costo" con etiqueta "Centro de costo", tipo `SELECT`, objetivo `TRANSACTION`, no obligatorio y opciones "casa" y "oficina"
- **ENTONCES** la definición queda activa y aparece en el formulario de transacciones con esas dos opciones

#### Scenario: Selección sin opciones
- **CUANDO** el usuario define "proyecto" de tipo `SELECT` sin opciones
- **ENTONCES** se rechaza con `VALIDATION_FAILED`

### Requirement: Clave única e inmutable del custom field
La clave de un custom field DEBE (MUST) cumplir el formato `snake_case` (una letra minúscula seguida de hasta 39 letras minúsculas, dígitos o guiones bajos), ser única entre las definiciones activas del workspace (`CUSTOM_FIELD_KEY_TAKEN`) y NO DEBE (MUST NOT) poder cambiarse después de creada; la etiqueta sí DEBERÍA poder cambiarse sin afectar los valores.
Trace: FR-CLASSIFICATION-009 · Priority: Should

#### Scenario: Clave repetida
- **CUANDO** ya existe la definición activa "centro_costo" y el usuario define otra con la clave "centro_costo"
- **ENTONCES** se rechaza con `CUSTOM_FIELD_KEY_TAKEN`

#### Scenario: Renombrar la etiqueta
- **CUANDO** el usuario cambia la etiqueta de "centro_costo" a "Centro de gasto" y un gasto de 45.90 BOB tenía "oficina"
- **ENTONCES** el gasto sigue con "centro_costo" = "oficina" y se muestra con la etiqueta "Centro de gasto"

### Requirement: Validación de valores según el tipo
Todo valor asignado a un custom field DEBE (MUST) validarse contra su definición: `TEXT` de 1 a 500 caracteres, `NUMBER` entero de hasta 15 dígitos, `DECIMAL` como texto decimal exacto con hasta 18 decimales (nunca punto flotante), `DATE` en formato ISO `AAAA-MM-DD`, `BOOLEAN` verdadero o falso y `SELECT` una clave de opción vigente; un valor inválido DEBE (MUST) rechazarse con `CUSTOM_FIELD_VALUE_INVALID` sin persistir nada.
Trace: FR-CLASSIFICATION-009, NFR-DATA-001 · Priority: Should

#### Scenario: Decimal exacto
- **CUANDO** existe el custom field `DECIMAL` "litros" de transacción y el usuario registra un gasto de 120.00 BOB con "litros" = "35.125"
- **ENTONCES** al consultarlo el valor es exactamente "35.125"

#### Scenario: Número con decimales en un campo entero
- **CUANDO** existe el custom field `NUMBER` "cuota" y el usuario registra un gasto de 300.00 BOB con "cuota" = "3.5"
- **ENTONCES** se rechaza con `CUSTOM_FIELD_VALUE_INVALID` y el gasto no se registra

#### Scenario: Fecha inválida
- **CUANDO** existe el custom field `DATE` "garantia_hasta" y el usuario asigna "2026-02-30"
- **ENTONCES** se rechaza con `CUSTOM_FIELD_VALUE_INVALID`

### Requirement: Custom fields de transacción por split
Los valores de un custom field con objetivo `TRANSACTION` DEBERÍAN asignarse por split nominal de ingresos, gastos y reembolsos (cada split puede tener su propio valor); cuando se ofrece, un custom field con objetivo `ACCOUNT` usado en una transacción DEBE (MUST) rechazarse con `CUSTOM_FIELD_TARGET_MISMATCH`.
Trace: FR-CLASSIFICATION-009, FR-TRANSACTIONS-026 · Priority: Should

#### Scenario: Valores distintos por split
- **CUANDO** el usuario registra un gasto de 300.00 BOB con un split de 200.00 BOB "centro_costo" = "casa" y otro de 100.00 BOB "centro_costo" = "oficina"
- **ENTONCES** cada split conserva su valor y la suma de splits sigue siendo 300.00 BOB

#### Scenario: Campo de cuenta en una transacción
- **CUANDO** existe el custom field "sucursal" con objetivo `ACCOUNT` y el usuario lo asigna en un gasto
- **ENTONCES** se rechaza con `CUSTOM_FIELD_TARGET_MISMATCH`

### Requirement: Custom fields de cuenta
Los valores de un custom field con objetivo `ACCOUNT` DEBERÍAN poder asignarse al crear o editar una cuenta y devolverse al consultarla; cuando se ofrece, asignarlos NO DEBE (MUST NOT) cambiar el saldo ni los movimientos de la cuenta.
Trace: FR-CLASSIFICATION-009, FR-ACCOUNTS-001 · Priority: Should

#### Scenario: Sucursal de una cuenta bancaria
- **CUANDO** existe el custom field `TEXT` "sucursal" de cuenta y el usuario asigna "Sucursal Centro" a "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** "Bank A" devuelve "sucursal" = "Sucursal Centro" y su saldo sigue en 1000.00 BOB

### Requirement: Custom field obligatorio en registros nuevos
Un custom field obligatorio DEBERÍA exigir valor al crear una transacción (en cada split nominal) o una cuenta de su entidad objetivo, y al editar los custom fields de un registro existente; cuando se exige, la falta de valor DEBE (MUST) rechazarse con `CUSTOM_FIELD_REQUIRED` y los registros creados antes de que el campo fuera obligatorio DEBEN (MUST) seguir siendo válidos sin valor.
Trace: FR-CLASSIFICATION-009 · Priority: Should

#### Scenario: Gasto nuevo sin el campo obligatorio
- **CUANDO** "centro_costo" es obligatorio y el usuario registra un gasto de 45.90 BOB sin indicarlo
- **ENTONCES** se rechaza con `CUSTOM_FIELD_REQUIRED` y el gasto no se registra

#### Scenario: Gasto previo sin valor
- **CUANDO** un gasto de 150.00 BOB se registró antes de que "centro_costo" fuera obligatorio y el usuario edita su descripción
- **ENTONCES** la edición se acepta y el gasto sigue sin "centro_costo"

### Requirement: Asignar custom fields no modifica el ledger
Asignar, cambiar o quitar valores de custom fields de transacciones o cuentas NO DEBE (MUST NOT) crear, modificar ni revertir asientos ni alterar ningún saldo, y DEBE (MUST) quedar auditado con el valor antes y después en la misma transacción de base de datos.
Trace: FR-CLASSIFICATION-009, FR-TRANSACTIONS-008, FR-AUDIT-001, INV-033 · Priority: Must

#### Scenario: Cambiar el centro de costo de un gasto posteado
- **CUANDO** un gasto posteado de 150.00 BOB de "Bank A" (saldo 2000.00 BOB) cambia "centro_costo" de "casa" a "oficina"
- **ENTONCES** el número de asientos no cambia, el saldo de "Bank A" sigue en 2000.00 BOB y la auditoría registra "casa" antes y "oficina" después

### Requirement: Archivar y desarchivar un custom field
Un EDITOR u OWNER DEBERÍA poder archivar y desarchivar una definición; cuando se ofrece, una definición archivada DEBE (MUST) conservar y mostrar los valores históricos, NO DEBE (MUST NOT) aparecer en los formularios ni aceptar valores nuevos (`CUSTOM_FIELD_ARCHIVED`) y su clave DEBE (MUST) quedar libre para una definición activa nueva.
Trace: FR-CLASSIFICATION-009, INV-019 · Priority: Should

#### Scenario: Archivar el centro de costo
- **CUANDO** el usuario archiva "centro_costo" y un gasto de 45.90 BOB tenía "oficina"
- **ENTONCES** el gasto sigue mostrando "centro_costo" = "oficina" y el formulario de transacciones ya no ofrece el campo

#### Scenario: Asignar un campo archivado
- **CUANDO** el usuario intenta registrar un gasto con "centro_costo" archivado
- **ENTONCES** se rechaza con `CUSTOM_FIELD_ARCHIVED`

### Requirement: Cambios protegidos de una definición con valores
Mientras una definición tenga valores asignados, su tipo y su entidad objetivo NO DEBEN (MUST NOT) cambiar (`CUSTOM_FIELD_TYPE_LOCKED`) y una opción de `SELECT` en uso NO DEBE (MUST NOT) eliminarse (`CUSTOM_FIELD_OPTION_IN_USE`); agregar opciones y cambiar etiquetas de opciones DEBERÍA permitirse sin alterar los valores.
Trace: FR-CLASSIFICATION-009 · Priority: Should

#### Scenario: Cambiar el tipo de un campo con valores
- **CUANDO** "centro_costo" tiene valores y el usuario intenta cambiar su tipo a `TEXT`
- **ENTONCES** se rechaza con `CUSTOM_FIELD_TYPE_LOCKED`

#### Scenario: Quitar una opción en uso
- **CUANDO** un gasto tiene "centro_costo" = "oficina" y el usuario intenta eliminar la opción "oficina"
- **ENTONCES** se rechaza con `CUSTOM_FIELD_OPTION_IN_USE`

### Requirement: Custom fields de transacciones en periodos cerrados
Asignar, cambiar o quitar valores de custom fields de una transacción cuya fecha de negocio cae en un periodo cerrado DEBERÍA rechazarse; cuando se rechaza, DEBE (MUST) hacerlo con `PERIOD_CLOSED` sin cambiar el valor ni escribir auditoría.
Trace: FR-CLASSIFICATION-009, FR-PLANNING-005, INV-015 · Priority: Should

#### Scenario: Cambiar el centro de costo en marzo cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario cambia "centro_costo" de un gasto de 150.00 BOB del 2026-03-15
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el valor no cambia

### Requirement: Gestión de custom fields restringida por rol
Solo EDITOR u OWNER DEBEN (MUST) poder definir, editar, archivar y desarchivar custom fields; un VIEWER DEBE (MUST) poder ver las definiciones y los valores pero recibir `INSUFFICIENT_ROLE` al intentar modificarlos.
Trace: FR-CLASSIFICATION-009, FR-IDENTITY-006 · Priority: Should

#### Scenario: VIEWER intenta definir un custom field
- **CUANDO** un VIEWER del workspace intenta definir "proyecto"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`
