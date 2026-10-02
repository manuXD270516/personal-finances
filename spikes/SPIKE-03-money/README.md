# SPIKE-03 — Money y redondeo (ADR-0006)

> Código de evidencia. No se importa desde `apps/`, `packages/` ni `services/`. El prototipo `src/` está escrito para poder **promoverse** a `packages/shared-kernel` (ver §8).
> Fecha: 2026-10-01 · Windows 11 · Node v22.23.1 · pnpm 12.4.2 · sin contenedores.

## 1. Pregunta

¿`decimal.js` (clon aislado, precisión 40, HALF_EVEN) + un value object `Money` propio cumple las reglas de docs/09 §7 y §12 y los TC `TC-LEDGER-MONEY-001..008` / `TC-LEDGER-SCALE-001` (INV-001..004, 008, 010, 020, 021, 032), con ergonomía y rendimiento aceptables frente a big.js y dinero.js v2? ¿Es factible un lint que prohíba `number` para dinero?

## 2. Versiones verificadas (`npm view`, 2026-10-01)

| Paquete | Versión | Notas |
|---|---|---|
| decimal.js | **10.6.0** (2025-07-06) | elegida |
| big.js | 7.0.1 (+ @types/big.js 7.0.0) | comparación |
| dinero.js | **2.0.2** (2026-03-13) | v2 ya es estable (2.0.0 publicada 2026-03-02); incluye `dinero.js/currencies` y `dinero.js/bigint` |
| fast-check | 4.10.2 | |
| vitest | 5.0.3 | |
| typescript | **6.0.3** (no 7.0.2) | `latest` es 7.0.2 (port nativo) pero typescript-eslint 8.71.0 declara `typescript >=4.8.4 <6.1.0` |
| eslint / typescript-eslint | 10.11.0 / 8.71.0 | |

## 3. Setup y comandos

```powershell
cd spikes/SPIKE-03-money
pnpm install          # pnpm-workspace.yaml local: allowBuilds esbuild=false (no hace falta su postinstall)
pnpm typecheck        # tsc --noEmit (verifica también los @ts-expect-error de TC-001)
pnpm lint             # eslint src (capas A y B del lint de dinero)
pnpm test             # vitest: 1 000 runs por propiedad; round-trip con 100 000
$env:NIGHTLY=1; pnpm test   # 10 000 runs por propiedad (numRuns_nightly de los TC)
pnpm bench            # micro-benchmark 100k sumas / 100k allocate
```

Estructura:

| Ruta | Contenido |
|---|---|
| `src/decimal.ts` | `MoneyDecimal = Decimal.clone({ defaults: true, precision: 40, rounding: ROUND_HALF_EVEN, toExpNeg/Pos ±9e15 })` + `dec()` (re-envoltura exacta) |
| `src/rounding.ts` | Cuantización **racional exacta con bigint** (`roundQuotient`, `mulToScale`, `divToScale`, `mulDivToScale`, `roundDecimal`); modos HALF_EVEN, HALF_UP, DOWN, UP, FLOOR, CEIL |
| `src/money.ts` | VO `Money` inmutable: `of/parse` (string canónico), `zero`, `ofMinorUnits`, `roundToScale`, `sum`, `add/subtract/negate/abs`, `multiply/divide/percentage(…, mode)`, `allocate(weights \| n)`, `compare/equals`, `toString/toJSON/toNumeric/toMinorUnits/toDecimal` |
| `src/rate.ts` | `Rate {base, quote, value}`; `inverse()` a precisión 40 enlazada al original; `convert()` siempre usa la tasa original en su orientación; `toPersisted()` 18 dp HALF_EVEN |
| `src/conversion.ts` | `effectiveRate`, `spread`, `computeConversion` (prototipo del ConversionCalculator: convertedSource, grossTarget, efectiva, spread, chequeo §7.2 y legs balanceados vía `FX_TRADING`) |
| `src/errors.ts` | `MoneyError.code`: `MONEY_INVALID_AMOUNT`, `MONEY_SCALE_EXCEEDED`, `AMOUNT_OUT_OF_RANGE`, `CURRENCY_MISMATCH`, `INVALID_CURRENCY`, `INVALID_ALLOCATION`, `INVALID_RATE` |
| `test/*.test.ts` | ejemplos `[TC-LEDGER-MONEY-00N]`, propiedades fast-check, bordes, aislamiento, conversiones, lint |
| `lint/no-number-money.js`, `eslint.config.js`, `lint/fixtures/` | borrador de la regla `pf/no-number-money` |
| `bench/bench.ts` | benchmark |

