import { invalidTransition, validation } from './errors.js';
import { normalizeText } from './normalized-text.js';

export interface TagSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly color: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
}

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/gu, ' ');
  if (name.length < 1 || name.length > 50) throw validation('name must have 1..50 characters', '/name');
  return name;
}

/** AR `Tag` (design §1): nombre único normalizado entre activos, color, archivado/desarchivado. */
export class Tag {
  private constructor(private s: TagSnapshot) {}

  static create(input: { id: string; workspaceId: string; name: string; color?: string | null }): Tag {
    return new Tag({
      id: input.id,
      workspaceId: input.workspaceId,
      name: checkName(input.name),
      color: input.color ?? null,
      archivedAt: null,
      version: 1,
    });
  }

  static restore(s: TagSnapshot): Tag {
    return new Tag({ ...s });
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
  get color(): string | null {
    return this.s.color;
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

  snapshot(): TagSnapshot {
    return { ...this.s };
  }

  update(patch: { name?: string; color?: string | null }): boolean {
    const name = patch.name === undefined ? this.s.name : checkName(patch.name);
    const color = patch.color === undefined ? this.s.color : patch.color;
    if (name === this.s.name && color === this.s.color) return false;
    this.s = { ...this.s, name, color, version: this.s.version + 1 };
    return true;
  }

  archive(at: string): void {
    if (this.isArchived) throw invalidTransition('tag is already archived');
    this.s = { ...this.s, archivedAt: at, version: this.s.version + 1 };
  }

  unarchive(): void {
    if (!this.isArchived) throw invalidTransition('tag is not archived');
    this.s = { ...this.s, archivedAt: null, version: this.s.version + 1 };
  }
}
