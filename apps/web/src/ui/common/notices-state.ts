/**
 * Estado puro de la región de avisos (change `add-quick-capture`, decisión 4): hasta `MAX_NOTICES` avisos visibles; al
 * entrar uno más sale el más antiguo. Sin temporizadores (WCAG 2.2.1) y sin persistencia entre documentos.
 */

export const MAX_NOTICES = 3;

export type NoticeTone = 'success' | 'info' | 'warning' | 'error';

export interface NoticeAction {
  readonly key: string;
  readonly label: string;
  /** Si hay `href`, la acción es un enlace (navega); si no, un botón con `onAction`. */
  readonly href?: string;
  readonly onAction?: () => void;
  readonly disabled?: boolean;
}

export interface Notice {
  readonly id: string;
  readonly text: string;
  readonly tone: NoticeTone;
  readonly actions: readonly NoticeAction[];
}

export type NoticeInput = Pick<Notice, 'text'> & Partial<Pick<Notice, 'tone' | 'actions'>>;

export type NoticesAction =
  | { readonly type: 'push'; readonly notice: Notice }
  | { readonly type: 'update'; readonly id: string; readonly patch: Partial<Omit<Notice, 'id'>> }
  | { readonly type: 'dismiss'; readonly id: string };

export function noticesReducer(state: readonly Notice[], action: NoticesAction): readonly Notice[] {
  switch (action.type) {
    case 'push': {
      const next = [...state, action.notice];
      return next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
    }
    case 'update':
      return state.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n));
    case 'dismiss':
      return state.filter((n) => n.id !== action.id);
  }
}

/**
 * Texto que se anuncia con `ariaNotify`: solo el texto visible del aviso; con acciones disponibles se agrega el sufijo
 * (guía `persistent-toast-notifications`).
 */
export function announcementOf(text: string, hasActions: boolean, actionsAvailable: string): string {
  return hasActions ? `${text}. ${actionsAvailable}` : text;
}
