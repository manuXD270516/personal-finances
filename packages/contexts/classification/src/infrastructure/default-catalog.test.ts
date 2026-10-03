import { describe, expect, it } from 'vitest';
import { ClassificationQueries } from '../application/classification.queries.js';
import { ClassificationService } from '../application/classification.service.js';
import { InMemoryClassification } from '../application/testing/in-memory.js';
import { defaultCatalogs } from './pg-classification.js';

const WS = '0190e000-0000-7000-8000-00000000000a';
const USER = '0190e000-0000-7000-8000-0000000000aa';

describe('Catálogo inicial es-BO.v1 (tarea 4.3)', () => {
  it('[TC-CLASSIFICATION-SEED-001] crear con catálogo: 13 grupos, 67 de usuario + 11 de sistema; reaplicar no duplica', async () => {
    const catalog = defaultCatalogs.get('es-BO.v1');
    if (!catalog) throw new Error('catalog es-BO.v1 missing');
    const mem = new InMemoryClassification([catalog]);
    const svc = new ClassificationService(mem.deps());
    const q = new ClassificationQueries(mem.deps());
    await svc.onWorkspaceCreated({ workspaceId: WS, userId: USER, seedDefaultCategories: true });

    const groups = await q.listCategoryGroups(USER, WS);
    const all = await q.listCategories(USER, WS);
    const user = all.filter((c) => !c.isSystem);
    expect(groups).toHaveLength(13);
    expect(all.filter((c) => c.isSystem)).toHaveLength(11);
    expect(user).toHaveLength(67);
    expect(user.filter((c) => c.kind === 'EXPENSE')).toHaveLength(53);
    expect(user.filter((c) => c.kind === 'INCOME')).toHaveLength(14);
    expect(user.every((c) => c.systemCode === null)).toBe(true);
    const alimentacion = groups.find((g) => g.name === 'Alimentación');
    const supermercado = user.find((c) => c.name === 'Supermercado' && c.parentId === null);
    expect(supermercado?.groupId).toBe(alimentacion?.id);

    // Son categorías de usuario: renombrar y archivar se aceptan.
    await svc.updateCategory(USER, WS, supermercado!.id, 1, { name: 'Súper' });
    const delivery = user.find((c) => c.name === 'Delivery')!;
    await svc.archiveCategory(USER, WS, delivery.id, 1);

    const again = await svc.applyDefaultCatalog(USER, WS, 'es-BO.v1');
    // "Supermercado" (renombrada) y "Delivery" (archivada) vuelven a crearse; sus 2 subcategorías ya existían bajo
    // la renombrada pero se crean bajo la nueva "Supermercado" (nivel distinto). El resto se omite.
    expect(again.createdGroups).toBe(0);
    expect(again.createdCategories).toBe(4);
    expect(again.skipped).toBe(13 + 67 - 4);
    const third = await svc.applyDefaultCatalog(USER, WS, 'es-BO.v1');
    expect(third).toMatchObject({ createdGroups: 0, createdCategories: 0, skipped: 13 + 67 });
    expect(
      mem.audits.map((a) => a.action).filter((a) => a === 'classification.catalog.applied'),
    ).toHaveLength(2);
    await expect(svc.applyDefaultCatalog(USER, WS, 'xx.v9')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