## 4. Decisiones de diseño del prototipo

1. **Money siempre materializado**: `amount` tiene ≤ `currency.scale` decimales, nunca `-0`, `|amount| < 10^20` (NUMERIC(38,18)). Los cálculos intermedios sin redondear se hacen con `Decimal` (`toDecimal()`), y vuelven a Money sólo vía `roundToScale` (punto de materialización).
2. **Parse estricto** `^-?(0|[1-9]\d*)(\.\d+)?$`: rechaza `number` (en tipos y en runtime), `NaN`, `1e3`, espacios, `1,00`, `Infinity`, `+1`, `.5`, `1.`, `01.00`. La escala se valida **por valor** (`decimalPlaces()`), así `"685.000000000000000000"` (lo que devuelve PG para NUMERIC(38,18)) se acepta como 685.00 BOB, pero `"10.125"` BOB → `MONEY_SCALE_EXCEEDED`.
3. **Una sola cuantización, exacta**: `multiply/divide/percentage` y `Rate.convert` calculan `a×b/c` como racional con bigint y redondean una vez. Evita el *doble redondeo* que produce "multiplicar a precisión 40 y luego redondear" (ver §6, hallazgo H3).
4. **Modo de redondeo explícito** en `multiply/divide/percentage` (parámetro obligatorio); `roundToScale` usa HALF_EVEN por defecto (canónico).
5. **allocate**: largest remainder en bigint sobre unidades menores, truncado **hacia cero** y simétrico en signo (`allocate(-x) = -allocate(x)`), desempate por índice menor; pesos como string decimal, bigint o entero seguro (`number` sólo para enteros; `0.5` → `INVALID_ALLOCATION`).
6. **Igualdad de moneda** = mismo `code` y misma `scale`.

## 5. Resultados

### 5.1 Tests (`pnpm test`, salida verbose resumida)

