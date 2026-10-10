## MODIFIED Requirements

### Requirement: Exportación CSV del log de auditoría
Solo el OWNER DEBERÍA poder exportar a CSV el resultado de una consulta global del log de auditoría con los mismos filtros; cuando se ofrece, el CSV DEBE (MUST) usar UTF-8, separador coma y punto decimal, expresar los instantes en la zona horaria del workspace con su desfase, incluir el identificador y el nombre visible del actor (vacío para procesos), conservar enmascarados los campos sensibles y neutralizar las celdas que empiecen con `=`, `+`, `-`, `@`, tabulación o retorno; un EDITOR DEBE (MUST) recibir `INSUFFICIENT_ROLE`, una consulta de más de 50000 registros DEBE (MUST) rechazarse con `VALIDATION_FAILED` y cada exportación DEBE (MUST) auditarse.
Trace: FR-AUDIT-006, FR-AUDIT-005, NFR-SEC-015 · Priority: Should

#### Scenario: El OWNER exporta los cambios de marzo
- **CUANDO** el OWNER exporta a CSV el log de marzo de 2026 que contiene un registro del 2026-03-15T23:30:00-04:00 con una transacción cuya descripción anterior era "=SUM(A1)"
- **ENTONCES** obtiene un CSV con ese instante como "2026-03-15T23:30:00-04:00", la descripción neutralizada y una fila por registro del rango
- **Y** cada fila de un cambio hecho por un usuario incluye su id y su nombre visible
- **Y** existe un registro de auditoría de la exportación del log con el actor y los filtros usados

#### Scenario: EDITOR intenta exportar
- **CUANDO** un EDITOR del workspace exporta a CSV el log de auditoría
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`
