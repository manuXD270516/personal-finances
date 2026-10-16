import { describe, expect, it } from 'vitest';
import {
  durationInDays,
  loadRenovate,
  pnpmMinimumReleaseAgeDays,
  readText,
  walk,
  workflowFiles,
} from './helpers.js';

const config = loadRenovate();
const rulesWith = (predicate: (rule: (typeof config.packageRules)[number]) => boolean) =>
  config.packageRules.filter(predicate);

/** Patrón `/regex/` de Renovate -> RegExp. */
const toRegExp = (pattern: string): RegExp => new RegExp(pattern.replace(/^\/(.*)\/$/, '$1'));

describe('renovate.json5: ventana semanal, grupos y fijado (TC-PLATFORM-PIPELINE-005)', () => {
  it('[TC-PLATFORM-PIPELINE-005] la ventana es semanal (lunes antes de las 06:00) en America/La_Paz con 5 PR abiertas como máximo', () => {
    expect(config.timezone).toBe('America/La_Paz');
    expect(config.schedule).toEqual(['before 6am on monday']);
    expect(config.prConcurrentLimit).toBe(5);
  });

  it('[TC-PLATFORM-PIPELINE-005] hay un grupo por ecosistema y ninguno incluye versiones mayores', () => {
    const groups = rulesWith((r) => typeof r.groupName === 'string');
    const names = groups.map((r) => r.groupName);
    expect(names).toEqual([
      'dependencias del workspace',
      'acciones de CI',
      'imagen {{{depName}}}',
      'runtime (Node)',
    ]);
    for (const group of groups) {
      expect(group.matchUpdateTypes, group.groupName as string).toBeDefined();
      expect(group.matchUpdateTypes).not.toContain('major');
    }
  });

  it('[TC-PLATFORM-PIPELINE-005] las acciones se mantienen por SHA completo (helper de Renovate) y hoy todas lo están', () => {
    expect(config.extends).toContain('helpers:pinGitHubActionDigests');
    const unpinned: string[] = [];
    for (const file of workflowFiles()) {
      for (const [, uses] of readText(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        if (uses!.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/.test(uses!)) unpinned.push(`${file}: ${uses}`);
      }
    }
    expect(unpinned).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-005] las imágenes de compose, Dockerfiles y Testcontainers siguen por tag y digest', () => {
    const files = [
      'deploy/compose/compose.yaml',
      'deploy/compose/compose.prod.yaml',
      'docker/api.Dockerfile',
      'docker/web.Dockerfile',
      'docker/postgres.Dockerfile',
      'apps/api/test/support/images.ts',
    ];
    const withoutDigest: string[] = [];
    for (const file of files) {
      for (const line of readText(file).split('\n')) {
        const ref =
          /^\s*image:\s*(\S+)/.exec(line)?.[1] ??
          /^ARG \w+_IMAGE=(\S+)/.exec(line)?.[1] ??
          (file.endsWith('images.ts') ? /^\s*'([^']+)',?;?$/.exec(line)?.[1] : undefined);
        if (!ref || ref.includes('${') || ref.endsWith(':local')) continue;
        if (!/@sha256:[a-f0-9]{64}$/.test(ref)) withoutDigest.push(`${file}: ${ref}`);
      }
    }
    expect(withoutDigest).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-005] el gestor regex cubre las tres imágenes de Testcontainers (tag + digest), incluido PostgreSQL', () => {
    const manager = config.customManagers.find((m) =>
      m.managerFilePatterns.some((p) => toRegExp(p).test('apps/api/test/support/images.ts')),
    );
    expect(manager?.customType).toBe('regex');
    expect(manager?.datasourceTemplate).toBe('docker');
    const source = readText('apps/api/test/support/images.ts');
    const found = manager!.matchStrings.flatMap((s) =>
      [...source.matchAll(new RegExp(s, 'g'))].map((m) => ({
        depName: m.groups!['depName'],
        currentValue: m.groups!['currentValue'],
        currentDigest: m.groups!['currentDigest'],
      })),
    );
    expect(found.map((f) => f.depName)).toEqual(['postgres', 'chrislusf/seaweedfs', 'axllent/mailpit']);
    for (const f of found) expect(f.currentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('[TC-PLATFORM-PIPELINE-005] cubre los gestores acordados y deja fuera spikes, fixtures y los binarios con SHA-256', () => {
    expect(config.enabledManagers).toEqual(
      expect.arrayContaining([
        'npm',
        'nvm',
        'github-actions',
        'dockerfile',
        'docker-compose',
        'custom.regex',
      ]),
    );
    expect(config.ignorePaths).toContain('**/spikes/**');
    // `:ignoreModulesAndTests` ignora `**/test/**`: el arreglo propio no debe volver a incluirlo.
    expect(config.ignorePaths.some((p) => /\/tests?\/\*\*/.test(p))).toBe(false);
    // Los binarios de Trivy y gitleaks (pr.yml) se revisan a mano: ningún gestor apunta a los workflows.
    for (const manager of config.customManagers) {
      for (const pattern of manager.managerFilePatterns) {
        expect(toRegExp(pattern).test('.github/workflows/pr.yml'), pattern).toBe(false);
      }
    }
  });

  it('[TC-PLATFORM-PIPELINE-005] el servicio no tiene opciones que toquen la protección de la rama ni los checks requeridos', () => {
    const forbidden = new Set([
      'requiredStatusChecks',
      'ignoreTests',
      'branchProtection',
      'bypassRequiredChecks',
      'automergeStrategy',
    ]);
    const hits = [...walk(config)].filter((e) => forbidden.has(e.key)).map((e) => e.path);
    expect(hits).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-005] las PR de seguridad salen de la ventana con etiqueta security', () => {
    expect(config.vulnerabilityAlerts['schedule']).toEqual(['at any time']);
    expect(config.vulnerabilityAlerts['labels']).toContain('security');
    expect(config['osvVulnerabilityAlerts']).toBe(true);
  });

  it('[TC-PLATFORM-PIPELINE-005] los textos de commit y de PR están en español', () => {
    expect(config['commitMessageAction']).toBe('actualizar');
    expect(config['semanticCommitType']).toBe('chore');
    expect(config['semanticCommitScope']).toBe('deps');
    expect(String(config['prHeader'])).toMatch(/Actualización de dependencias/);
    expect(String(config['prFooter'])).toMatch(/protección de `main`/);
  });
});

