# Spec Delta

## Purpose

Define la advertencia de posibles duplicados al registrar transacciones manualmente en Phase 1: el sistema informa candidatos parecidos sin bloquear, fusionar ni eliminar nada; la detección y resolución de duplicados en imports llega en Phase 6.

## ADDED Requirements

### Requirement: Advertencia de posibles duplicados en la entrada manual
Al registrar manualmente una transacción, el sistema DEBE (MUST) advertir como posibles duplicados las transacciones no anuladas de la misma cuenta, mismo monto y moneda, fecha a ±3 días y descripción o contraparte similar, sin bloquear el registro ni modificar ninguna transacción.
Trace: FR-TRANSACTIONS-031 · Priority: Should

#### Scenario: Mismo gasto registrado al día siguiente
- **CUANDO** existe un gasto posteado de 45.90 BOB en "Bank A" con contraparte "Supermercado Demo" del 2026-03-10 y el usuario registra otro gasto de 45.90 BOB en "Bank A" con contraparte "Supermercado Demo" el 2026-03-11
- **ENTONCES** el nuevo gasto se registra
- **Y** la respuesta incluye una advertencia de posible duplicado que identifica el gasto del 2026-03-10
- **Y** ambos gastos permanecen registrados sin cambios

#### Scenario: Fuera de la ventana de días
- **CUANDO** el gasto existente de 45.90 BOB es del 2026-03-10 y el nuevo, con la misma cuenta y contraparte, es del 2026-03-14
- **ENTONCES** el gasto se registra sin advertencia de duplicado

#### Scenario: Otra cuenta
- **CUANDO** el nuevo gasto de 45.90 BOB con contraparte "Supermercado Demo" del 2026-03-11 se registra en "Credit Card"
- **ENTONCES** no se advierte duplicado respecto del gasto en "Bank A"

#### Scenario: Consulta previa sin efectos
- **CUANDO** el formulario consulta posibles duplicados para 45.90 BOB en "Bank A" con fecha 2026-03-11 antes de guardar
- **ENTONCES** recibe el gasto del 2026-03-10 como candidato y no se persiste nada
