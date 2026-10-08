# Spec Delta

## ADDED Requirements

### Requirement: Recorrido de un periodo financiero
El periodo financiero DEBE (MUST) tener una máquina de estados declarada con los estados `draft`, `active`, `closed` y `reopened`, ninguno terminal, y su recorrido DEBE (MUST) mostrar en orden las transiciones crear, activar, cerrar, reabrir y re-cerrar con actor (usuario o proceso), instante, el motivo en la reapertura y la versión del snapshot en cada cierre; los recálculos de rango por cambio del día de inicio DEBEN (MUST) aparecer como anotaciones.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-PLANNING-001, FR-PLANNING-006 · Priority: Must

#### Scenario: Recorrido completo de octubre
- **CUANDO** "2026-10" se creó en `draft` por el proceso de periodos, se activó automáticamente, el EDITOR lo cerró, el OWNER lo reabrió con el motivo "Faltó registrar la comisión bancaria" y el EDITOR lo cerró de nuevo
- **ENTONCES** el recorrido muestra en orden: crear (a `draft`), activar (`draft` a `active`), cerrar (`active` a `closed`, snapshot 1), reabrir (`closed` a `reopened`, con el motivo) y cerrar (`reopened` a `closed`, snapshot 2)
- **Y** el estado actual es `closed` y un VIEWER puede consultar el recorrido

#### Scenario: Recálculo como anotación
- **CUANDO** el periodo `draft` "2026-12" se recalcula del rango del 2026-12-01 al 2026-12-31 al del 2026-12-25 al 2027-01-24 por un cambio del día de inicio
- **ENTONCES** el recorrido de "2026-12" muestra una anotación con el rango anterior y el nuevo, sin transición de estado
