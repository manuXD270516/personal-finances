# Diseño: fix-demo-loan-month-end

## Enmienda a la decisión 4 de `add-phase-4-demo-data`

La decisión 4 (archivada en `openspec/changes/archive/2026-10-16-add-phase-4-demo-data/design.md`) fija «cuota 6 = `A − 9`» para el préstamo de consumo y «cuota 8 = `A − 20`» para el educativo. Esas reglas dejan de regir cuando el día resultante sería 29, 30 o 31: pasan a «el mismo día limitado a 28» (`cap28`).

## Por qué 28 y no «último día»

El motor de DEBT mide el primer periodo con 30/360 europeo desde el desembolso. El plan fija el desembolso un mes antes de la primera cuota con `addMonthsClamped`; si el mes anterior es febrero y el día es 29-31, el desembolso se recorta y el periodo mide 31-32 días. Con día <= 28 el desembolso conserva el día, el periodo mide siempre 30 días y el oráculo del plan coincide con el motor (ya lo hacían las anclas con día <= 28). Cambiar el motor o modelar un primer periodo irregular en el oráculo se descarta: el motor nivela la cuota y cambia todo el cronograma.

## Alcance del cambio de fechas

`cap28` actúa sobre cualquier ancla con `A − 9` o `A − 20` en día 29-31, no solo marzo/febrero: toda la serie de cuotas queda en día 28 (hasta 3 días antes). Se acepta porque no cambia ningún estado (la cuota de referencia sigue vencida y pagada y la siguiente sigue futura; el barrido unitario lo verifica para 2025-2029). Con A = 2026-09-30 las fechas son idénticas (21 y 10).

## Tarjeta Kantuta

`k0` (cierre anterior a K1) se calculaba como `K1 − 1 mes`, encadenando dos recortes. Se deriva de K2 (`K2 − 2 meses`), cuyo día es el día de cierre del motor. Sin efecto con las anclas probadas; elimina la acumulación de recortes.

## Verificación

- Barrido unitario de 1826 anclas (2025-2029): `days360(desembolso, primera cuota) = 30`, día <= 28, y cuotas de referencia <= A < siguiente. La fórmula 30/360 se replica en el test porque `apps` no importa el dominio de DEBT (`arch:check`); el contraste real con el motor lo da la carga completa.
- Carga completa con la ancla 2026-11-20 (`demo-v2.int.test.ts`), que antes fallaba con `DEMO_GOLDEN_MISMATCH`.