```
✓ Aislamiento del clon de decimal.js > MoneyDecimal usa precisión 40 y ROUND_HALF_EVEN
✓ Aislamiento del clon de decimal.js > un Decimal.set() global posterior no afecta a Money
✓ Aislamiento del clon de decimal.js > un Decimal.set() global ANTERIOR a cargar el módulo tampoco lo afecta (defaults: true)
✓ Aislamiento del clon de decimal.js > riesgo: instancias de otro clon pasan instanceof y llevan su config; Money las re-envuelve
✓ Valores límite > ETH escala 18: wei, montos grandes y reparto exacto
✓ Valores límite > JPY escala 0
✓ Valores límite > 20 dígitos enteros (límite NUMERIC(38,18)) y AMOUNT_OUT_OF_RANGE
✓ Valores límite > cero negativo se normaliza a 0
✓ Valores límite > doble redondeo: precisión 40 + cuantización puede fallar; la cuantización racional exacta no
✓ Valores límite > interés compuesto a 360 periodos: precisión 40 = precisión 100 tras redondear (nota ADR-0006)
✓ [TC-LEDGER-MONEY-001] Money no se crea desde number; strings decimales válidos son exactos
✓ [TC-LEDGER-MONEY-002] 0.1 + 0.2 = 0.3 exacto; round-trip string/NUMERIC; API serializa a escala
✓ [TC-LEDGER-MONEY-003] roundToScale usa HALF_EVEN
✓ [TC-LEDGER-MONEY-003] ejemplos de redondeo de docs/09 §12
✓ [TC-LEDGER-MONEY-005] largest remainder determinista con desempate por índice
✓ [TC-LEDGER-MONEY-007] aritmética/comparación entre monedas distintas -> CURRENCY_MISMATCH
✓ [TC-LEDGER-SCALE-001] más decimales que la escala -> MONEY_SCALE_EXCEEDED (sin redondeo silencioso)
✓ multiply/percentage/divide exigen modo de redondeo y cuantizan una sola vez
✓ §6.12 USD -> BOB con fee bancario: tasa efectiva 6.91
✓ §6.13 BOB -> USDT (compra P2P), fee en destino: efectiva 7.007007007007007007 BOB/USDT
✓ §6.14 USDT -> BOB canónico: efectiva 6.85, spread 0.719424460431654676 % = 5.00 BOB
✓ §6.14 spread con la referencia en orientación inversa (BOB/USDT) da el mismo resultado
✓ §6.15 USDT -> BTC con fee de red en TRX (tercera moneda): Σ por moneda = 0
✓ §7.2 tasa cotizada inconsistente con los montos (> 1 unidad mínima) se marca
✓ [INV-032] inversa: 1/6.96 -> 0.143678160919540230; inverse().inverse() devuelve la original
✓ [INV-032] hallazgo: la cota absoluta 10^-30 no vale para tasas grandes; la relativa sí
✓ [INV-032] usar la inversa redondeada (18 dp) sí puede dar otro monto; la convertida vía Rate no
✓ Conversiones — propiedades > [INV-032] |1/(1/r) − r| < 10^-30 a precisión 40 y convertir por la inversa = dividir por la original
✓ Conversiones — propiedades > [INV-004][INV-010] conversión aleatoria: montos reconcilian y el asiento cuadra por moneda
✓ Lint: prohibido number para dinero (factibilidad TC-PLATFORM-ARCH-002) > reporta los number monetarios del fixture malo y nada en el bueno
✓ Money — propiedades > [TC-LEDGER-MONEY-002] round-trip parse/format (10^5 valores, INV-001)
✓ Money — propiedades > [TC-LEDGER-MONEY-004] redondeo determinista, idempotente, simétrico y acotado
✓ Money — propiedades > [TC-LEDGER-MONEY-004] HALF_EVEN no tiene sesgo (HALF_UP sí)
✓ Money — propiedades > [TC-LEDGER-MONEY-006] allocate: Σ partes = total, error < 1 unidad, determinista, peso 0 -> 0
✓ Money — propiedades > [TC-LEDGER-MONEY-006] allocate(n): partes difieren a lo sumo en 1 unidad menor (INV-021)
✓ Money — propiedades > [TC-LEDGER-MONEY-007] monedas distintas: add/subtract/compare lanzan, equals es false
✓ Money — propiedades > [TC-LEDGER-MONEY-008] suma exacta, conmutativa, asociativa, neutro e inversa
✓ Money — propiedades > [TC-LEDGER-MONEY-008] negate es involución y una reversa suma cero (INV-008)
✓ Money — propiedades > multiply exacto coincide con aritmética bigint racional
Test Files  6 passed (6)
Tests  39 passed (39)
Duration  6.99s
```

`NIGHTLY=1` (10 000 runs por propiedad): **39/39 en verde, 30 s**. `pnpm typecheck` y `pnpm lint` sin errores.

Cobertura de TC: 001, 003, 004, 005, 006, 007, 008 y SCALE-001 completos a nivel unidad/propiedad. **TC-LEDGER-MONEY-002** cubierto en su parte string ↔ Decimal ↔ NUMERIC-texto (`toNumeric()` → `parse`); la parte PostgreSQL/Testcontainers + type parser de `pg` pertenece a SPIKE-02 / tests de integración.

