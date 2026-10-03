import { invalidTransition, validation } from './errors.js';
import { normalizeText } from './normalized-text.js';

export type CounterpartyKind =
  | 'MERCHANT'
  | 'PERSON'
  | 'EMPLOYER'
  | 'SERVICE_PROVIDER'
  | 'FINANCIAL_INSTITUTION'
  | 'LENDER'
  | 'EXCHANGE'
  | 'P2P_TRADER'
  | 'GOVERNMENT'
  | 'OTHER';

export const COUNTERPARTY_KINDS: readonly CounterpartyKind[] = [
  'MERCHANT',
  'PERSON',
  'EMPLOYER',
  'SERVICE_PROVIDER',
  'FINANCIAL_INSTITUTION',
  'LENDER',
  'EXCHANGE',
  'P2P_TRADER',
  'GOVERNMENT',
  'OTHER',
];

export const isCounterpartyKind = (v: unknown): v is CounterpartyKind =>
  typeof v === 'string' && (COUNTERPARTY_KINDS as readonly string[]).includes(v);

export const MIN_ALIAS_LENGTH = 3;

/** VO `Alias`: texto visible + forma normalizada (mínimo 3 caracteres normalizados, design §5). */
export class Alias {
  private constructor(
    readonly text: string,
    readonly normalized: string,
  ) {}

  static of(raw: string, pointer = '/aliases'): Alias {
    const text = raw.trim().replace(/\s+/gu, ' ');
    const normalized = normalizeText(text);
    if (normalized.length < MIN_ALIAS_LENGTH || text.length > 120) {
      throw validation(`an alias must have ${MIN_ALIAS_LENGTH}..120 characters`, pointer);
    }
    return new Alias(text, normalized);
  }
}

/** Lista de alias sin repetidos (por forma normalizada), en el orden recibido. */
export function aliasList(raw: readonly string[]): Alias[] {
  const seen = new Set<string>();
  const out: Alias[] = [];
  raw.forEach((r, i) => {
    const a = Alias.of(r, `/aliases/${i}`);
    if (!seen.has(a.normalized)) {
      seen.add(a.normalized);
      out.push(a);
    }
  });
  return out;
}

export interface CounterpartySnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: CounterpartyKind;
  readonly icon: string | null;
  readonly defaultCategoryId: string | null;
  readonly aliases: readonly string[];
  readonly notes: string | null;
  readonly website: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
}

export interface CounterpartyPatch {
  readonly name?: string;
  readonly kind?: CounterpartyKind;
  readonly icon?: string | null;
  readonly defaultCategoryId?: string | null;
  readonly aliases?: readonly string[];
  readonly notes?: string | null;
  readonly website?: string | null;
}

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/gu, ' ');
  if (name.length < 1 || name.length > 120) throw validation('name must have 1..120 characters', '/name');
  return name;
}

/** AR `Counterparty` (design §8): tipo, alias únicos, categoría por defecto; archivado/desarchivado. */
export class Counterparty {
  private constructor(private s: CounterpartySnapshot) {}

  static create(input: {
    id: string;
    workspaceId: string;
    name: string;
    kind?: CounterpartyKind;
    icon?: string | null;
    defaultCategoryId?: string | null;
    aliases?: readonly string[];
    notes?: string | null;
    website?: string | null;
  }): Counterparty {
    return new Counterparty({
      id: input.id,
      workspaceId: input.workspaceId,
      name: checkName(input.name),
      kind: input.kind ?? 'OTHER',
      icon: input.icon ?? null,
      defaultCategoryId: input.defaultCategoryId ?? null,
      aliases: aliasList(input.aliases ?? []).map((a) => a.text),
      notes: input.notes ?? null,
      website: input.website ?? null,
      archivedAt: null,
      version: 1,
    });
  }

  static restore(s: CounterpartySnapshot): Counterparty {
    return new Counterparty({ ...s, aliases: [...s.aliases] });
  }

