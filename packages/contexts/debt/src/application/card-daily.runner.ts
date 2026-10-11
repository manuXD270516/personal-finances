import { Instant, LocalDate } from '@pf/shared-kernel';
import { CardEngine } from './card-engine.js';
import type { CardDeps } from './card-ports.js';

export interface CardDailyResult {
  readonly cards: number;
  readonly issued: number;
  readonly reminders: number;
  readonly failed: readonly { readonly cardId: string; readonly error: string }[];
}

/**
 * Job `debt.card-daily` (openspec add-credit-cards, decisiones 5 y 8): por workspace, con "hoy" en su zona horaria,
 * emite UNA vez los estados de cuenta de los ciclos cerrados (con el hecho `debt.CardStatementIssued.v1` y la
 * expectativa exacta del plan de pago), publica los recordatorios de vencimiento (uno por cuenta y cierre), persiste el
 * último estado calculado para listar y es la red de seguridad de las expectativas y de los umbrales de límites
 * compartidos (efecto de la tasa). Repetirlo o ejecutarlo en paralelo es inocuo (`FOR UPDATE` de la tarjeta y claves
 * únicas `(cuenta, cierre)`).
 */
export class CardDailyService {
  private readonly engine: CardEngine;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
  }

  async runWorkspace(workspaceId: string): Promise<CardDailyResult> {
    const { deps } = this;
    const ids = await deps.uow.run(workspaceId, () => deps.cards.activeCardIds(workspaceId));
    let issued = 0;
    let reminders = 0;
    const failed: { cardId: string; error: string }[] = [];
    for (const cardId of ids) {
      try {
        const result = await deps.uow.run(workspaceId, () => this.runCard(workspaceId, cardId));
        issued += result.issued;
        reminders += result.reminders;
      } catch (err) {
        failed.push({ cardId, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      }
    }
    return { cards: ids.length, issued, reminders, failed };
  }

  private async runCard(workspaceId: string, cardId: string): Promise<{ issued: number; reminders: number }> {
    const { deps } = this;
    const card = await deps.cards.findById(workspaceId, cardId, { lock: 'update' });
    if (!card || card.status !== 'ACTIVE') return { issued: 0, reminders: 0 };
    const clock = await this.engine.clockOf(workspaceId);
    const userId = card.snapshot.createdBy;
    const before = card.version;
    const createdOn = LocalDate.ofInstant(Instant.parse(card.snapshot.createdAt), clock.timeZone);
    let views = await this.engine.loadViews(card, clock);
    let issued = 0;
    // Emisión: ciclos cerrados desde el registro (el último cerrado al registrar se emitió en el alta).
    for (const v of views) {
      for (const cv of v.cycles) {
        if (cv.open || cv.record) continue;
        if (cv.cycle.closing.compare(createdOn) < 0) continue;
        if (await this.engine.issueCycle(card, v, cv, clock)) issued += 1;
      }
    }
    if (issued > 0) views = await this.engine.loadViews(card, clock);
    // Planes de cuotas: completar los que ya facturaron su última cuota.
    for (const v of views) {
      const lastIssued = v.cycles
        .filter((c) => c.record)
        .map((c) => c.cycle.closing)
        .sort((a, b) => a.compare(b))
        .at(-1);
      for (const plan of v.plans) {
        if (plan.completeIfBilled(lastIssued ?? null, clock.at)) await deps.plans.save(plan);
      }
    }
    // Estado persistido (solo para listar) y recordatorios.
    let reminded = 0;
    for (const v of views) {
      for (const cv of v.cycles) {
        if (!cv.record || !cv.standing) continue;
        if (cv.record.status !== cv.standing.status && cv.status !== 'OPEN') {
          await deps.statements.updateStatus(workspaceId, cv.record.id, cv.standing.status);
        }
        if (await this.engine.remindCycle(card, v, cv, clock)) reminded += 1;
      }
    }
    // Red de seguridad: expectativas del plan y umbrales (efecto de la tasa en límites compartidos).
    await this.engine.evaluateUtilization(card, views, clock);
    for (const v of views) await this.engine.syncPlan(card, v, clock, userId);
    if (card.version !== before) {
      if (!(await deps.cards.save(card, userId))) {
        throw new Error(`credit card ${card.id} changed concurrently`);
      }
      card.markPersisted();
    }
    return { issued, reminders: reminded };
  }
}