Detalles medidos:
- **HALF_EVEN sin sesgo**: sobre los 100 000 valores de 3 decimales en [0, 100) el error acumulado de HALF_EVEN es exactamente **0**; HALF_UP acumula **+50** (10 000 empates × 0.005). Sobre 20 000 empates aleatorios, |error medio| HALF_EVEN < 0.0002 (HALF_UP: 0.005).
- **Aislamiento**: `Decimal.set({precision: 5, rounding: ROUND_UP})` global antes o después de cargar el módulo no altera `Money`; un `Decimal.clone()` *sin* `defaults: true` sí hereda la config global (de ahí el flag).
- **ETH**: 12345678901234567890.123456789012345678 ETH = 1.23×10³⁷ wei ≫ 2⁶³−1 (confirma la nota del ADR: BIGINT sólo llega a ≈ 9.22 ETH).
- **Interés compuesto 360 periodos**: cuota francesa calculada a precisión 40 vs 100 difiere < 10⁻²⁰ y redondea igual (incluye principal 99 999 999 999 999.99). Cronograma de docs/09 §12 (340.02 / 340.02 / 340.03) reproducido.

### 5.2 Benchmark (`pnpm bench`, Node 22, mediana de 7 corridas, entradas pre-parseadas)

| Librería | 100k sumas (ms) | 100k allocate [50,30,20] (ms) |
|---|---:|---:|
| Money (decimal.js clone) | 57.3 | 619.5 |
| decimal.js raw | 20.4 | n/a |
| big.js 7 | 21.9 | 796.5 (largest remainder escrito a mano) |
| dinero.js 2 (number) | 71.4 | 235.4 |
| dinero.js 2 (bigint) | 84.6 | 324.5 |
| bigint minor units (baseline) | 1.5 | 5.4 (sin reparto de residuo) |

Las 4 sumas coinciden (468681138078.72). Money cuesta ~0.6 µs por suma y ~6 µs por allocate: irrelevante a escala de finanzas personales (un import de 10 000 filas < 0.1 s). Sobrecoste vs decimal.js crudo: validación de rango + re-envoltura + `Object.freeze` por instancia.

Semántica observada:

```
99.99 BOB en [50,30,20]:  Money 49.99/30.00/20.00 · big.js (manual) idem · dinero 50.00/30.00/19.99
100.00 BOB en [1,1,1]:    Money y dinero 33.34/33.33/33.33 · -100.00 → ambos -33.34/-33.33/-33.33
ETH 12345678901234567890.123456789012345678:
  dinero number : 12345678901234567000.491324606797053950   ← pérdida silenciosa
  dinero bigint : 12345678901234567890.123456789012345678
  Money         : 12345678901234567890.123456789012345678
```

### 5.3 Ergonomía (nota breve)

- **Money/decimal.js**: API de métodos encadenables (`a.add(b).allocate([50,30,20])`), strings en los bordes, `pow`/`ln`/`exp` disponibles para TEA↔TEM y amortización. El modo de redondeo explícito obliga a pensar en cada materialización.
- **big.js**: igual de compacto para sumas, pero sin allocate, sin `pow` fraccionario ni `ln`, y config global por constructor (mismo problema de aislamiento → `Big()` factory).
- **dinero.js 2**: modelo Money maduro y funcional (`add(d1, d2)`), monedas con `exponent`, `allocate` y `convert` incluidos. Pero: (a) por defecto `number` → pierde precisión con escala 18 sin error; (b) su `allocate` reparte el residuo **en orden de índice**, no por mayor resto (difiere de docs/09 §12: 50.00/30.00/19.99 vs 49.99/30.00/20.00); (c) tasas como `{amount, scale}` enteros, sin funciones transcendentales; (d) acopla el shared-kernel a su modelo. Útil como referencia de API, no como base.

### 5.4 Lint `number` para dinero (factibilidad TC-PLATFORM-ARCH-002)

Evaluadas dos capas (ambas activas en `eslint.config.js`, verificadas en `test/lint.test.ts`):