  get id(): string {
    return this.s.id;
  }
  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get name(): string {
    return this.s.name;
  }
  get normalizedName(): string {
    return normalizeText(this.s.name);
  }
  get kind(): CounterpartyKind {
    return this.s.kind;
  }
  get icon(): string | null {
    return this.s.icon;
  }
  get defaultCategoryId(): string | null {
    return this.s.defaultCategoryId;
  }
  get aliases(): readonly string[] {
    return this.s.aliases;
  }
  get normalizedAliases(): readonly string[] {
    return this.s.aliases.map((a) => normalizeText(a));
  }
  get notes(): string | null {
    return this.s.notes;
  }
  get website(): string | null {
    return this.s.website;
  }
  get archivedAt(): string | null {
    return this.s.archivedAt;
  }
  get isArchived(): boolean {
    return this.s.archivedAt !== null;
  }
  get version(): number {
    return this.s.version;
  }

  snapshot(): CounterpartySnapshot {
    return { ...this.s, aliases: [...this.s.aliases] };
  }

  update(patch: CounterpartyPatch): boolean {
    const next: CounterpartySnapshot = {
      ...this.s,
      ...(patch.name === undefined ? {} : { name: checkName(patch.name) }),
      ...(patch.kind === undefined ? {} : { kind: patch.kind }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
      ...(patch.defaultCategoryId === undefined ? {} : { defaultCategoryId: patch.defaultCategoryId }),
      ...(patch.aliases === undefined ? {} : { aliases: aliasList(patch.aliases).map((a) => a.text) }),
      ...(patch.notes === undefined ? {} : { notes: patch.notes }),
      ...(patch.website === undefined ? {} : { website: patch.website }),
    };
    const same = JSON.stringify({ ...next, version: 0 }) === JSON.stringify({ ...this.s, version: 0 });
    if (same) return false;
    this.s = { ...next, version: this.s.version + 1 };
    return true;
  }

  archive(at: string): void {
    if (this.isArchived) throw invalidTransition('counterparty is already archived');
    this.s = { ...this.s, archivedAt: at, version: this.s.version + 1 };
  }

  unarchive(): void {
    if (!this.isArchived) throw invalidTransition('counterparty is not archived');
    this.s = { ...this.s, archivedAt: null, version: this.s.version + 1 };
  }
}

export interface CounterpartyMatch {
  readonly counterparty: Counterparty;
  readonly matchedOn: 'NAME' | 'ALIAS';
  readonly matchedText: string;
}

/**
 * DS `CounterpartyMatcher` (design §8): busca nombres y alias de counterparties ACTIVAS contenidos en la descripción
 * normalizada; desempate por el texto coincidente más largo (alias más largo), luego por nombre. Solo sugiere.
 */
export const CounterpartyMatcher = {
  match(description: string, candidates: readonly Counterparty[]): CounterpartyMatch | null {
    const text = normalizeText(description);
    if (text.length === 0) return null;
    let best: CounterpartyMatch | null = null;
    let bestLen = -1;
    for (const c of candidates) {
      if (c.isArchived) continue;
      const options: { on: 'NAME' | 'ALIAS'; norm: string; text: string }[] = [
        { on: 'NAME', norm: c.normalizedName, text: c.name },
        ...c.aliases.map((a) => ({ on: 'ALIAS' as const, norm: normalizeText(a), text: a })),
      ];
      for (const o of options) {
        if (o.norm.length < MIN_ALIAS_LENGTH || !text.includes(o.norm)) continue;
        const better =
          o.norm.length > bestLen ||
          (o.norm.length === bestLen && best !== null && c.name.localeCompare(best.counterparty.name) < 0);
        if (better) {
          best = { counterparty: c, matchedOn: o.on, matchedText: o.text };
          bestLen = o.norm.length;
        }
      }
    }
    return best;
  },
} as const;
