# ADR-0004: Modelo de ledger — doble entrada simplificada, multi-moneda, append-only

- Estado: Aceptado (2026-10-02, tras SPIKE-02/03; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §4; docs/09-ledger-design.md (catálogo INV-NNN); ADR-0005, ADR-0006, ADR-0007, ADR-0023; OpenSpec capabilities `ledger/journal-posting`, `ledger/balances`, `transactions/conversions`, `transactions/transfers`

## Contexto y problema

PFOS debe registrar ingresos, gastos, transferencias, conversiones fiat↔cripto (USDT↔BOB↔USD es el caso diario del owner), tarjetas de crédito, préstamos, refunds y ajustes, y responder siempre con exactitud: *¿cuánto tengo, en qué moneda, y cómo llegué aquí?*. Los requisitos clave:

- Saldos **exactos y auditables** a cualquier fecha.
- Historial **inmutable**: las correcciones no deben borrar evidencia.
- Multi-moneda real, incluyendo activos de 18 decimales (ETH).
- El usuario no debe ver jerga contable (debe/haber); la UX es "transacciones con categorías".
- Recategorizar o etiquetar debe ser barato y no reescribir historia financiera.

Necesitamos decidir el modelo de registro de movimientos.

## Drivers de decisión

- Integridad: imposibilidad de "crear o destruir dinero" por bug.
- Auditabilidad e inmutabilidad.
- Multi-moneda correcto (sin convertir todo a moneda base al registrar).
- Simplicidad de UX (contabilidad invisible).
- Rendimiento de saldos y reportes con volúmenes personales (10⁴–10⁶ postings).
- Evolución: préstamos, inversiones, reconciliación, cierre de periodos.

## Opciones consideradas

1. **Single-entry**: tabla `transactions` con `account_id`, `amount` firmado; saldo = Σ amount por cuenta.
2. **Doble entrada completa** al estilo contable (plan de cuentas jerárquico, categorías = cuentas de ingreso/gasto, multi-moneda con revaluación).
3. **Doble entrada simplificada multi-moneda append-only**, con clasificación fuera del ledger (elegida).
4. **Event sourcing puro** de cuentas (saldos como proyección de eventos de dominio, sin ledger explícito).

## Decisión

Se adopta la opción 3, tal como la define ARCHITECTURE §4:

- `LedgerAccount` tipo `ASSET | LIABILITY | EQUITY | INCOME | EXPENSE`, **una sola moneda** por ledger account.
- Cada `Account` del usuario ↔ exactamente un `LedgerAccount` ASSET o LIABILITY.
- Cuentas de sistema por workspace y moneda, creadas bajo demanda: `INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:OPENING_BALANCE:<CCY>`, `EQUITY:FX_TRADING:<CCY>`, `EQUITY:ADJUSTMENTS:<CCY>`.
- `JournalEntry` con `Posting[]`; **débito positivo, crédito negativo**.
- **Invariante**: por entry y **por moneda**, `Σ posting.amount = 0`. Validada en dominio y reforzada en BD con **constraint trigger diferido** (`DEFERRABLE INITIALLY DEFERRED`), evaluado al `COMMIT`.
- **Append-only**: nunca UPDATE/DELETE de postings ni entries. Corrección = entry de reversa + entry nueva, enlazadas por `reverses_entry_id`. `void` = reversa.
- **Clasificación fuera del ledger**: categorías, tags y custom fields en `TransactionSplit`; cada posting nominal (INCOME/EXPENSE) referencia `split_id`. Recategorizar no toca el ledger.
- Solo transacciones `posted | cleared | reconciled` generan JournalEntry; `pending` solo afecta proyecciones.
- Periodos `closed` rechazan entries con `entry_date` en ese periodo (`PERIOD_CLOSED`); corrección = reapertura auditada o ajuste en periodo abierto.
- Saldo = Σ postings; `AccountBalanceSnapshot` es derivado y reconstruible.
- **Conversiones**: una sola entry con patas en cada moneda balanceadas vía `EQUITY:FX_TRADING:<CCY>`; fees como postings a `EXPENSE:<CCY>` (categoría *Fees*); `ConversionDetail` inmutable con rate cotizada, efectiva, spread, fees, provider y timestamp. Jamás se recalcula historia con tasas actuales.
- Refund = crédito a `EXPENSE:<CCY>` con la misma categoría. Tarjeta = LIABILITY. Préstamo = desembolso (+ASSET/−LIABILITY), cuota dividida en principal/interés/fees/seguro/impuestos.
- Activos no monetarios = "commodities" en `currency` (`kind = FIAT | CRYPTO | COMMODITY | CUSTOM`); valoración y ganancias no realizadas son asunto de Reporting, no entries.

Ejemplo canónico USDT→BOB (ARCHITECTURE §4.2):

```
USDT Wallet            -100.000000 USDT
FX_TRADING:USDT        +100.000000 USDT
FX_TRADING:BOB         -690.00 BOB
Bank BOB               +685.00 BOB
EXPENSE:BOB (Fees)       +5.00 BOB
```
Σ USDT = 0; Σ BOB = 0.

## Análisis de opciones

### 1. Single-entry
- **Pros:** trivial de implementar y de entender; una fila por movimiento.
- **Contras:** una transferencia son dos filas sin vínculo invariante → dinero creado/destruido por bugs; conversiones multi-moneda sin representación coherente; no hay "contrapartida" para auditar; préstamos y tarjetas como casos especiales.
- **Costo:** bajo. **Complejidad operativa:** baja; **riesgo de integridad:** alto.

### 2. Doble entrada contable completa
- **Pros:** estándar contable; reportes contables (balance, P&L) nativos.
- **Contras:** categorías como cuentas → recategorizar = reescribir postings (rompe inmutabilidad o exige reversas masivas); plan de cuentas jerárquico expuesto; revaluación cambiaria periódica (entries automáticos) añade complejidad sin valor para finanzas personales.
- **Costo:** medio-alto. **Complejidad operativa:** media; complejidad de dominio alta.

### 3. Doble entrada simplificada multi-moneda (elegida)
- **Pros:** invariante de balance por moneda verificable en dominio y BD; conversiones con trazabilidad completa (FX_TRADING); inmutabilidad; recategorización barata; contabilidad invisible al usuario; reconstrucción de saldos a cualquier fecha.
- **Contras:** más filas (≥ 2 postings por movimiento; conversiones 4–5); FX_TRADING acumula saldos que requieren explicación en reportes ("resultado cambiario"); reversas en lugar de edición → la UI debe ocultarlo.
- **Costo:** medio (diseño inicial cuidadoso). **Complejidad operativa:** baja (todo en PG).

### 4. Event sourcing puro
- **Pros:** historia completa, temporal queries naturales.
- **Contras:** sin invariante contable explícita; proyecciones complejas; snapshots, upcasting de eventos; overkill para 1 persona; la auditoría financiera sigue necesitando un modelo de postings.
- **Costo:** alto. **Complejidad operativa:** alta.

## Consecuencias

**Positivas**
- Net worth por moneda siempre consistente; "dinero perdido" detectable con una query (Σ global por moneda = 0).
- Corrección y auditoría naturales (reversas enlazadas + AuditLog en la misma transacción, ARCHITECTURE §7).
- Base sólida para reconciliación, cierre mensual, préstamos y conversiones P2P.

**Negativas**
- Volumen de filas mayor; necesidad de índices `(ledger_account_id, entry_date)` y snapshots.
- Editar una transacción posted genera 2 entries nuevas; la UI y la API deben presentar "la versión vigente".
- `FX_TRADING` requiere un reporte específico para que el usuario entienda spreads y pérdidas por conversión.

**Riesgos**
- Constraint trigger diferido con impacto en rendimiento en imports masivos. *Mitigación:* benchmark en SPIKE-02 con 10⁵ entries; agrupación por lote.
- Inconsistencia entre `TransactionSplit` y postings nominales. *Mitigación:* invariante INV en `docs/09-ledger-design.md` (Σ splits = Σ postings nominales por moneda) + property-based tests.

## Validación

- Property-based tests (fast-check, ADR-0016): para toda secuencia generada de comandos (transacciones, transferencias, conversiones, reversas), Σ postings por moneda por entry = 0 y net worth se preserva en transferencias (`TC-LEDGER-TRANSFER-001`).
- Test de integración: INSERT directo de una entry desbalanceada → el `COMMIT` falla con el constraint trigger.
- Test de integración: `UPDATE`/`DELETE` sobre `ledger.posting` denegado por permisos del rol de app y/o trigger.
- Reconstrucción: borrar snapshots y recalcular produce saldos idénticos (job de verificación periódico).

## Notas

- Catálogo de invariantes `INV-NNN` en `docs/09-ledger-design.md`.
- El tratamiento de revaluación de saldos en moneda extranjera queda explícitamente fuera del ledger (Reporting calcula valoración a tasa de referencia en vistas), por decisión de simplicidad.
