// Comparativa (SPIKE-04): eslint-plugin-boundaries v7 implementando un subconjunto de las reglas.
// La fuente de verdad propuesta sigue siendo dependency-cruiser (ver README).
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/test/**', '**/*.config.*', 'scripts/**', 'fixtures/**'] },
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { conditionNames: ['@pf/source', 'import', 'default'] } },
      'boundaries/elements': [
        { type: 'shared-kernel', pattern: 'packages/shared-kernel/src' },
        { type: 'platform', pattern: 'packages/platform/src' },
        { type: 'domain', pattern: 'packages/contexts/*/src/domain', capture: ['context'] },
        { type: 'application', pattern: 'packages/contexts/*/src/application', capture: ['context'] },
        { type: 'infrastructure', pattern: 'packages/contexts/*/src/infrastructure', capture: ['context'] },
        { type: 'interface', pattern: 'packages/contexts/*/src/interface', capture: ['context'] },
        { type: 'contracts', pattern: 'packages/contexts/*/src/contracts', capture: ['context'] },
        { type: 'app', pattern: 'apps/*/src', capture: ['app'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        2,
        {
          default: 'disallow',
          checkAllOrigins: true,
          policies: [
            { from: { element: { type: 'domain' } }, allow: { to: { element: { types: { anyOf: ['domain', 'shared-kernel'] } } } } },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: { anyOf: ['domain', 'application', 'contracts', 'shared-kernel', 'platform'] } } } },
            },
            {
              from: { element: { types: { anyOf: ['infrastructure', 'interface'] } } },
              allow: { to: { element: { types: { anyOf: ['domain', 'application', 'infrastructure', 'interface', 'contracts', 'shared-kernel', 'platform'] } } } },
            },
            { from: { element: { type: 'contracts' } }, allow: { to: { element: { type: 'contracts' } } } },
            { from: { element: { type: 'platform' } }, allow: { to: { element: { type: 'platform' } } } },
            { from: { element: { type: 'shared-kernel' } }, allow: { to: { element: { type: 'shared-kernel' } } } },
            { from: { element: { type: 'app' } }, allow: { to: { element: { types: { anyOf: ['app', 'interface', 'contracts', 'shared-kernel', 'platform'] } } } } },
            // Externos: solo dominio/aplicación/contratos restringidos.
            { from: { element: { types: { anyOf: ['infrastructure', 'interface', 'app', 'platform'] } } }, allow: { to: { module: { origin: 'external' } } } },
            { from: { element: { types: { anyOf: ['infrastructure', 'interface', 'app', 'platform'] } } }, allow: { to: { module: { origin: 'core' } } } },
            // Sin esta política explícita, los imports externos desde domain NO se reportan.
            { from: { element: { types: { anyOf: ['domain', 'application', 'contracts', 'shared-kernel'] } } }, disallow: { to: { module: { origin: 'external' } } } },
            { from: { element: { types: { anyOf: ['domain', 'application', 'contracts', 'shared-kernel'] } } }, disallow: { to: { module: { origin: 'core' } } } },
            // Cross-context internals: requiere plantilla con el valor capturado del origen.
            {
              from: { element: { types: { anyOf: ['domain', 'application', 'infrastructure', 'interface', 'contracts'] } } },
              disallow: {
                to: {
                  element: {
                    types: { anyOf: ['domain', 'application', 'infrastructure', 'interface'] },
                    captured: { context: '!{{ from.element.captured.context }}' },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
];
