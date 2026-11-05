import { DomainError } from '@pf/shared-kernel';

/**
 * Puerto común de proveedores de movimientos externos (openspec add-banking-providers, decisiones 1 y 2): bancos,
 * agregadores, APIs de exchange y archivos de historial de exchange. Dominio puro: el descriptor es código versionado
 * y los adapters viven en `infrastructure/banking`. Los montos son SIEMPRE texto decimal exacto (INV-001).
 */

export const PROVIDER_KINDS = ['BANK_API', 'AGGREGATOR', 'EXCHANGE_API', 'EXCHANGE_FILE', 'FAKE'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** NO existe `USERNAME_PASSWORD` (NFR-COMP-008): el registro lo rechaza si alguien lo declara. */
export const CREDENTIAL_MODES = ['NONE', 'API_KEY_SECRET', 'DELEGATED_TOKEN'] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export type TermsStatus = 'VERIFIED' | 'PENDING' | 'REJECTED';
export type FormatStatus = 'VERIFIED' | 'PENDING_SAMPLE' | 'NOT_APPLICABLE';
export type ProviderAvailability = 'AVAILABLE' | 'PENDING_VERIFICATION' | 'UNAVAILABLE';

export const PROVIDER_CAPABILITIES = ['TRADES', 'DEPOSITS', 'WITHDRAWALS', 'REWARDS', 'BALANCES'] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export interface ProviderDescriptor {
  /** Identificador estable del proveedor (`EXCHANGE_API_BINANCE`, `FAKE_EXCHANGE`). */
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  /**
   * Identificador del exchange o institución que firma las referencias externas (`BINANCE`): la API y el archivo del
   * mismo exchange comparten el namespace `imports.provider:<exchange>:<tipo>` (decisión 8).
   */
  readonly exchange: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly credentialMode: CredentialMode;
  /** Hosts a los que puede ir una solicitud (sin redirecciones a otros). */
  readonly allowedHosts: readonly string[];
  readonly termsStatus: TermsStatus;
  /** ADR y fecha de la verificación de los términos (obligatorios si `termsStatus = VERIFIED`). */
  readonly termsAdr: string | null;
  readonly termsVerifiedAt: string | null;
  readonly formatStatus: FormatStatus;
  /** Atribución que la UI debe mostrar junto al proveedor. */
  readonly attribution: string | null;
}

export type ProviderEnvironment = 'local' | 'ci' | 'staging' | 'production';

export interface ProviderRegistryOptions {
  readonly environment: ProviderEnvironment;
  /** `IMPORTS_PROVIDER_FAKE_ENABLED`. */
  readonly fakeEnabled: boolean;
}

/** `FAKE_EXCHANGE` está prohibido en staging y producción: el arranque falla (TC-IMPORTS-BANKING-003). */
export function assertFakeProviderAllowed(options: ProviderRegistryOptions): void {
  if (options.fakeEnabled && (options.environment === 'staging' || options.environment === 'production')) {
    throw new Error('IMPORTS_PROVIDER_FAKE_ENABLED is not allowed in staging or production');
  }
}

/**
 * Disponibilidad de un descriptor: el simulado solo si está habilitado; un proveedor real solo con términos
 * verificados (y, si es un archivo, formato verificado con muestra real).
 */
export function availabilityOf(
  d: ProviderDescriptor,
  options: ProviderRegistryOptions,
): ProviderAvailability {
  if (d.kind === 'FAKE') return options.fakeEnabled ? 'AVAILABLE' : 'UNAVAILABLE';
  if (d.termsStatus === 'REJECTED') return 'UNAVAILABLE';
  if (d.termsStatus === 'PENDING') return 'PENDING_VERIFICATION';
  if (d.kind === 'EXCHANGE_FILE' && d.formatStatus !== 'VERIFIED') return 'PENDING_VERIFICATION';
  return 'AVAILABLE';
}

export class ProviderRegistry {
  private readonly byId: ReadonlyMap<string, ProviderDescriptor>;

  private constructor(
    readonly descriptors: readonly ProviderDescriptor[],
    private readonly options: ProviderRegistryOptions,
  ) {
    this.byId = new Map(descriptors.map((d) => [d.id, d] as const));
  }

  /** Valida cada descriptor al registrar: falla al arrancar y el proveedor no aparece en el catálogo. */
  static create(
    descriptors: readonly ProviderDescriptor[],
    options: ProviderRegistryOptions,
  ): ProviderRegistry {
    assertFakeProviderAllowed(options);
    const seen = new Set<string>();
    for (const d of descriptors) {
      if (!(CREDENTIAL_MODES as readonly string[]).includes(d.credentialMode)) {
        throw new Error(`provider ${d.id}: credential mode ${String(d.credentialMode)} is not allowed`);
      }
      if (seen.has(d.id)) throw new Error(`provider ${d.id} is registered twice`);
      seen.add(d.id);
      if (d.termsStatus === 'VERIFIED' && (d.termsAdr === null || d.termsVerifiedAt === null)) {
        throw new Error(`provider ${d.id}: verified terms need an ADR and a date`);
      }
      if (d.kind !== 'FAKE' && d.kind !== 'EXCHANGE_FILE' && d.credentialMode === 'NONE') {
        throw new Error(`provider ${d.id}: an API provider needs a credential mode`);
      }
      if (d.kind === 'EXCHANGE_FILE' && d.credentialMode !== 'NONE') {
        throw new Error(`provider ${d.id}: a file provider takes no credentials`);
      }
    }
    return new ProviderRegistry(descriptors, options);
  }

  get(id: string): ProviderDescriptor | null {
    return this.byId.get(id) ?? null;
  }

  availability(id: string): ProviderAvailability {
    const d = this.byId.get(id);
    return d ? availabilityOf(d, this.options) : 'UNAVAILABLE';
  }

  /** Catálogo para la API: el simulado solo aparece si está habilitado. */
  catalog(): readonly {
    readonly descriptor: ProviderDescriptor;
    readonly availability: ProviderAvailability;
  }[] {
    return this.descriptors
      .filter((d) => d.kind !== 'FAKE' || this.options.fakeEnabled)
      .map((d) => ({ descriptor: d, availability: availabilityOf(d, this.options) }));
  }

  /** Descriptor de un proveedor habilitado, o `BANKING_PROVIDER_NOT_AVAILABLE` (422). */
  requireAvailable(id: string): ProviderDescriptor {
    const d = this.byId.get(id);
    if (!d || this.availability(id) !== 'AVAILABLE') {
      throw new DomainError('BANKING_PROVIDER_NOT_AVAILABLE', 'the provider is not available').at(
        '/providerId',
      );
    }
    return d;
  }
}

// ───────────────────────────────────────────────────────────── registros externos

export type ExternalRecordType = 'TRADE' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'REWARD' | 'P2P' | 'OTHER';

export interface ExternalLeg {
  readonly asset: string;
  /** Texto decimal exacto, positivo. */
  readonly amount: string;
  readonly direction: 'IN' | 'OUT';
}

export interface ExternalFee {
  readonly asset: string;
  readonly amount: string;
  readonly kind: 'PROVIDER' | 'NETWORK';
}

export interface ExternalRecord {
  readonly type: ExternalRecordType;
  /** Estable por proveedor y tipo. */
  readonly externalId: string;
  /** Instante ISO UTC informado por el proveedor. */
  readonly executedAt: string;
  readonly legs: readonly ExternalLeg[];
  readonly fees: readonly ExternalFee[];
  /** Precio cotizado de un trade: 1 `base` = `price` `quote`. */
  readonly quotedPrice?: { readonly base: string; readonly quote: string; readonly price: string };
  /** Texto del proveedor: no confiable. */
  readonly description: string | null;
  /** Campos crudos (staging, purgables). */
  readonly raw: Readonly<Record<string, string>>;
}

export interface CredentialPermissions {
  readonly read: boolean;
  readonly trade: boolean;
  readonly withdraw: boolean;
  readonly transfer: boolean;
  readonly ipRestricted: boolean | null;
}

/** Solo lectura: lee y nada más (NFR-COMP-008, FR-IMPORTS-013). */
export const isReadOnly = (p: CredentialPermissions): boolean =>
  p.read && !p.trade && !p.withdraw && !p.transfer;

export interface ExternalAsset {
  readonly asset: string;
}

/** Error de un proveedor (no de dominio): el job lo traduce a espera, `NEEDS_ATTENTION` o fallo. */
export type ProviderFailureCode =
  | 'PROVIDER_AUTH_REJECTED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_HOST_NOT_ALLOWED'
  | 'PROVIDER_PAYLOAD_INVALID';

export class ProviderCallError extends Error {
  constructor(
    readonly code: ProviderFailureCode,
    message: string,
    /** Instante ISO hasta el que no se debe volver a llamar (`Retry-After` o la espera publicada). */
    readonly retryNotBefore: string | null = null,
  ) {
    super(message);
    this.name = 'ProviderCallError';
  }
}
