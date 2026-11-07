import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { SpendableSettingsDto, SpendableSettingsInputDto } from '../contracts/index.js';
import {
  SpendableSettingsPolicy,
  type SettingsCategory,
  type SettingsChange,
  type SpendableSettingsValue,
} from '../domain/index.js';
import {
  DEFAULT_SPENDABLE_SETTINGS,
  type ReportingUnitOfWork,
  type SpendableSettingsReader,
  type SpendableSettingsRow,
} from './ports/index.js';

/** Escritura de los ajustes (`reporting.spendable_setting` y sus categorías) en la unidad de trabajo en curso. */
export interface SpendableSettingsRepository extends SpendableSettingsReader {
  /**
   * Guarda los ajustes si la versión vigente (1 sin fila) es `expectedVersion`; devuelve la fila guardada (versión + 1) o
   * `null` si otra escritura se adelantó (precondición vencida).
   */
  write(
    workspaceId: string,
    value: SpendableSettingsValue,
    expectedVersion: number,
  ): Promise<SpendableSettingsRow | null>;
}

/** AUDIT: un cambio de los ajustes con los valores anterior y nuevo, en la misma unidad de trabajo. */
export interface SpendableSettingsAuditPort {
  updated(entry: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly version: number;
    readonly changes: readonly {
      readonly field: string;
      readonly before: unknown;
      readonly after: unknown;
    }[];
  }): Promise<void>;
}

export interface SpendableSettingsDeps {
  readonly uow: ReportingUnitOfWork;
  readonly repository: SpendableSettingsRepository;
  readonly categories: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly audit: SpendableSettingsAuditPort;
}

const view = (row: SpendableSettingsRow): SpendableSettingsDto => ({
  horizonMode: row.horizonMode,
  subtractEssentials: row.subtractEssentials,
  essentialCategoryIds: [...row.essentialCategoryIds].sort(),
  version: row.version,
});

/** Valores compuestos de auditoría como texto JSON (docs/31 D19). */
const auditValue = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : value;

const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

/**
 * Ajustes del disponible del workspace (openspec add-cash-flow-forecast, decisión 12; D377, D378): los lee todo miembro y
 * los cambia el OWNER (el rol lo aplica la convención `x-required-role: OWNER` del contrato). Concurrencia optimista por
 * versión; idempotente por contenido (sin cambios no se versiona ni se audita); la auditoría con los valores anterior y
 * nuevo va en la misma unidad de trabajo.
 */
export class SpendableSettingsService {
  constructor(private readonly deps: SpendableSettingsDeps) {}

  get(input: {
    readonly userId: string | null;
    readonly workspaceId: string;
  }): Promise<SpendableSettingsDto> {
    return this.deps.uow.run(input, async () =>
      view((await this.deps.repository.read(input.workspaceId)) ?? DEFAULT_SPENDABLE_SETTINGS),
    );
  }

  update(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly expectedVersion: number;
    readonly settings: SpendableSettingsInputDto;
  }): Promise<SpendableSettingsDto> {
    const { workspaceId, userId } = input;
    return this.deps.uow.run({ userId, workspaceId }, async () => {
      const current = (await this.deps.repository.read(workspaceId)) ?? DEFAULT_SPENDABLE_SETTINGS;
      if (current.version !== input.expectedVersion) throw preconditionFailed(current.version);
      const next: SpendableSettingsValue = {
        horizonMode: input.settings.horizonMode,
        subtractEssentials: input.settings.subtractEssentials === true,
        essentialCategoryIds: [...input.settings.essentialCategoryIds],
      };
      const tree = await this.deps.categories.categoryTree({ userId, workspaceId });
      const categories = new Map<string, SettingsCategory>(
        tree.categories.map((c) => [c.categoryId, { kind: c.kind, archived: c.archived }]),
      );
      SpendableSettingsPolicy.validate(next, categories);
      const changes: SettingsChange[] = SpendableSettingsPolicy.changes(current, next);
      if (changes.length === 0) return view(current);
      const saved = await this.deps.repository.write(workspaceId, next, input.expectedVersion);
      if (!saved) {
        const latest = (await this.deps.repository.read(workspaceId)) ?? DEFAULT_SPENDABLE_SETTINGS;
        throw preconditionFailed(latest.version);
      }
      await this.deps.audit.updated({
        workspaceId,
        userId,
        version: saved.version,
        changes: changes.map((c) => ({
          field: c.field,
          before: auditValue(c.before),
          after: auditValue(c.after),
        })),
      });
      return view(saved);
    });
  }
}
