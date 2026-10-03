import { currency, DomainError, type Currency } from '@pf/shared-kernel';
import type { CurrencyKind } from './fx-types.js';

export interface CurrencyDefinitionState {
  readonly code: string;
  readonly kind: CurrencyKind;
  readonly name: string;
  readonly scale: number;
  readonly symbol: string | null;
  readonly isActive: boolean;
  /** ¿Hay montos o tasas que ya usan la moneda? (la escala queda congelada, FR-FX-001). */
  readonly inUse: boolean;
}

/**
 * AR `CurrencyDefinition` (fx/market-rates, FR-FX-001): código, tipo y escala canónica. La escala es inmutable una vez
 * usada: cambiarla reinterpretaría montos históricos (INV-003). En Phase 1 el catálogo es global y de solo lectura
 * para la aplicación (datos de referencia por migración); el trigger `fx.currency_scale_immutable` es la segunda
 * barrera en BD.
 */
export class CurrencyDefinition {
  private constructor(private readonly state: CurrencyDefinitionState) {
    Object.freeze(this);
  }

  static of(state: CurrencyDefinitionState): CurrencyDefinition {
    currency(state.code, state.scale);
    return new CurrencyDefinition(state);
  }

  get code(): string {
    return this.state.code;
  }
  get kind(): CurrencyKind {
    return this.state.kind;
  }
  get scale(): number {
    return this.state.scale;
  }
  get snapshot(): CurrencyDefinitionState {
    return this.state;
  }

  /** VO de dinero del shared-kernel con la escala canónica. */
  toCurrency(): Currency {
    return currency(this.state.code, this.state.scale);
  }

  /** Nueva definición con otra escala; prohibido si la moneda ya se usó (INV-003). */
  withScale(scale: number): CurrencyDefinition {
    if (scale === this.state.scale) return this;
    if (this.state.inUse) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `the scale of ${this.state.code} cannot change once it is used`,
      ).at('/scale');
    }
    return CurrencyDefinition.of({ ...this.state, scale });
  }
}
