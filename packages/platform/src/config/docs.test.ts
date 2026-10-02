import { describe, expect, it } from 'vitest';
import { renderConfigReference } from './docs.js';
import { VARIABLES } from './variables.js';

describe('referencia de configuración generada', () => {
  it('documenta cada variable del registro y es determinista', () => {
    const doc = renderConfigReference();
    for (const name of Object.keys(VARIABLES)) expect(doc).toContain(`| \`${name}\` |`);
    expect(renderConfigReference()).toBe(doc);
    expect(doc).toContain('NO EDITAR A MANO');
  });

  it('no incluye variables PF_* (son de Compose/scripts, no de runtime)', () => {
    expect(Object.keys(VARIABLES).some((n) => n.startsWith('PF_'))).toBe(false);
  });
});
