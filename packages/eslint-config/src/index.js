// Configuración ESLint compartida del monorepo (openspec add-ledger-core 2.4; ADR-0006, SPIKE-03 H7).
import { noNumberMoney } from './no-number-money.js';

/** Plugin `pf`. */
export const plugin = {
  meta: { name: '@pf/eslint-config' },
  rules: { 'no-number-money': noNumberMoney },
};

const DECIMAL_MESSAGE =
  'No uses el Decimal global de decimal.js (SPIKE-03 H7): usa Money / MoneyDecimal de @pf/shared-kernel.';

/**
 * `no-restricted-imports`: el `Decimal` global de decimal.js no se importa fuera del clon `MoneyDecimal` del
 * shared-kernel (hallazgo H7: un clon con otra configuración pasa `instanceof` y conserva su precisión/redondeo).
 */
export const noGlobalDecimal = {
  'no-restricted-imports': [
    'error',
    {
      paths: [{ name: 'decimal.js', message: DECIMAL_MESSAGE }],
      patterns: [{ group: ['decimal.js/*'], message: DECIMAL_MESSAGE }],
    },
  ],
};

/**
 * Preset de dinero para el flat config: regla `pf/no-number-money` + prohibición del Decimal global.
 * `decimalAllowed`: globs del único dueño de decimal.js (el clon `MoneyDecimal` y `Money`): puede importar decimal.js y
 * usar sus métodos exactos (`Decimal#toFixed(dp)` es decimal, no binario), así que ahí ambas reglas se apagan.
 */
export function moneyConfig({ files = ['**/*.{ts,tsx,mts,cts}'], decimalAllowed = [] } = {}) {
  return [
    {
      files,
      plugins: { pf: plugin },
      rules: { 'pf/no-number-money': 'error', ...noGlobalDecimal },
    },
    ...(decimalAllowed.length > 0
      ? [{ files: decimalAllowed, rules: { 'no-restricted-imports': 'off', 'pf/no-number-money': 'off' } }]
      : []),
  ];
}

export default { plugin, moneyConfig, noGlobalDecimal };
