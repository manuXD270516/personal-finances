import { describe, expect, it } from 'vitest';
import { Rule } from './rule.js';
import { parseDefinition } from './rule-definition.js';

const definition = (extra: object = {}) =>
  parseDefinition({
    conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
    actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    ...extra,
  });

const create = () =>
  Rule.create({
    id: 'r1',
    workspaceId: 'w1',
    name: ' Supermercado ',
    priority: 100,
    definition: definition(),
    createdBy: 'u1',
    now: '2026-10-20T14:00:00.000Z',
  });

describe('Rule', () => {
  it('[TC-RULES-ENGINE-001] nace activa, en la versión 1 y con los disparadores por defecto', () => {
    const s = create().snapshot;
    expect(s).toMatchObject({
      name: 'Supermercado',
      enabled: true,
      version: 1,
      rowVersion: 1,
      priority: 100,
      triggers: ['IMPORT', 'RETROACTIVE'],
    });
  });

  it('[TC-RULES-ENGINE-041] cambiar la definición sube la versión; la fila siempre sube', () => {
    const r = create();
    const res = r.update(
      {
        definition: definition({
          actions: [
            { type: 'SET_CATEGORY', categoryId: 'cat-super' },
            { type: 'ADD_TAG', tagId: 'tag-hogar' },
          ],
        }),
      },
      '2026-10-21T00:00:00.000Z',
    );
    expect(res).toEqual({ definitionChanged: true, changed: true });
    expect(r.snapshot).toMatchObject({ version: 2, rowVersion: 2 });
  });

  it('[TC-RULES-ENGINE-043] cambiar la prioridad no crea versión', () => {
    const r = create();
    const res = r.update({ priority: 5 }, '2026-10-21T00:00:00.000Z');
    expect(res).toEqual({ definitionChanged: false, changed: true });
    expect(r.snapshot).toMatchObject({ version: 1, rowVersion: 2, priority: 5 });
  });

  it('una definición idéntica no cambia nada', () => {
    const r = create();
    expect(
      r.update({ definition: definition(), name: 'Supermercado' }, '2026-10-21T00:00:00.000Z').changed,
    ).toBe(false);
    expect(r.snapshot.rowVersion).toBe(1);
  });

  it('[TC-RULES-ENGINE-039] activar y desactivar son idempotentes', () => {
    const r = create();
    expect(r.disable('2026-10-21T00:00:00.000Z')).toBe(true);
    expect(r.disable('2026-10-21T00:00:00.000Z')).toBe(false);
    expect(r.status).toBe('INACTIVE');
    expect(r.enable('2026-10-22T00:00:00.000Z')).toBe(true);
    expect(r.status).toBe('ACTIVE');
  });

  it('[TC-RULES-ENGINE-040] archivar deja de evaluar y bloquea la edición', () => {
    const r = create();
    expect(r.archive('2026-10-21T00:00:00.000Z')).toBe(true);
    expect(r.status).toBe('ARCHIVED');
    expect(r.snapshot.enabled).toBe(false);
    expect(() => r.update({ name: 'otro' }, '2026-10-22T00:00:00.000Z')).toThrow(/archived/);
    expect(() => r.enable('2026-10-22T00:00:00.000Z')).toThrow(/archived/);
  });

  it('[TC-RULES-ENGINE-002] valida nombre, descripción y prioridad', () => {
    const base = { id: 'r', workspaceId: 'w', definition: definition(), createdBy: 'u', now: 'x' };
    expect(() => Rule.create({ ...base, name: '   ' })).toThrow();
    expect(() => Rule.create({ ...base, name: 'x'.repeat(81) })).toThrow();
    expect(() => Rule.create({ ...base, name: 'ok', description: 'x'.repeat(501) })).toThrow();
    expect(() => Rule.create({ ...base, name: 'ok', priority: -1 })).toThrow();
    expect(() => Rule.create({ ...base, name: 'ok', priority: 1.5 })).toThrow();
  });
});