- **Capa A — `no-restricted-syntax` sin tipos** (cero código propio): selectores `TSPropertySignature[key.name=/…Amount|Balance|Price|Fee|Total|Rate…/] TSNumberKeyword`, ídem `PropertyDefinition`, y `parseFloat`. Detecta 4/7 casos del fixture; **no** ve alias (`type Amount = number`), parámetros ni `.toNumber()`.
- **Capa B — regla tipada `pf/no-number-money`** (`lint/no-number-money.js`, ~70 líneas con `@typescript-eslint/utils` + `projectService`): resuelve el tipo real (incluye alias y uniones `number | string`), revisa propiedades, campos de clase y parámetros, y prohíbe `.toNumber()` sobre `Decimal`/`Big`/`Money`. Detecta 6/6 casos tipados; 0 falsos positivos en `lint/fixtures/good.ts` (p. ej. `lineCount: number`, `parts: number`).

Salida real sobre el fixture:

```
bad.ts  7:3   "amount" looks like money/rate but its type includes number…      pf/no-number-money
        7:11  Money/rate fields must not be typed as number (ADR-0006)         no-restricted-syntax
        8:3   "feeAmount" … pf/no-number-money · 8:14 no-restricted-syntax
        9:3   "balance" (alias Amount = number) … pf/no-number-money
       14:3   "totalAmount" … pf/no-number-money · 14:16 no-restricted-syntax
       18:26  "price" (parámetro) … pf/no-number-money
       24:10  Do not convert a decimal to number (ADR-0006, INV-001)           pf/no-number-money
       27:23  parseFloat is forbidden in money code (INV-001)                  no-restricted-syntax
✖ 10 problems
```

Conclusión: **factible**; recomendado capa B en `packages/eslint-config` (coste: lint tipado ≈ 3 s en este proyecto pequeño) + capa A como red barata. Limitación: se basa en nombres; complementar con el architecture test sobre DTOs/OpenAPI (`type: string`) previsto en el ADR.

## 6. Hallazgos

- **H1 — Código de error inconsistente**: docs/09 §12 regla 6 dice `AMOUNT_SCALE_EXCEEDED`; TC-LEDGER-SCALE-001 y este prototipo usan `MONEY_SCALE_EXCEEDED`. Unificar (propuesta: `MONEY_SCALE_EXCEEDED`, prefijo coherente con `MONEY_INVALID_AMOUNT`).
- **H2 — docs/09 §6.14, notación del spread**: el texto escribe `(6.95 − 6.90)/6.95 = 0.719424460431654676 %`; falta `× 100` (la fracción es 0.00719…; §7.1 sí lo escribe bien). El valor numérico es correcto.
- **H3 — Doble redondeo con precisión 40**: "multiplicar a precisión 40 y luego cuantizar" (§7.1 "Conversión de monto", nota del ADR) **no es exacto** cuando el producto tiene > 40 dígitos significativos (monto de 20 dígitos enteros × tasa larga): el resultado intermedio puede colapsar a un empate exacto y HALF_EVEN redondea al lado equivocado (test `doble redondeo`: 10000000000000000001 BOB × 0.0050000000000000000000000000000000000000001 → ingenuo `…0.00`, correcto `…0.01`). Mitigación implementada: cuantización racional exacta con bigint en `multiply/divide/percentage/convert`. Precisión 40 sigue siendo válida para intermedios (tasas, interés compuesto).
- **H4 — INV-032 cota absoluta**: `|1/(1/r) − r| < 10⁻³⁰` a precisión 40 falla para tasas grandes (r = 975982122997428.91… → error 5×10⁻²⁵). Debe formularse **relativa**: `|1/(1/r) − r| / r < 10⁻³⁸`. El prototipo además evita el problema: `inverse().inverse()` devuelve la instancia original y `convert` siempre divide por la tasa original.
- **H5 — Largest remainder con negativos**: docs/09 §12 regla 3 dice "se trunca cada parte"; para que `-100.00 / 3 = -33.34, -33.33, -33.33` (TC-005) el truncado debe ser **hacia cero** y el algoritmo simétrico en signo (con `floor` saldría distinto). Conviene explicitarlo.
- **H6 — Inversa redondeada**: con 99 999 999 999 999 999 999.99 BOB, `× 0.143678160919540230` (inversa a 18 dp) da otro centavo que `/ 6.96` (14367816091954022988.50). Confirma la regla de §7.1 de no usar inversas redondeadas.
- **H7 — `instanceof` no distingue clones de decimal.js**: un `Decimal` de otro clon pasa `instanceof MoneyDecimal` y conserva *su* configuración en operaciones; `Money` re-envuelve toda entrada (`new MoneyDecimal(x)`, copia exacta). En el shared-kernel no exportar el `Decimal` global, sólo `MoneyDecimal`.
- **H8 — TypeScript 7 vs typescript-eslint**: TS 7.0.2 (latest) no es soportado por typescript-eslint 8.71 (`<6.1.0`). Fijar TS 6.0.x en el monorepo hasta que haya soporte, o lint tipado no funcionará.
- Ejemplos numéricos de docs/09 §12 (2.345, 2.355, 1.2345665, 860.49381933→860.49, 479.17, 0.143678160919540230, 99.99 en 50/30/20, 100/3, amortización) y §6.12–6.15 (6.91, 7.007007007007007007, 6.85, 0.719424460431654676 %, 5.00, 62 500): **todos verificados correctos**.

