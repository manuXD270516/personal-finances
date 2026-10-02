/**
 * SPIKE-04 — Architecture tests (docs/16-testing-strategy.md §5.17).
 * Rutas relativas a la raíz del spike (equivale a la raíz del monorepo real).
 */
const CTX = '^packages/contexts/([^/]+)/src/';
const FRAMEWORKS =
  '(^|/)node_modules/(@nestjs/|kysely/|pg/|bullmq/|ioredis/|@aws-sdk/|express/|reflect-metadata/)';
const NODE_IO = '^(node:)?(fs|fs/promises|net|http|https|http2|child_process|async_hooks|worker_threads)$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-infra',
      severity: 'error',
      comment: 'domain no importa application, infrastructure ni interface (de ningún contexto).',
      from: { path: `${CTX}domain/` },
      to: { path: '^packages/contexts/[^/]+/src/(application|infrastructure|interface)/' },
    },
    {
      name: 'domain-no-framework',
      severity: 'error',
      comment: 'domain no importa Nest, Kysely, pg, BullMQ, ioredis, AWS SDK ni I/O de Node.',
      from: { path: [`${CTX}domain/`, '^packages/shared-kernel/src/'] },
      to: { path: [FRAMEWORKS, NODE_IO] },
    },
    {
      name: 'domain-only-shared-kernel',
      severity: 'error',
      comment: 'domain solo puede importar su propio domain y @pf/shared-kernel.',
      from: { path: `${CTX}domain/` },
      to: { pathNot: ['^packages/contexts/$1/src/domain/', '^packages/shared-kernel/src/'] },
    },
    {
      name: 'application-no-infra',
      severity: 'error',
      comment: 'application no importa infrastructure ni interface.',
      from: { path: `${CTX}application/` },
      to: { path: '^packages/contexts/[^/]+/src/(infrastructure|interface)/' },
    },
    {
      name: 'application-no-framework',
      severity: 'error',
      comment: 'application y contracts son TS plano: sin Nest/ORM/colas.',
      from: { path: `${CTX}(application|contracts)/` },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'no-cross-context-internals',
      severity: 'error',
      comment: 'Otro contexto solo vía @pf/<ctx>/contracts.',
      from: { path: '^packages/contexts/([^/]+)/' },
      to: {
        path: '^packages/contexts/[^/]+/src/(domain|application|infrastructure|interface)/',
        pathNot: '^packages/contexts/$1/',
      },
    },
    {
      name: 'contracts-are-leaves',
      severity: 'error',
      comment: 'contracts no depende de las capas internas de su propio contexto (es la API pública estable).',
      from: { path: `${CTX}contracts/` },
      to: { path: '^packages/contexts/$1/src/(domain|application|infrastructure|interface)/' },
    },
    {
      name: 'composition-root-only-public-entrypoints',
      severity: 'error',
      comment: 'apps/* solo consume contracts y el módulo Nest (interface/*.module.ts) de cada contexto.',
      from: { path: '^apps/' },
      to: {
        path: '^packages/contexts/[^/]+/src/',
        pathNot: '^packages/contexts/[^/]+/src/(contracts/|interface/[^/]+\\.module\\.ts$)',
      },
    },
    {
      name: 'shared-kernel-pure',
      severity: 'error',
      comment: '@pf/shared-kernel no depende de ningún otro paquete del workspace.',
      from: { path: '^packages/shared-kernel/' },
      to: { path: '^(packages|apps)/', pathNot: '^packages/shared-kernel/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Sin ciclos entre módulos, paquetes ni contextos.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Import que no resuelve (p. ej. deep import bloqueado por package.json#exports).',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // OJO: NO excluir node_modules aquí (exclude elimina también las aristas → las reglas
    // de "framework en domain" dejarían de dispararse). doNotFollow basta.
    exclude: { path: '(^|/)(dist|test|\\.turbo)/|vitest\\.[^/]*config\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // Igual que TS (customConditions) y Vitest (resolve.conditions): resolver a src/*.ts.
      conditionNames: ['@pf/source', 'import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
