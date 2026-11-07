import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildMini,
  downloadExport,
  exportAndWait,
  importAndWait,
  startHarness,
  w1Api,
  type Harness,
  type Json,
  type Mini,
} from '../support/portability.js';

// Ajustes del disponible en la portabilidad del workspace (openspec add-cash-flow-forecast, tarea 4.3; decisión 12;
// TC-REPORTING-FORECAST-027): el modo de horizonte, los esenciales y su lista de categorías viajan en el export, las
// categorías se remapean con el mapa de ids del import y los ajustes del workspace restaurado conservan sus valores.
let h: Harness;
let m: Mini;

beforeAll(async () => {
  h = await startHarness({ realClock: true, worker: true });
  m = await buildMini(h, 'spendable');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Ajustes del disponible en el export y el import del workspace', () => {
  it('[TC-REPORTING-FORECAST-027] los ajustes guardados viajan en el export y las categorías esenciales se remapean al importar', async () => {
    const api = w1Api(h, m);
    const group = (await api.post(m.owner, '/category-groups', { name: 'Hogar', kind: 'EXPENSE' })).body;
    const category = (await api.post(m.owner, '/categories', { groupId: group['id'], name: 'Supermercado' }))
      .body;
    expect(category['id']).toBeTruthy();
    const saved = await api.put(
      m.owner,
      '/reports/spendable/settings',
      { horizonMode: 'NEXT_INCOME', subtractEssentials: true, essentialCategoryIds: [category['id']] },
      1,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const exported = await exportAndWait(h, m.owner, m.ws);
    const zip = (await downloadExport(h, m.owner, m.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, m.owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const restored = w1Api(h, { ws: done['workspaceId'] as string });
    const settings = await restored.get(m.owner, '/reports/spendable/settings');
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    expect(settings.body).toMatchObject({ horizonMode: 'NEXT_INCOME', subtractEssentials: true });
    const ids = settings.body['essentialCategoryIds'] as string[];
    expect(ids).toHaveLength(1);
    // La categoría esencial apunta a la copia importada (otro id, mismo nombre), no a la del workspace de origen.
    expect(ids[0]).not.toBe(category['id']);
    const categories = (await restored.get(m.owner, '/categories?limit=200')).body['data'] as Json[];
    expect(categories.find((c) => c['id'] === ids[0])?.['name']).toBe('Supermercado');
  }, 240_000);

  it('[TC-REPORTING-FORECAST-027] un workspace sin ajustes guardados se exporta sin la sección y se importa con los valores por omisión', async () => {
    const plain = await buildMini(h, 'spendable-plain');
    const exported = await exportAndWait(h, plain.owner, plain.ws);
    const zip = (await downloadExport(h, plain.owner, plain.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, plain.owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const restored = w1Api(h, { ws: done['workspaceId'] as string });
    const settings = await restored.get(plain.owner, '/reports/spendable/settings');
    expect(settings.body).toEqual({
      horizonMode: 'FINANCIAL_PERIOD',
      subtractEssentials: false,
      essentialCategoryIds: [],
      version: 1,
    });
  }, 240_000);
});
