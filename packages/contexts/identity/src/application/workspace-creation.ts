import type { Workspace } from '../domain/workspace.js';
import type { IdentityDeps } from './ports/index.js';

/**
 * Alta de un workspace nuevo en la unidad de trabajo en curso (lo comparten `CreateWorkspace`, la provisión del
 * workspace personal y `RequestDemoData`): fila + membresías, gancho síncrono de otros contextos (categorías,
 * monedas), `identity.WorkspaceCreated.v1` y auditoría del alta en el propio workspace.
 */
export async function persistNewWorkspace(
  deps: IdentityDeps,
  workspace: Workspace,
  userId: string,
  origin: 'PERSONAL_DEFAULT' | 'USER_CREATED',
  seedDefaultCategories = true,
): Promise<void> {
  await deps.uow.bind({ userId, workspaceId: workspace.id });
  await deps.workspaces.insert(workspace);
  // add-classification (design §6): categorías de sistema (y catálogo inicial) en la MISMA transacción.
  await deps.onWorkspaceCreated?.onWorkspaceCreated({
    workspaceId: workspace.id,
    userId,
    seedDefaultCategories,
  });
  await deps.uow.bind({ userId, workspaceId: workspace.id });
  const s = workspace.settings;
  await deps.outbox.append({
    eventId: deps.ids.next(),
    eventType: 'identity.WorkspaceCreated',
    eventVersion: 1,
    aggregateType: 'Workspace',
    aggregateId: workspace.id,
    aggregateVersion: 1,
    workspaceId: workspace.id,
    occurredAt: deps.clock.now().toString(),
    actor: { type: 'USER', id: userId },
    payload: {
      workspaceId: workspace.id,
      name: s.name,
      baseCurrency: s.baseCurrency.code,
      timeZone: s.timeZone.value,
      locale: s.locale.value,
      fiscalMonthStartDay: s.fiscalMonthStartDay,
      ownerUserId: userId,
      origin,
    },
  });
  await deps.audit.append({
    workspaceId: workspace.id,
    action: 'identity.workspace.created',
    aggregateType: 'Workspace',
    aggregateId: workspace.id,
    aggregateVersion: 1,
    changes: [
      { field: 'name', before: null, after: s.name },
      { field: 'baseCurrency', before: null, after: s.baseCurrency.code },
      { field: 'timeZone', before: null, after: s.timeZone.value },
      { field: 'locale', before: null, after: s.locale.value },
      { field: 'fiscalMonthStartDay', before: null, after: s.fiscalMonthStartDay },
      { field: 'origin', before: null, after: origin },
    ],
    actor: { type: 'USER', userId },
  });
  for (const m of workspace.memberships) {
    await deps.audit.append({
      workspaceId: workspace.id,
      action: 'identity.workspace.member_added',
      aggregateType: 'Workspace',
      aggregateId: workspace.id,
      aggregateVersion: 1,
      changes: [
        { field: 'memberUserId', before: null, after: m.userId },
        { field: 'memberRole', before: null, after: m.role },
      ],
      actor: { type: 'USER', userId },
    });
  }
}
