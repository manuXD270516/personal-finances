import type {
  CategoryCatalogQuery,
  ClassificationValidator,
  CounterpartyCatalogQuery,
} from '@pf/classification/contracts';
import { currentRequestContext } from '@pf/platform/api';
import { DomainError } from '@pf/shared-kernel';
import type { ReferenceCatalog } from '../application/ports/index.js';
import { actionTargets, type Action, type ActionCatalog } from '../domain/index.js';

/** Usuario de la petición en curso (`''` en procesos sin usuario: el contexto RLS lo trata como ausente). */
const actorUserId = (): string => {
  const actor = currentRequestContext()?.actor;
  return actor && actor.type === 'USER' ? actor.userId : '';
};

/**
 * Destinos de las acciones contra los contratos públicos de CLASSIFICATION (sin leer sus tablas). Al guardar valida con
 * los códigos de Classification; al evaluar resume el estado vigente en un `ActionCatalog` en memoria (una consulta de
 * catálogo por tipo de destino, no una por sujeto).
 */
export class ClassificationReferenceCatalog implements ReferenceCatalog {
  constructor(
    private readonly validator: ClassificationValidator,
    private readonly categories: CategoryCatalogQuery,
    private readonly counterparties: CounterpartyCatalogQuery,
  ) {}

  async assertActions(input: {
    readonly workspaceId: string;
    readonly actions: readonly Action[];
  }): Promise<void> {
    const userId = actorUserId();
    const { workspaceId } = input;
    const t = actionTargets(input.actions);
    const indexOf = (match: (a: Action) => boolean) => input.actions.findIndex(match);
    if (t.categoryIds.length > 0) {
      const found = new Map(
        (await this.categories.categoriesByIds({ userId, workspaceId, categoryIds: t.categoryIds })).map(
          (c) => [c.categoryId, c],
        ),
      );
      for (const id of t.categoryIds) {
        const pointer = `/actions/${indexOf((a) => a.type === 'SET_CATEGORY' && a.categoryId === id)}/categoryId`;
        const c = found.get(id);
        if (!c) throw new DomainError('REFERENCE_NOT_FOUND', `category ${id} not found`).at(pointer);
        if (c.archived) throw new DomainError('CATEGORY_ARCHIVED', `category ${id} is archived`).at(pointer);
      }
    }
    if (t.tagIds.length > 0) {
      await this.validator.validate({ userId, workspaceId, tagIds: t.tagIds });
    }
    for (const counterpartyId of t.counterpartyIds) {
      await this.validator.validate({ userId, workspaceId, counterpartyId });
    }
    for (const fieldId of t.customFieldIds) {
      const i = indexOf((a) => a.type === 'SET_CUSTOM_FIELD' && a.fieldId === fieldId);
      const action = input.actions[i];
      if (action?.type !== 'SET_CUSTOM_FIELD') continue;
      try {
        await this.validator.validateCustomFieldValues({
          userId,
          workspaceId,
          target: 'TRANSACTION',
          requireMandatory: false,
          items: [
            {
              pointer: `/actions/${i}/value`,
              values: [{ fieldId, value: action.value }],
              existingFieldIds: [],
            },
          ],
        });
      } catch (err) {
        throw err instanceof DomainError ? err.at(`/actions/${i}`) : err;
      }
    }
  }

  async load(input: {
    readonly workspaceId: string;
    readonly actions: readonly Action[];
  }): Promise<ActionCatalog> {
    const userId = actorUserId();
    const { workspaceId } = input;
    const t = actionTargets(input.actions);
    const categoryKinds = new Map<string, 'EXPENSE' | 'INCOME'>();
    const activeTags = new Set<string>();
    if (t.categoryIds.length > 0 || t.tagIds.length > 0) {
      // El árbol del catálogo es pequeño (decenas a cientos de filas): una consulta cubre categorías y etiquetas.
      const tree = await this.categories.categoryTree({ userId, workspaceId });
      for (const c of tree.categories) if (!c.archived) categoryKinds.set(c.categoryId, c.kind);
      for (const tag of tree.tags) if (!tag.archived) activeTags.add(tag.tagId);
    }
    const activeCounterparties = new Set<string>();
    if (t.counterpartyIds.length > 0) {
      const found = await this.counterparties.counterpartiesByIds({
        workspaceId,
        counterpartyIds: t.counterpartyIds,
      });
      for (const c of found) if (!c.archived) activeCounterparties.add(c.counterpartyId);
    }
    const activeFields = new Set<string>();
    for (const fieldId of t.customFieldIds) {
      const action = input.actions.find((a) => a.type === 'SET_CUSTOM_FIELD' && a.fieldId === fieldId);
      if (action?.type !== 'SET_CUSTOM_FIELD') continue;
      try {
        await this.validator.validateCustomFieldValues({
          userId,
          workspaceId,
          target: 'TRANSACTION',
          requireMandatory: false,
          items: [{ pointer: '/value', values: [{ fieldId, value: action.value }], existingFieldIds: [] }],
        });
        activeFields.add(fieldId);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
      }
    }
    return {
      activeCategoryKind: (id) => categoryKinds.get(id) ?? null,
      isTagActive: (id) => activeTags.has(id),
      isCounterpartyActive: (id) => activeCounterparties.has(id),
      isCustomFieldActive: (id) => activeFields.has(id),
    };
  }
}
