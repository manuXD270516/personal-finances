import type { ReactNode } from 'react';
import { badgeStyle, mutedStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { categoryOptions } from '../transactions/catalogs';
import type { Account, Category, CategoryGroup, Counterparty, Tag } from '../common/types';
import type { OriginView } from './logic';
import type { CategoryOrigin, RuleStatus, RuleTrigger } from './types';

/** Estado de una regla: texto + icono decorativo (nunca solo color). */
export function RuleStatusBadge({ status, f }: { status: RuleStatus; f: FormatContext }) {
  const icon = status === 'ACTIVE' ? '●' : status === 'INACTIVE' ? '○' : '▣';
  return (
    <span style={badgeStyle} data-testid="rule-status" data-status={status}>
      <span aria-hidden="true">{icon}</span> {f.t(`status.${status}`)}
    </span>
  );
}

export function TriggerList({ triggers, f }: { triggers: readonly RuleTrigger[]; f: FormatContext }) {
  return <span data-testid="rule-triggers">{triggers.map((t) => f.t(`triggers.${t}`)).join(' · ')}</span>;
}

/** «Categoría: …, por la regla Supermercado (v1)» / «(v1, archivada)»: el origen de un campo clasificado. */
export function OriginText({
  origin,
  f,
  fallback,
}: {
  origin: OriginView | undefined;
  f: FormatContext;
  fallback?: ReactNode;
}) {
  if (!origin) return <>{fallback ?? null}</>;
  return (
    <span data-testid="rule-origin">
      {f.t(origin.archived ? 'origin.byRuleArchived' : 'origin.byRule', {
        name: origin.name,
        version: origin.version,
      })}
    </span>
  );
}

/** Origen de la categoría de un split: «Manual», «Por la regla…», «Contraparte», «Sin categoría» o «Anterior al motor de reglas». */
export function CategoryOriginText({
  origin,
  rule,
  f,
}: {
  origin: CategoryOrigin;
  rule: OriginView | undefined;
  f: FormatContext;
}) {
  if (origin === 'RULE' && rule) return <OriginText origin={rule} f={f} />;
  return <span data-testid="category-origin">{f.t(`origin.${origin}`)}</span>;
}

export function NoteText({ children }: { children: ReactNode }) {
  return <p style={mutedStyle}>{children}</p>;
}

export interface SelectOption {
  readonly id: string;
  readonly label: string;
}

/** Opciones de categoría de ingreso y gasto (una regla puede apuntar a cualquiera; el tipo se valida al evaluar). */
export function allCategoryGroups(
  categories: readonly Category[],
  groups: readonly CategoryGroup[],
  f: FormatContext,
): { group: string; options: { id: string; label: string }[] }[] {
  return (['EXPENSE', 'INCOME'] as const).flatMap((kind) =>
    categoryOptions(categories, groups, kind).map((g) => ({
      group: `${f.t(`kinds.${kind}`)} · ${g.group}`,
      options: g.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  );
}

export const activeOptions = <T extends { id: string; name: string; archivedAt?: string | null }>(
  list: readonly T[],
): SelectOption[] => list.filter((x) => !x.archivedAt).map((x) => ({ id: x.id, label: x.name }));

export const accountOptions = (accounts: readonly Account[]): SelectOption[] =>
  accounts
    .filter((a) => a.status === 'ACTIVE')
    .map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }));

export const tagOptions = (tags: readonly Tag[]): SelectOption[] => activeOptions(tags);
export const counterpartyOptions = (list: readonly Counterparty[]): SelectOption[] => activeOptions(list);
