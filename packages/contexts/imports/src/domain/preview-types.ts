/**
 * Datos de la vista previa que viajan con la fila (openspec add-import-pipeline, decisiones 9 y 13): candidatos de
 * duplicado con puntaje y candidatas de compromisos. Dominio puro; los llena el pipeline y los edita el usuario.
 */

export type CandidateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** Candidato de movimiento existente para un posible duplicado, con su puntaje y las señales que lo componen. */
export interface RowCandidate {
  readonly transactionId: string;
  readonly kind: string | null;
  readonly date: string | null;
  readonly amount: { readonly amount: string; readonly currency: string } | null;
  readonly description: string | null;
  /** Texto decimal con 4 decimales (`0.9000`). */
  readonly score: string;
  readonly confidence: CandidateConfidence;
  readonly signals: {
    readonly amount: string;
    readonly date: string;
    readonly description: string;
    readonly counterparty: string;
    readonly origin: string;
  };
  /** El sistema lo vinculó de entrada (único candidato de confianza alta); el usuario puede cambiarlo. */
  readonly preselected: boolean;
}

/** Ocurrencia de compromiso candidata para la fila (hasta 3). */
export interface OccurrenceCandidateEntry {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly dueDate: string;
  readonly score: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  readonly ambiguous: boolean;
}

/** Vínculo con una ocurrencia confirmado por el usuario (D121) y, tras persistir, su resultado. */
export interface OccurrenceLinkState {
  readonly occurrenceId: string;
  /** `LINKED`: se vinculó; `SKIPPED`: la ocurrencia ya se había resuelto (`IMPORT_OCCURRENCE_LINK_SKIPPED`). */
  readonly outcome?: 'LINKED' | 'SKIPPED';
}
