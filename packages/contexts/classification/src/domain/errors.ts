import { DomainError } from '@pf/shared-kernel';

/** `NAME_TAKEN` con el id del recurso activo que ya usa el nombre (creación inline, design §8). */
export class NameTakenError extends DomainError {
  constructor(
    readonly existingId: string,
    what: string,
  ) {
    super('NAME_TAKEN', `an active ${what} already uses this name`);
  }
}

export const notFound = (what: string): DomainError =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} not found`);

export const referenceNotFound = (what: string, pointer: string): DomainError =>
  new DomainError('REFERENCE_NOT_FOUND', `${what} not found in this workspace`).at(pointer);

export const invalidTransition = (detail: string): DomainError =>
  new DomainError('INVALID_STATUS_TRANSITION', detail);

export const validation = (detail: string, pointer: string): DomainError =>
  new DomainError('VALIDATION_FAILED', detail).at(pointer);

/** `CATEGORY_MERGED` indica la destino (`details.mergedInto`) en la que se fusionó la categoría. */
export const categoryMerged = (mergedIntoId: string | null): DomainError =>
  new DomainError('CATEGORY_MERGED', 'the category was merged into another one', {
    details: { mergedInto: mergedIntoId },
  });

/** `COUNTERPARTY_MERGED` indica la destino (`details.mergedInto`) en la que se fusionó la contraparte. */
export const counterpartyMerged = (mergedIntoId: string | null): DomainError =>
  new DomainError('COUNTERPARTY_MERGED', 'the counterparty was merged into another one', {
    details: { mergedInto: mergedIntoId },
  });
