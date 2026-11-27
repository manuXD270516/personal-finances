import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../domain/index.js';
import { retargetDefinition } from './classification-merge.participant.js';

const SRC = '0190d000-0000-7000-8000-0000000000a1';
const DST = '0190d000-0000-7000-8000-0000000000a2';

describe('retargetDefinition (fusión de categorías y contrapartes)', () => {
  it('[TC-CLASSIFICATION-MERGE-016] la acción SET_CATEGORY pasa a la destino y la regla queda con definición nueva', () => {
    const def = parseDefinition({
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'HIPERMAXI' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: SRC }],
    });
    const next = retargetDefinition(def, 'CATEGORY', SRC, DST);
    expect(next?.actions).toEqual([{ type: 'SET_CATEGORY', categoryId: DST }]);
    expect(next?.conditions).toEqual(def.conditions);
    // Una regla que no la usa no cambia.
    expect(retargetDefinition(def, 'CATEGORY', DST, SRC)).toBeNull();
    expect(retargetDefinition(def, 'COUNTERPARTY', SRC, DST)).toBeNull();
  });

  it('[TC-CLASSIFICATION-MERGE-026] SET_COUNTERPARTY y la condición sobre la contraparte pasan a la destino', () => {
    const def = parseDefinition({
      conditions: [{ field: 'COUNTERPARTY', operator: 'equals', value: SRC }],
      actions: [{ type: 'SET_COUNTERPARTY', counterpartyId: SRC }],
    });
    const next = retargetDefinition(def, 'COUNTERPARTY', SRC, DST);
    expect(next?.actions).toEqual([{ type: 'SET_COUNTERPARTY', counterpartyId: DST }]);
    expect(next?.conditions).toEqual([{ field: 'COUNTERPARTY', operator: 'equals', value: DST }]);
  });

  it('[TC-CLASSIFICATION-MERGE-016] las condiciones y acciones que quedan duplicadas se colapsan y una lista «in» no repite la destino', () => {
    const def = parseDefinition({
      conditions: [
        { field: 'CATEGORY', operator: 'equals', value: SRC },
        { field: 'CATEGORY', operator: 'equals', value: DST },
        { field: 'CATEGORY', operator: 'in', values: [SRC, DST] },
      ],
      matchMode: 'ANY',
      actions: [
        { type: 'SET_CATEGORY', categoryId: SRC },
        { type: 'SET_CATEGORY', categoryId: DST },
      ],
    });
    const next = retargetDefinition(def, 'CATEGORY', SRC, DST);
    expect(next?.conditions).toEqual([
      { field: 'CATEGORY', operator: 'equals', value: DST },
      { field: 'CATEGORY', operator: 'in', values: [DST] },
    ]);
    expect(next?.actions).toEqual([{ type: 'SET_CATEGORY', categoryId: DST }]);
  });
});
