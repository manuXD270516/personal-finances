/**
 * Reglas de arquitectura (docs/16-testing-strategy.md §5.17, ADR-0003, design.md decisión 6).
 * Validadas en SPIKE-04; cada regla tiene un fixture que la hace fallar (scripts/architecture, TC-PLATFORM-ARCH-001).
 *
 * Rutas relativas a la raíz del repositorio. Hoy no existe ningún bounded context: las reglas sobre
 * `packages/contexts/*` no tienen módulos que evaluar en el repo real, pero se prueban contra fixtures.
 *
 * La prohibición de leer `process.env` fuera de `@pf/platform` NO vive aquí: es la regla
 * `no-restricted-properties` de eslint.config.js (docs/19 §0.3).
 */
const CTX = '^packages/contexts/([^/]+)/src/';
// Resuelto (`…/node_modules/<pkg>/…`, también dentro de `.pnpm`) o no resuelto (`<pkg>` tal cual).
const FRAMEWORKS =
  '(^|/node_modules/)(@nestjs/|kysely(/|$)|pg(/|$)|pg-boss(/|$)|bullmq(/|$)|ioredis(/|$)|@aws-sdk/|express(/|$)|reflect-metadata(/|$)|next(/|$)|react(/|$)|react-dom(/|$))';
const NODE_IO =
  '^(node:)?(fs|fs/promises|net|http|https|http2|child_process|async_hooks|worker_threads|dgram|tls|cluster)$';

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
      comment:
        'domain y shared-kernel no importan Nest, Kysely, pg, pg-boss, BullMQ, ioredis, AWS SDK, Next/React ni I/O de Node.',
      from: { path: [`${CTX}domain/`, '^packages/shared-kernel/src/'] },
      to: { path: [FRAMEWORKS, NODE_IO] },
    },
    {
      name: 'domain-only-shared-kernel',
      severity: 'error',
      comment: 'domain solo puede importar su propio domain y @pf/shared-kernel.',
      from: { path: `${CTX}domain/` },
      // vitest y fast-check: los tests de dominio (`*.test.ts`) importan el runner y la librería de PBT; no son
      // dependencias del modelo.
      to: {
        pathNot: [
          '^packages/contexts/$1/src/domain/',
          '^packages/shared-kernel/src/',
          '(^|/node_modules/)vitest(/|$)',
          '(^|/node_modules/)fast-check(/|$)',
        ],
      },
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
      comment: 'application y contracts son TypeScript plano: sin Nest, ORM, colas ni SDKs.',
      from: { path: `${CTX}(application|contracts)/` },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'no-cross-context-internals',
      severity: 'error',
      comment: 'Un contexto solo consume otro vía @pf/<ctx>/contracts.',
      from: { path: '^packages/contexts/([^/]+)/' },
      to: {
        path: '^packages/contexts/[^/]+/src/(domain|application|infrastructure|interface)/',
        pathNot: '^packages/contexts/$1/',
      },
    },
    {
      name: 'contracts-are-leaves',
      severity: 'error',
      comment: 'contracts (API pública estable) no depende de las capas internas de su propio contexto.',
      from: { path: `${CTX}contracts/` },
      to: { path: '^packages/contexts/$1/src/(domain|application|infrastructure|interface)/' },
    },
    {
      name: 'composition-root-only-public-entrypoints',
      severity: 'error',
      comment: 'apps/* solo consume contracts y el módulo Nest (interface/<ctx>.module.ts) de cada contexto.',
      from: { path: '^apps/' },
      to: {
        path: '^packages/contexts/[^/]+/src/',
        pathNot: '^packages/contexts/[^/]+/src/(contracts/|interface/[^/]+\\.module\\.ts$)',
      },
    },
    {
      name: 'web-no-backend-internals',
      severity: 'error',
      comment: 'apps/web no importa packages/contexts (solo el cliente generado desde OpenAPI).',
      from: { path: '^apps/web/' },
      to: { path: '^packages/contexts/' },
    },
    {
      name: 'shared-kernel-pure',
      severity: 'error',
      comment: '@pf/shared-kernel no depende de ningún otro paquete del workspace.',
      from: { path: '^packages/shared-kernel/' },
      to: { path: '^(packages|apps|scripts)/', pathNot: '^packages/shared-kernel/' },
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
  required: [
    {
      name: 'command-handlers-audit',
      severity: 'error',
      comment:
        'NFR-DATA-007 / INV-029 (add-audit-trail): todo command handler (*.command-handler.ts) o servicio de casos de uso (*.service.ts) de un contexto depende de AuditPort (@pf/audit/contracts) y audita dentro de su unidad de trabajo. Las consultas puras van en *.queries.ts.',
      module: {
        path: '^packages/contexts/([^/]+)/src/application/(.+/)?[^/]+([.-]command-handler|[.]service)[.]ts$',
        pathNot: ['^packages/contexts/audit/', '[.]test[.]ts$', '/testing/'],
      },
      to: { path: '^packages/contexts/audit/src/contracts/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // OJO (SPIKE-04, R4): NO excluir node_modules aquí. `exclude` elimina también las aristas y
    // `domain-no-framework` dejaría de dispararse en silencio. `doNotFollow` basta.
    exclude: {
      // Sin tocar node_modules: paquetes cuyo entry point vive en `dist/` (p. ej. kysely) deben seguir siendo
      // aristas visibles para `domain-no-framework`.
      path: '^(apps|packages|packages/contexts|scripts|spikes)/[^/]+/(dist|\\.next|\\.turbo|coverage)/|^(\\.turbo|coverage)/|(^|/)fixtures/|(^|/)next-env\\.d\\.ts$',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // Igual que TS (customConditions) y Vitest (resolve.conditions): resolver a src/*.ts.
      conditionNames: ['@pf/source', 'import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
