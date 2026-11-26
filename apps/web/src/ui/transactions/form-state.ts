import type { PaymentMethod, TransactionStatus } from '../common/types';
import { newSplitRow, type SplitRow } from './splits';

export type RecordKind = 'EXPENSE' | 'INCOME' | 'REFUND' | 'ADJUSTMENT';

export interface FormState {
  kind: RecordKind;
  accountId: string;
  amount: string;
  transactionDate: string;
  postingDate: string;
  description: string;
  notes: string;
  paymentMethod: PaymentMethod | '';
  counterpartyId: string;
  status: Exclude<TransactionStatus, 'RECONCILED' | 'VOIDED'>;
  refundOfTransactionId: string;
  confirmRefundExceedsOriginal: boolean;
  direction: 'INCREASE' | 'DECREASE';
  reason: string;
  splits: SplitRow[];
}

/**
 * Estado del formulario tras un registro exitoso en el modo «registrar y seguir» (add-quick-capture, decisión 2):
 * conserva el tipo, la cuenta, la fecha y el estado; vacía monto, descripción, contraparte, splits, notas, medio de
 * pago, fecha de posteo, datos de reembolso y ajuste. Los campos personalizados viven en las filas de splits.
 */
export function resetAfterSave(state: FormState): FormState {
  return {
    kind: state.kind,
    accountId: state.accountId,
    transactionDate: state.transactionDate,
    status: state.status,
    amount: '',
    postingDate: '',
    description: '',
    notes: '',
    paymentMethod: '',
    counterpartyId: '',
    refundOfTransactionId: '',
    confirmRefundExceedsOriginal: false,
    direction: 'DECREASE',
    reason: '',
    splits: [newSplitRow()],
  };
}
