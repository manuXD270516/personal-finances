# ADR-0006: Representación de dinero — decimal.js en dominio + NUMERIC(38,18) en BD + string en API

- Estado: Aceptado (2026-10-02, tras SPIKE-03; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §4.6, §4.7, §8; docs/09-ledger-design.md; ADR-0004, ADR-0005, ADR-0007, ADR-0016, ADR-0022; SPIKE-03

## Contexto y problema

PFOS maneja monedas con escalas muy distintas: BOB/USD (2), JPY (0), USDT (6), BTC (8), ETH (18), además de commodities y monedas custom. Debe calcular cuotas de préstamos, prorrateos de splits, conversiones con tasas de muchos decimales y sumas de miles de postings **sin errores de redondeo** que rompan la invariante `Σ = 0` (ADR-0004).

JavaScript `number` es IEEE-754 double: `0.1 + 0.2 !== 0.3`, y solo representa enteros exactos hasta 2⁵³. Hay que decidir: (1) tipo en dominio TypeScript, (2) tipo de almacenamiento en PostgreSQL, (3) formato en la API, (4) política de redondeo y reparto.

## Drivers de decisión

- Exactitud absoluta en sumas y comparación con cero.
- Soporte de escala 18 (wei) y cantidades grandes.
- Redondeo explícito y determinista (HALF_EVEN, largest remainder).
- Round-trip sin pérdida: BD ↔ dominio ↔ JSON.
- Ergonomía y rendimiento aceptables en TS.
- Madurez y mantenimiento de la librería.

## Opciones consideradas

**Dominio (TS):**
1. `number` (float) — descartado de entrada, se documenta por completitud.
2. **decimal.js** (elegida).
3. big.js.
4. dinero.js (v2).
5. `bigint` en unidades menores (minor units) + escala por moneda.

**Almacenamiento (PG):**
A. **`NUMERIC(38,18)`** (elegida).
B. `BIGINT` en unidades menores.
C. `NUMERIC` sin precisión declarada.
D. `TEXT`.

**API:** string decimal (elegida) vs number JSON vs `{units, scale}`.

## Decisión

- **Value Object `Money`** en `@pf/shared-kernel`: `amount: Decimal` (decimal.js, instancia configurada con **precisión interna 40 dígitos significativos**) + `currency: CurrencyCode`. Inmutable. Operaciones aritméticas solo entre misma moneda (error de dominio si no). Conversiones explícitas mediante `Rate` (VO con par de monedas).
- **Prohibido `number`/float para dinero y tasas**: regla de lint (patrón de tipos/nombres) + architecture test que detecta `Money`/`amount` tipados como `number` en `contracts` y DTOs.
- **Redondeo HALF_EVEN** a `currency.scale` solo en **puntos de materialización**: creación de posting, cuota de préstamo, asignación de presupuesto, prorrateo. Cálculos intermedios a precisión completa.
- **Reparto** (splits, cuotas, prorrateos) con **largest remainder determinista** (desempate por índice estable) garantizando Σ partes = total exacto.
- **Persistencia:** `NUMERIC(38,18)` para montos y para tasas; la escala válida por moneda (`currency.scale`) se valida en dominio (un monto BOB con 3 decimales es inválido).
- **API:** montos como **string decimal** `{"amount":"685.00","currency":"BOB"}`; el string se emite con exactamente `currency.scale` decimales. Tasas como string con precisión significativa.
- Driver de PG configurado para devolver `NUMERIC` como **string** (nunca parsear a `number`) y mapear a `Decimal` en el adapter.

## Análisis de opciones

### Dominio

| Opción | Pros | Contras | Costo | Complejidad |
|---|---|---|---|---|
| `number` | Nativo, rápido | Inexacto; enteros seguros solo hasta 2⁵³; inaceptable | 0 | Baja, riesgo crítico |
| **decimal.js** | Precisión configurable, exponentes, todos los modos de redondeo (incl. ROUND_HALF_EVEN), `toFixed`/`toDecimalPlaces`, funciones (pow, ln) útiles para amortización/interés compuesto; muy usado y estable | Objetos inmutables → asignaciones; ~32 KB min; más lento que bigint | 0 | Baja |
| big.js | Pequeño (~6 KB), exacto | Sin `pow` con exponente fraccionario ni `ln`/`exp` (necesarios para tasas efectivas anuales/TEA↔TEM); menos modos de redondeo configurables por operación | 0 | Baja |
| dinero.js v2 | Modelo Money explícito, monedas con escala, allocation incluida | Versión 2 estuvo años en alpha; API centrada en minor units con `number` por defecto (calculadora bigint opcional); tasas de conversión y amortización requieren otra librería; acopla el shared-kernel a su modelo | 0 | Media |
| bigint minor units | Rápido, exacto, nativo | Escala fija por moneda → divisiones y tasas (cuotas, conversiones con 10+ decimales) requieren aritmética de punto fijo propia; reimplementar redondeo; error-prone | 0 | Alta (código propio) |

### Almacenamiento

- **`NUMERIC(38,18)` (elegida):** exacto; 20 dígitos enteros + 18 decimales cubre 10²⁰ unidades de cualquier moneda y wei completo; un solo tipo para todas las monedas; sumas exactas en SQL (reporting). *Contras:* más lento y más bytes que BIGINT (irrelevante a escala personal); escala por moneda validada en app, no en columna.
- **`BIGINT` minor units:** rápido y compacto, pero máximo 2⁶³−1 ≈ 9.22×10¹⁸ unidades menores. Para ETH (18 decimales, wei) eso es **≈ 9.22 ETH** como máximo representable por fila — y las sumas agregadas desbordan antes. Inviable para cripto de 18 decimales. Además la escala sería implícita por moneda (riesgo de interpretar mal unidades).
- **`NUMERIC` sin precisión:** exacto y flexible, pero permite escalas arbitrarias sin límite, peor documentación del contrato y riesgo de valores absurdos; 38,18 da un límite explícito.
- **`TEXT`:** sin aritmética en SQL; descartado.

### API
- **String decimal (elegida):** sin pérdida en cualquier cliente JSON; convención de Stripe-like/estándar en fintech para decimales arbitrarios. *Contra:* clientes deben parsear.
- `number` JSON: los parsers JS lo convierten a double → pérdida. Descartado.
- `{units, scale}`: exacto pero verboso y propenso a errores de interpretación en el cliente.

## Consecuencias

**Positivas**
- Exactitud end-to-end; la invariante del ledger se puede comprobar con `Decimal.isZero()`.
- Una sola representación para fiat, cripto y commodities.
- Reporting en SQL suma `NUMERIC` sin pérdida.

**Negativas**
- Coste de mapeo explícito en cada adapter (NUMERIC string ↔ Decimal ↔ string API).
- El frontend necesita también una librería decimal para cálculos en formularios (preview de splits/conversiones); se usará la misma decimal.js en `@pf/shared-kernel` compartible.

**Riesgos**
- Un desarrollador/agente usa `Number(amount)` en algún punto. *Mitigación:* lint + architecture test + property tests que fallan con floats; revisión de DTOs OpenAPI (`type: string, format: decimal`).
- Overflow de `NUMERIC(38,18)` con monedas custom de valores extremos. *Mitigación:* validación de rango en dominio; error `AMOUNT_OUT_OF_RANGE`.

## Validación

- **SPIKE-03:** decimal.js + HALF_EVEN + largest remainder con fast-check: (a) Σ partes = total para cualquier total/pesos; (b) round-trip `NUMERIC ↔ string ↔ Decimal` idempotente para 10⁵ valores aleatorios incluyendo escala 18 y magnitudes 10¹⁹; (c) reparto determinista (misma entrada → misma salida).
- Test de contrato OpenAPI: todos los campos `amount`/`rate` son `type: string` con `pattern` decimal.
- Test de integración: driver PG devuelve `NUMERIC` como string (configuración de type parser verificada).

## Notas

- Límite BIGINT verificado aritméticamente: 2⁶³−1 = 9 223 372 036 854 775 807 wei ≈ 9.22 ETH.
- Precisión interna de 40 dígitos: suficiente para multiplicar un monto de 38 dígitos por una tasa y redondear después sin perder dígitos significativos relevantes; validar en SPIKE-03 casos de interés compuesto a 360 periodos.
- Estado/versión actual de decimal.js, big.js y dinero.js v2: a verificar en SPIKE-03 (no verificado por web en esta redacción).

## Resultado del spike (SPIKE-03, 2026-10-01)

Evidencia completa en [spikes/SPIKE-03-money/README.md](../../spikes/SPIKE-03-money/README.md). Estado del ADR: sigue **Propuesto** (lo acepta el owner).

- **Versiones verificadas** (`npm view`): decimal.js 10.6.0, big.js 7.0.1, dinero.js 2.0.2 (v2 estable desde 2026-03-02), fast-check 4.10.2, vitest 5.0.3. TypeScript 6.0.3 (typescript-eslint 8.71.0 no soporta TS 7.0.2).
- **Prototipo `Money`** (decimal.js, clon aislado `defaults: true`, precisión 40, ROUND_HALF_EVEN) + `Rate` + `ConversionCalculator`: **39/39 tests en verde** (1 000 runs por propiedad; 10 000 en modo nightly; round-trip con 10⁵ valores incl. escala 18 y 20 dígitos enteros). Cubre TC-LEDGER-MONEY-001, 003–008, SCALE-001 y la parte string↔Decimal↔NUMERIC-texto de TC-002 (la parte PG queda para integración).
- **Validado**: Σ allocate = total, |parte − exacta| < 1 unidad, determinismo, simetría de signo (INV-020/021); suma exacta/conmutativa/asociativa, negate involutivo (INV-001/008); `CURRENCY_MISMATCH` (INV-002); `MONEY_SCALE_EXCEEDED` (INV-003); asientos de conversión aleatorios cuadran por moneda y reconcilian (INV-004/010); HALF_EVEN sin sesgo (error acumulado 0 vs +50 de HALF_UP sobre 10⁵ valores); `Decimal.set()` global no afecta al clon; interés compuesto a 360 periodos idéntico a precisión 40 y 100 tras redondear. Ejemplos numéricos de docs/09 §6.12–6.15 y §12 verificados correctos.
- **Benchmark** (100k ops, Node 22): Money 57 ms sumas / 620 ms allocate; big.js 22 / 797 (allocate manual); dinero.js 2 number 71 / 235; dinero.js bigint 85 / 325. Coste irrelevante a escala personal. dinero.js descartado: `number` por defecto pierde precisión en escala 18 sin error y su `allocate` reparte el residuo por índice (99.99 en 50/30/20 → 50.00/30.00/19.99 ≠ docs/09).
- **Ajustes propuestos a esta decisión**:
  1. Materializaciones (`multiply`, `divide`, porcentaje, conversión) con **cuantización racional exacta (bigint)**: "precisión 40 y luego redondear" puede sufrir doble redondeo con montos de 20 dígitos × tasas largas (contraejemplo reproducido en el spike). La precisión 40 se mantiene para intermedios.
  2. `Money` valida la escala **por valor** (acepta `"685.000000000000000000"` de NUMERIC(38,18)), rango `< 10²⁰` (`AMOUNT_OUT_OF_RANGE`) y normaliza `-0`.
  3. Exportar sólo el clon `MoneyDecimal`; re-envolver todo `Decimal` entrante (las instancias de clones distintos pasan `instanceof` y arrastran su configuración).
  4. Lint: regla tipada `pf/no-number-money` (typescript-eslint, resuelve alias, prohíbe `.toNumber()`) + `no-restricted-syntax` sin tipos; factibilidad demostrada con fixtures (10 detecciones, 0 falsos positivos).
- **Inconsistencias detectadas en docs (no editadas, para el owner)**: `AMOUNT_SCALE_EXCEEDED` (docs/09 §12) vs `MONEY_SCALE_EXCEEDED` (TC-LEDGER-SCALE-001); docs/09 §6.14 omite `× 100` en la fórmula del spread; INV-032 debería usar cota **relativa** (`< 10⁻³⁸`), la absoluta `10⁻³⁰` falla con tasas ~10¹⁵; regla 3 de §12 debería decir "truncar hacia cero" (necesario para TC-005 con totales negativos).
- **Recomendación**: aceptar con los ajustes anteriores. El prototipo (`Money`, `Rate`, `rounding`) es promovible a `packages/shared-kernel`; `computeConversion` va a Transactions.
