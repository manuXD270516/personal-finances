import { describe, expect, it } from 'vitest';
import { UsageError } from '../src/lib/errors.js';
import { assertDestructiveAllowed, composeProject } from '../src/lib/paths.js';

describe('proyecto Compose de pnpm stack:* (fix-stack-project-guard)', () => {
  it('[TC-PLATFORM-STACKGUARD-001] sin variables usa pfos; PF_COMPOSE_PROJECT manda y PF_E2E_PROJECT es el respaldo', () => {
    expect(composeProject({})).toBe('pfos');
    expect(composeProject({ PF_COMPOSE_PROJECT: 'pfos-test' })).toBe('pfos-test');
    expect(composeProject({ PF_E2E_PROJECT: 'pfos-e2e-pwa' })).toBe('pfos-e2e-pwa');
    expect(composeProject({ PF_COMPOSE_PROJECT: 'pfos-e2e-a', PF_E2E_PROJECT: 'pfos-e2e-a' })).toBe(
      'pfos-e2e-a',
    );
    expect(composeProject({ PF_E2E_PROJECT: '' })).toBe('pfos');
  });

  it('[TC-PLATFORM-STACKGUARD-002] PF_E2E_PROJECT debe empezar con pfos-e2e y no puede contradecir a PF_COMPOSE_PROJECT', () => {
    expect(() => composeProject({ PF_E2E_PROJECT: 'pfos' })).toThrow(UsageError);
    expect(() => composeProject({ PF_E2E_PROJECT: 'otro' })).toThrow(/pfos-e2e/);
    expect(() => composeProject({ PF_COMPOSE_PROJECT: 'pfos-test', PF_E2E_PROJECT: 'pfos-e2e-x' })).toThrow(
      /difieren/,
    );
  });
});

describe('guarda de operaciones destructivas sobre el stack del owner (fix-stack-project-guard)', () => {
  it('[TC-PLATFORM-STACKGUARD-003] sobre pfos sin terminal se niega aunque haya --yes, y el mensaje explica por qué', () => {
    expect(() => assertDestructiveAllowed('stack:down --volumes', 'pfos', { isTTY: false, env: {} })).toThrow(
      /2026-11-27/,
    );
    expect(() => assertDestructiveAllowed('stack:reset', 'pfos', { isTTY: false, env: {} })).toThrow(
      /PF_ALLOW_DEV_STACK_WIPE=pfos/,
    );
    expect(() =>
      assertDestructiveAllowed('restore:local', 'pfos', {
        isTTY: false,
        env: { PF_ALLOW_DEV_STACK_WIPE: 'si' },
      }),
    ).toThrow(UsageError);
  });

  it('[TC-PLATFORM-STACKGUARD-004] se permite con terminal interactiva o con PF_ALLOW_DEV_STACK_WIPE=pfos', () => {
    expect(() => assertDestructiveAllowed('stack:reset', 'pfos', { isTTY: true, env: {} })).not.toThrow();
    expect(() =>
      assertDestructiveAllowed('stack:reset', 'pfos', {
        isTTY: false,
        env: { PF_ALLOW_DEV_STACK_WIPE: 'pfos' },
      }),
    ).not.toThrow();
  });

  it('[TC-PLATFORM-STACKGUARD-005] los proyectos desechables no pasan por la guarda', () => {
    for (const project of ['pfos-test', 'pfos-e2e', 'pfos-e2e-pwa'])
      expect(() => assertDestructiveAllowed('stack:reset', project, { isTTY: false, env: {} })).not.toThrow();
  });
});
