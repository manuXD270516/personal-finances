export type MoneyErrorCode =
  | 'MONEY_INVALID_AMOUNT'
  | 'MONEY_SCALE_EXCEEDED'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_CURRENCY'
  | 'INVALID_ALLOCATION'
  | 'INVALID_RATE';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MoneyError';
    this.code = code;
  }
}