## 7. Recomendación

**Aceptar ADR-0006** con decimal.js 10.6.0 como representación en dominio, con estos ajustes:
1. `MoneyDecimal` = clon con `defaults: true`, precisión 40, HALF_EVEN; prohibido importar el `Decimal` global fuera del shared-kernel (lint `no-restricted-imports`).
2. Toda materialización (`multiply`, `divide`, `percentage`, `convert`) usa **cuantización racional exacta** (bigint), no "precisión 40 + toDecimalPlaces".
3. `Money` valida escala por valor (acepta ceros finales de NUMERIC), rango < 10²⁰ (`AMOUNT_OUT_OF_RANGE`) y normaliza `-0`.
4. Corregir en docs (por el owner): H1, H2, H4 (cota relativa), H5 (truncar hacia cero).
5. No adoptar dinero.js ni big.js.
6. Lint: regla tipada `pf/no-number-money` + `no-restricted-syntax` + architecture test de DTOs.

## 8. ¿Promovible a `packages/shared-kernel`?

**Sí, con poco trabajo.** `src/` no depende de nada salvo decimal.js, es inmutable, sin I/O, con 39 tests (≈ 7 s) que pueden migrar tal cual. Pendiente al promover: (a) `Currency` vendrá del registro/tabla `currency` (aquí `CURRENCIES` de ejemplo); (b) decidir si `MoneyError` hereda de `DomainError` del kernel; (c) tipos `CurrencyCode` con brand; (d) `computeConversion` pertenece a Transactions (ConversionCalculator), no al kernel — llevar sólo `Money`, `Rate`, `rounding`; (e) mover la regla de lint a `packages/eslint-config`; (f) añadir el test de integración PG de TC-002.

## 9. Riesgos

- **Uso de `Number(...)`/`toNumber()` por un dev/agente** → regla tipada + architecture test (mitigado parcialmente; la regla se basa en nombres).
- **Rendimiento**: ~6 µs/allocate, ~0.6 µs/suma: sin impacto previsible; vigilar en reporting masivo (sumar en SQL `NUMERIC`).
- **Bundle frontend**: decimal.js ~32 KB min; aceptable.
- **Compatibilidad TS 7** (H8) para el tooling de lint.
- **Mezcla de clones de decimal.js** (H7) si algún paquete trae su propio `Decimal`.
- **Tests de propiedad lentos en CI**: round-trip con 10⁵ casos ≈ 3.5 s; nightly 30 s total — aceptable.