describe('renovate.json5: sin fusión automática de mayores ni con checks pendientes (TC-PLATFORM-PIPELINE-006)', () => {
  const allowedAutomergeTypes = new Set(['patch', 'pin', 'pinDigest', 'digest']);

  it('[TC-PLATFORM-PIPELINE-006] la fusión automática es opt-in y se delega en el auto-merge nativo de GitHub', () => {
    expect(config.automerge).toBe(false);
    expect(config.platformAutomerge).toBe(true);
    expect(config['automergeType']).toBeUndefined();
  });

  it('[TC-PLATFORM-PIPELINE-006] ninguna regla con automerge activo aplica a major ni a minor: solo parches y digests', () => {
    const automerging = rulesWith((r) => r.automerge === true);
    expect(automerging.length).toBeGreaterThan(0);
    for (const rule of automerging) {
      expect(rule.matchUpdateTypes, rule.description).toBeDefined();
      for (const type of rule.matchUpdateTypes!) expect(allowedAutomergeTypes.has(type), type).toBe(true);
    }
  });

  it('[TC-PLATFORM-PIPELINE-006] la clase con automerge se limita a lo que decidió el owner (D264)', () => {
    const descriptions = rulesWith((r) => r.automerge === true).map((r) => r.description);
    expect(descriptions).toEqual([
      'Parches de dependencias de desarrollo',
      'Digests y parches de acciones de CI',
      'Digests y parches de imágenes de desarrollo (compose de desarrollo y Testcontainers)',
    ]);
    const dev = config.packageRules.find((r) => r.description === 'Parches de dependencias de desarrollo')!;
    expect(dev.matchDepTypes).toEqual(['devDependencies']);
    expect(dev.matchUpdateTypes).toEqual(['patch']);
  });

  it('[TC-PLATFORM-PIPELINE-006] las mayores van en su PR propia, sin grupo ni automerge, con la regla al final para que gane', () => {
    const last = config.packageRules.at(-1)!;
    expect(last.matchUpdateTypes).toEqual(['major']);
    expect(last.groupName).toBeNull();
    expect(last.automerge).toBe(false);
    expect(last['addLabels']).toContain('major');
  });

  it('[TC-PLATFORM-PIPELINE-006] las PR de seguridad nunca se fusionan solas', () => {
    expect(config.vulnerabilityAlerts.automerge).toBe(false);
  });
});

describe('renovate.json5: antigüedad mínima y lockfile verificable (TC-PLATFORM-PIPELINE-007)', () => {
  it('[TC-PLATFORM-PIPELINE-007] la antigüedad mínima es de al menos 3 días y no menor que la de pnpm', () => {
    const days = durationInDays(config.minimumReleaseAge);
    expect(days).toBeGreaterThanOrEqual(3);
    expect(days).toBeGreaterThanOrEqual(pnpmMinimumReleaseAgeDays());
    expect(config.internalChecksFilter).toBe('strict');
  });

  it('[TC-PLATFORM-PIPELINE-007] ninguna regla ni las alertas de seguridad bajan la antigüedad mínima', () => {
    expect(durationInDays(config.vulnerabilityAlerts.minimumReleaseAge)).toBeGreaterThanOrEqual(3);
    for (const rule of config.packageRules) {
      if ('minimumReleaseAge' in rule) {
        expect(rule.minimumReleaseAge, rule.description).not.toBeNull();
        expect(durationInDays(String(rule.minimumReleaseAge)), rule.description).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('[TC-PLATFORM-PIPELINE-007] el bot no puede editar el archivo de excepciones de vulnerabilidades ni ejecutar tareas posteriores', () => {
    expect(config.ignorePaths).toContain('.trivyignore.yaml');
    const forbidden = new Set(['postUpgradeTasks', 'allowedPostUpgradeCommands', 'allowScripts']);
    expect([...walk(config)].filter((e) => forbidden.has(e.key)).map((e) => e.path)).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-007] ningún gestor propio apunta a pnpm-workspace.yaml (allowBuilds y minimumReleaseAgeExclude) ni a .trivyignore.yaml', () => {
    for (const manager of config.customManagers) {
      for (const pattern of manager.managerFilePatterns) {
        expect(toRegExp(pattern).test('pnpm-workspace.yaml'), pattern).toBe(false);
        expect(toRegExp(pattern).test('.trivyignore.yaml'), pattern).toBe(false);
      }
    }
  });

  it('[TC-PLATFORM-PIPELINE-007] el repositorio sigue con lockfile congelado e instalación con scripts bloqueados por lista explícita', () => {
    expect(readText('pnpm-workspace.yaml')).toMatch(/^allowBuilds:/m);
    expect(readText('.github/actions/setup-workspace/action.yml')).toMatch(/pnpm install --frozen-lockfile/);
  });
});
