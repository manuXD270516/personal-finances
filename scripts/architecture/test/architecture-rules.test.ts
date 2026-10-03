import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILE, REPO_ROOT, REPO_TARGETS, createMiniRepo, cruise } from '../src/cruise.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MINI_TARGETS = ['apps', 'packages'];

/** Overlay de fixtures → regla que debe dispararse (docs/16 §5.17 + reglas extra de SPIKE-04). */
const CASES: readonly { overlay: string; rule: string; offender: string }[] = [
  { overlay: 'domain-no-infra', rule: 'domain-no-infra', offender: 'ledger/src/domain/__violation.ts' },
  {
    overlay: 'domain-no-framework-kysely',
    rule: 'domain-no-framework',
    offender: 'ledger/src/domain/__violation.ts',
  },
  {
    overlay: 'domain-no-framework-nestjs',
    rule: 'domain-no-framework',
    offender: 'ledger/src/domain/__violation.ts',
  },
  {
    overlay: 'domain-no-framework-node-io',
    rule: 'domain-no-framework',
    offender: 'ledger/src/domain/__violation.ts',
  },
  {
    overlay: 'domain-only-shared-kernel',
    rule: 'domain-only-shared-kernel',
    offender: 'ledger/src/domain/__violation.ts',
  },
  {
    overlay: 'application-no-infra',
    rule: 'application-no-infra',
    offender: 'ledger/src/application/__violation.ts',
  },
  {
    overlay: 'application-no-framework',
    rule: 'application-no-framework',
    offender: 'ledger/src/application/__violation.ts',
  },
  {
    overlay: 'no-cross-context-internals',
    rule: 'no-cross-context-internals',
    offender: 'transactions/src/application/__violation.ts',
  },
  {
    overlay: 'not-to-unresolvable',
    rule: 'not-to-unresolvable',
    offender: 'transactions/src/application/__violation.ts',
  },
  {
    overlay: 'contracts-are-leaves',
    rule: 'contracts-are-leaves',
    offender: 'ledger/src/contracts/__violation.ts',
  },
  {
    overlay: 'composition-root-only-public-entrypoints',
    rule: 'composition-root-only-public-entrypoints',
    offender: 'apps/api/src/__violation.ts',
  },
  {
    overlay: 'web-no-backend-internals',
    rule: 'web-no-backend-internals',
    offender: 'apps/web/src/__violation.ts',
  },
  { overlay: 'shared-kernel-pure', rule: 'shared-kernel-pure', offender: 'shared-kernel/src/__violation.ts' },
  { overlay: 'no-circular', rule: 'no-circular', offender: 'contracts/__cycle_' },
  {
    overlay: 'command-handlers-audit',
    rule: 'command-handlers-audit',
    offender: 'ledger/src/application/close-period.command-handler.ts',
  },
];

describe('[TC-PLATFORM-ARCH-001] reglas de dependency-cruiser', () => {
  it('la configuración no excluye node_modules (si lo hiciera, domain-no-framework pasaría en silencio)', () => {
    const require = createRequire(import.meta.url);
    const config = require(CONFIG_FILE) as { options: { exclude: { path: string } } };
    const exclude = new RegExp(config.options.exclude.path);
    expect(exclude.test('node_modules/@nestjs/common/index.js')).toBe(false);
    expect(exclude.test('node_modules/.pnpm/pg@8.23.1/node_modules/pg/lib/index.js')).toBe(false);
  });

  it('el mini repositorio base (sin fixtures de violación) pasa con cero violaciones', async () => {
    const repo = createMiniRepo(FIXTURES);
    try {
      const result = await cruise(repo.root, MINI_TARGETS);
      expect(result.violations).toEqual([]);
      expect(result.exitCode).toBe(0);
    } finally {
      repo.dispose();
    }
  });

  it('el código real del repositorio produce cero violaciones (igual que pnpm arch:check)', async () => {
    const result = await cruise(REPO_ROOT, REPO_TARGETS);
    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  describe.concurrent.each(CASES)('$overlay', ({ overlay, rule, offender }) => {
    it(`falla con '${rule}' nombrando el import infractor y código de salida distinto de cero`, async () => {
      const repo = createMiniRepo(FIXTURES, overlay);
      try {
        const result = await cruise(repo.root, MINI_TARGETS);
        const hits = result.violations.filter((v) => v.rule === rule);
        expect(hits.length, JSON.stringify(result.violations, null, 2)).toBeGreaterThan(0);
        expect(hits.some((v) => v.from.includes(offender) || v.to.includes(offender))).toBe(true);
        expect(result.exitCode).toBeGreaterThan(0);
      } finally {
        repo.dispose();
      }
    });
  });
});

describe('[TC-AUDIT-ATOMIC-001] todo command handler mutante depende de AuditPort (NFR-DATA-007)', () => {
  it('un command handler sin @pf/audit/contracts hace fallar el chequeo; con AuditPort pasa', async () => {
    const bad = createMiniRepo(FIXTURES, 'command-handlers-audit');
    try {
      const result = await cruise(bad.root, MINI_TARGETS);
      expect(result.violations).toEqual([
        {
          rule: 'command-handlers-audit',
          from: 'packages/contexts/ledger/src/application/close-period.command-handler.ts',
          to: 'packages/contexts/ledger/src/application/close-period.command-handler.ts',
        },
      ]);
      expect(result.exitCode).toBeGreaterThan(0);
    } finally {
      bad.dispose();
    }
  });
});

describe('[TC-PLATFORM-ARCH-001] process.env solo dentro de @pf/platform (ESLint)', () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const lint = async (relativePath: string) => {
    const [result] = await eslint.lintText('export const value = process.env.PF_SOMETHING;\n', {
      filePath: join(REPO_ROOT, relativePath),
    });
    return (result?.messages ?? []).map((m) => m.ruleId);
  };

  it('rechaza process.env en el dominio de un contexto y en apps/api', async () => {
    expect(await lint('packages/contexts/ledger/src/domain/__fixture.ts')).toContain(
      'no-restricted-properties',
    );
    expect(await lint('apps/api/src/__fixture.ts')).toContain('no-restricted-properties');
  });

  it('lo permite dentro de packages/platform (contrato único de configuración)', async () => {
    expect(await lint('packages/platform/src/config/__fixture.ts')).not.toContain('no-restricted-properties');
  });
});
