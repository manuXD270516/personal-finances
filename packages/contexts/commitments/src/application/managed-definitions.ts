import { DomainError, LocalDate } from '@pf/shared-kernel';
import { candidates, projectedAmount, type RecurringDefinition } from '../domain/index.js';
import type { DefinitionsService, TemplateChanges } from './definitions.service.js';
import type { CommitmentsDeps } from './ports/index.js';
import type {
  ManagedDefinitionInfo,
  ManagedDefinitionPort,
  ManagedOccurrenceInfo,
} from './ports/subscriptions.js';
import type { ApiTemplate } from './template-resolver.js';
import { money, type DefinitionDto } from './views.js';

const MANAGER = 'SUBSCRIPTION' as const;
/** Horizonte de búsqueda de la próxima fecha más allá de lo generado (ciclos largos: anual, bianual…). */
const LOOKAHEAD_DAYS = 800;

/**
 * Implementación del `RecurringDefinitionPort` para `managedBy = SUBSCRIPTION` (openspec add-subscriptions, decisión 1
 * y § Dependencias): opera la definición de la suscripción con el motor en la unidad de trabajo del llamador. Las
 * acciones que el usuario no puede hacer sobre una definición administrada (`RECURRING_MANAGED_EXTERNALLY`) las hace
 * el administrador pasando `manager`. Lee la definición con `FOR UPDATE` para fijar su versión esperada.
 */
export class EngineManagedDefinitions implements ManagedDefinitionPort {
  constructor(
    private readonly deps: CommitmentsDeps,
    private readonly definitions: DefinitionsService,
  ) {}

  private async locked(workspaceId: string, definitionId: string): Promise<RecurringDefinition> {
    const def = await this.deps.definitions.findById(workspaceId, definitionId, { lock: 'update' });
    if (!def) throw new DomainError('RESOURCE_NOT_FOUND', `recurring definition ${definitionId} not found`);
    return def;
  }

  create(input: Parameters<ManagedDefinitionPort['create']>[0]): Promise<DefinitionDto> {
    return this.definitions.create({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name,
      description: input.description,
      kind: 'EXPENSE',
      template: input.template as ApiTemplate,
      managedBy: MANAGER,
      managedRef: input.subscriptionId,
    });
  }

  async info(workspaceId: string, definitionId: string): Promise<ManagedDefinitionInfo> {
    const def = await this.deps.definitions.findById(workspaceId, definitionId);
    if (!def) throw new DomainError('RESOURCE_NOT_FOUND', `recurring definition ${definitionId} not found`);
    const v = def.current;
    return {
      definitionId,
      status: def.status,
      version: def.version,
      endDate: def.endDate,
      accountId: v.accountId,
      accountCurrency: v.currency,
      categoryId: v.categoryId,
      cadence: v.schedule.cadence,
      interval: v.schedule.interval,
      monthDays: v.schedule.monthDays,
      rrule: v.schedule.rrule,
      startDate: def.versions[0]?.schedule.startDate ?? v.schedule.startDate,
      materialization: {
        mode: v.materialization.mode,
        autoCreateStatus: v.materialization.autoCreateStatus,
        leadDays: v.materialization.leadDays,
      },
      indexed: v.indexedPrice !== undefined && v.indexedPrice !== null,
      currentEffectiveFrom: v.effectiveFrom,
    };
  }

  async rename(input: Parameters<ManagedDefinitionPort['rename']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    await this.definitions.updateDetails({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      manager: MANAGER,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  }

  async pause(input: Parameters<ManagedDefinitionPort['pause']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    await this.definitions.pause({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      manager: MANAGER,
    });
  }

  async resume(input: Parameters<ManagedDefinitionPort['resume']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    await this.definitions.resume({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      manager: MANAGER,
    });
  }

  async end(input: Parameters<ManagedDefinitionPort['end']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    if (def.status === 'ENDED') return;
    await this.definitions.end({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      manager: MANAGER,
      endDate: input.endDate,
      deferClose: input.deferClose,
    });
  }

  async unscheduleEnd(input: Parameters<ManagedDefinitionPort['unscheduleEnd']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    await this.definitions.unscheduleEnd({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      manager: MANAGER,
    });
  }

  async revise(input: Parameters<ManagedDefinitionPort['revise']>[0]): Promise<void> {
    const def = await this.locked(input.workspaceId, input.definitionId);
    await this.definitions.revise({
      workspaceId: input.workspaceId,
      userId: input.userId,
      definitionId: input.definitionId,
      expectedVersion: def.version,
      effectiveFrom: input.effectiveFrom,
      changes: input.changes as TemplateChanges,
      manager: MANAGER,
    });
  }

  async revisionFrom(input: Parameters<ManagedDefinitionPort['revisionFrom']>[0]): Promise<string> {
    const def = await this.deps.definitions.findById(input.workspaceId, input.definitionId);
    if (!def)
      throw new DomainError('RESOURCE_NOT_FOUND', `recurring definition ${input.definitionId} not found`);
    const lastResolved = await this.deps.occurrences.lastResolvedNominal(
      input.workspaceId,
      input.definitionId,
    );
    const options = [input.requested, def.current.effectiveFrom];
    if (lastResolved !== null) options.push(LocalDate.parse(lastResolved).plusDays(1).toString());
    return options.sort().at(-1) as string;
  }

  async nextRenewal(input: Parameters<ManagedDefinitionPort['nextRenewal']>[0]): Promise<string | null> {
    const def = await this.deps.definitions.findById(input.workspaceId, input.definitionId);
    if (!def || def.status !== 'ACTIVE') return null;
    const today = LocalDate.parse(input.today);
    const open = await this.deps.occurrences.listForDefinition(input.workspaceId, input.definitionId, {
      from: today.toString(),
      statuses: ['SCHEDULED', 'DUE', 'OVERDUE'],
    });
    const generated = open.map((o) => o.occurrenceDate).sort()[0] ?? null;
    // Ciclos más largos que el horizonte (p. ej. anual con 90 días): lo que aún no se generó, de la regla vigente.
    const through = def.snapshot.generatedThrough ? LocalDate.parse(def.snapshot.generatedThrough) : null;
    const from = through !== null && through.compare(today) >= 0 ? through.plusDays(1) : today;
    const ahead =
      candidates(def, { from, to: from.plusDays(LOOKAHEAD_DAYS) })[0]?.occurrenceDate.toString() ?? null;
    if (generated === null) return ahead;
    if (ahead === null) return generated;
    return generated < ahead ? generated : ahead;
  }

  async occurrenceOn(
    input: Parameters<ManagedDefinitionPort['occurrenceOn']>[0],
  ): Promise<ManagedOccurrenceInfo | null> {
    const rows = await this.deps.occurrences.listForDefinition(input.workspaceId, input.definitionId, {
      from: input.occurrenceDate,
    });
    const found = rows.find((o) => o.occurrenceDate === input.occurrenceDate && o.status !== 'CANCELLED');
    if (!found) return null;
    const projected = projectedAmount(found.snapshot.expected);
    return {
      occurrenceDate: found.occurrenceDate,
      projected: projected === null ? null : money(projected, found.snapshot.currency),
    };
  }
}
