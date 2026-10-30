import type { VerifySemaphore } from '../application/ports/index.js';

/** Semáforo por proceso (`DOCUMENT_VERIFY_MAX_CONCURRENCY`, 2 por defecto): acota la memoria de la verificación. */
export class CountingSemaphore implements VerifySemaphore {
  private inflight = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.inflight >= this.max) return false;
    this.inflight += 1;
    return true;
  }

  release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  /** Verificaciones en curso (métrica `documents_verify_inflight`). */
  get active(): number {
    return this.inflight;
  }
}
