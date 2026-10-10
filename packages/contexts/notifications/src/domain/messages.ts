import type { NotificationLocale } from './types.js';

/**
 * Catálogo de mensajes versionado en código (openspec add-alerts, design decisiones 3 y 8): `message_key` + params se
 * guardan en la notificación y el texto se renderiza al leer / al despachar en el idioma del destinatario. Español es
 * el respaldo. Marcadores `{nombre}`; un test verifica que toda clave existe en es, en y pt y que los marcadores
 * coinciden entre idiomas. Las plantillas `email.*.basic` NO pueden llevar montos, saldos ni nombres (FR-NOTIFY-006).
 */
export type MessageCatalog = Readonly<Record<string, string>>;

const es: MessageCatalog = {
  // in-app: umbral de presupuesto
  'inapp.budget_threshold.title': 'Alerta de presupuesto: {target} alcanzó el {threshold} %',
  'inapp.budget_threshold.body': 'En {period} llevas {actual} de {reference} {currency} ({utilization} %).',
  'inapp.budget_threshold.also': 'También se cruzaron los umbrales {also}.',
  'inapp.budget_threshold.partial':
    'Cifra parcial: parte del gasto no tiene tasa de cambio para valorarse en {currency}.',
  'inapp.budget_threshold.unknown_target': 'una línea del presupuesto',
  // in-app: cierre pendiente
  'inapp.month_close_pending.title': 'El mes {period} está pendiente de cierre',
  'inapp.month_close_pending.body':
    'Terminó el {periodEnd} y sigue abierto. Revisa el checklist y ciérralo para congelar sus cifras.',
  // email: umbral de presupuesto
  'email.budget_threshold.subject': 'Tienes una alerta de presupuesto',
  'email.budget_threshold.basic': 'Una línea de tu presupuesto de {period} alcanzó el {threshold} %.',
  'email.budget_threshold.detailed':
    'La línea {target} de tu presupuesto de {period} alcanzó el {threshold} %: llevas {actual} de {reference} {currency}.',
  // email: cierre pendiente
  'email.month_close_pending.subject': 'Tienes un mes pendiente de cierre',
  'email.month_close_pending.basic': 'El mes {period} terminó y sigue pendiente de cierre.',
  'email.month_close_pending.detailed': 'El mes {period} terminó el {periodEnd} y sigue pendiente de cierre.',
  // in-app: recurrencias
  'inapp.recurring_payment_upcoming.title': 'Pago próximo: {name}',
  'inapp.recurring_payment_upcoming.body': 'Vence el {dueDate}: {amount}.',
  'inapp.recurring_payment_upcoming.body_variable': 'Vence el {dueDate}. El monto es variable.',
  'inapp.recurring_approval_required.title': 'Por aprobar: {name}',
  'inapp.recurring_approval_required.body': 'La ocurrencia del {dueDate} ({amount}) espera tu aprobación.',
  'inapp.recurring_approval_required.body_variable':
    'La ocurrencia del {dueDate} espera tu aprobación. El monto es variable.',
  // email: recurrencias (basic sin nombre ni monto; detailed con ambos)
  'email.recurring_payment_upcoming.subject': 'Tienes un pago próximo',
  'email.recurring_payment_upcoming.basic': 'Un compromiso recurrente vence el {dueDate}.',
  'email.recurring_payment_upcoming.detailed': '{name} vence el {dueDate}: {amount}.',
  'email.recurring_payment_upcoming.detailed_variable': '{name} vence el {dueDate}. El monto es variable.',
  'email.recurring_approval_required.subject': 'Tienes una ocurrencia por aprobar',
  'email.recurring_approval_required.basic': 'Una ocurrencia recurrente del {dueDate} espera tu aprobación.',
  'email.recurring_approval_required.detailed': '{name} del {dueDate} ({amount}) espera tu aprobación.',
  'email.recurring_approval_required.detailed_variable':
    '{name} del {dueDate} espera tu aprobación. El monto es variable.',
  // email: común
  'email.cta': 'Ver la notificación',
  'email.footer':
    'Recibes este aviso porque tienes activadas las notificaciones por email. Puedes cambiarlo en tus preferencias.',
  'email.preferences': 'Preferencias de notificaciones',
};

const en: MessageCatalog = {
  'inapp.budget_threshold.title': 'Budget alert: {target} reached {threshold} %',
  'inapp.budget_threshold.body':
    'In {period} you are at {actual} of {reference} {currency} ({utilization} %).',
  'inapp.budget_threshold.also': 'The {also} thresholds were also crossed.',
  'inapp.budget_threshold.partial':
    'Partial figure: part of the spending has no exchange rate to be valued in {currency}.',
  'inapp.budget_threshold.unknown_target': 'a budget line',
  'inapp.month_close_pending.title': 'The month {period} is pending close',
  'inapp.month_close_pending.body':
    'It ended on {periodEnd} and is still open. Review the checklist and close it to freeze its figures.',
  'email.budget_threshold.subject': 'You have a budget alert',
  'email.budget_threshold.basic': 'A line of your {period} budget reached {threshold} %.',
  'email.budget_threshold.detailed':
    'The {target} line of your {period} budget reached {threshold} %: you are at {actual} of {reference} {currency}.',
  'email.month_close_pending.subject': 'You have a month pending close',
  'email.month_close_pending.basic': 'The month {period} has ended and is still pending close.',
  'email.month_close_pending.detailed': 'The month {period} ended on {periodEnd} and is still pending close.',
  'inapp.recurring_payment_upcoming.title': 'Upcoming payment: {name}',
  'inapp.recurring_payment_upcoming.body': 'Due on {dueDate}: {amount}.',
  'inapp.recurring_payment_upcoming.body_variable': 'Due on {dueDate}. The amount is variable.',
  'inapp.recurring_approval_required.title': 'Needs approval: {name}',
  'inapp.recurring_approval_required.body':
    'The occurrence of {dueDate} ({amount}) is waiting for your approval.',
  'inapp.recurring_approval_required.body_variable':
    'The occurrence of {dueDate} is waiting for your approval. The amount is variable.',
  'email.recurring_payment_upcoming.subject': 'You have an upcoming payment',
  'email.recurring_payment_upcoming.basic': 'A recurring commitment is due on {dueDate}.',
  'email.recurring_payment_upcoming.detailed': '{name} is due on {dueDate}: {amount}.',
  'email.recurring_payment_upcoming.detailed_variable': '{name} is due on {dueDate}. The amount is variable.',
  'email.recurring_approval_required.subject': 'You have an occurrence to approve',
  'email.recurring_approval_required.basic':
    'A recurring occurrence of {dueDate} is waiting for your approval.',
  'email.recurring_approval_required.detailed':
    '{name} of {dueDate} ({amount}) is waiting for your approval.',
  'email.recurring_approval_required.detailed_variable':
    '{name} of {dueDate} is waiting for your approval. The amount is variable.',
  'email.cta': 'View the notification',
  'email.footer':
    'You receive this notice because email notifications are turned on. You can change it in your preferences.',
  'email.preferences': 'Notification preferences',
};

const pt: MessageCatalog = {
  'inapp.budget_threshold.title': 'Alerta de orçamento: {target} atingiu {threshold} %',
  'inapp.budget_threshold.body':
    'Em {period} você está em {actual} de {reference} {currency} ({utilization} %).',
  'inapp.budget_threshold.also': 'Os limites {also} também foram ultrapassados.',
  'inapp.budget_threshold.partial':
    'Valor parcial: parte dos gastos não tem taxa de câmbio para ser avaliada em {currency}.',
  'inapp.budget_threshold.unknown_target': 'uma linha do orçamento',
  'inapp.month_close_pending.title': 'O mês {period} está pendente de fechamento',
  'inapp.month_close_pending.body':
    'Terminou em {periodEnd} e continua aberto. Revise o checklist e feche-o para congelar seus números.',
  'email.budget_threshold.subject': 'Você tem um alerta de orçamento',
  'email.budget_threshold.basic': 'Uma linha do seu orçamento de {period} atingiu {threshold} %.',
  'email.budget_threshold.detailed':
    'A linha {target} do seu orçamento de {period} atingiu {threshold} %: você está em {actual} de {reference} {currency}.',
  'email.month_close_pending.subject': 'Você tem um mês pendente de fechamento',
  'email.month_close_pending.basic': 'O mês {period} terminou e continua pendente de fechamento.',
  'email.month_close_pending.detailed':
    'O mês {period} terminou em {periodEnd} e continua pendente de fechamento.',
  'inapp.recurring_payment_upcoming.title': 'Pagamento próximo: {name}',
  'inapp.recurring_payment_upcoming.body': 'Vence em {dueDate}: {amount}.',
  'inapp.recurring_payment_upcoming.body_variable': 'Vence em {dueDate}. O valor é variável.',
  'inapp.recurring_approval_required.title': 'Para aprovar: {name}',
  'inapp.recurring_approval_required.body': 'A ocorrência de {dueDate} ({amount}) aguarda sua aprovação.',
  'inapp.recurring_approval_required.body_variable':
    'A ocorrência de {dueDate} aguarda sua aprovação. O valor é variável.',
  'email.recurring_payment_upcoming.subject': 'Você tem um pagamento próximo',
  'email.recurring_payment_upcoming.basic': 'Um compromisso recorrente vence em {dueDate}.',
  'email.recurring_payment_upcoming.detailed': '{name} vence em {dueDate}: {amount}.',
  'email.recurring_payment_upcoming.detailed_variable': '{name} vence em {dueDate}. O valor é variável.',
  'email.recurring_approval_required.subject': 'Você tem uma ocorrência para aprovar',
  'email.recurring_approval_required.basic': 'Uma ocorrência recorrente de {dueDate} aguarda sua aprovação.',
  'email.recurring_approval_required.detailed': '{name} de {dueDate} ({amount}) aguarda sua aprovação.',
  'email.recurring_approval_required.detailed_variable':
    '{name} de {dueDate} aguarda sua aprovação. O valor é variável.',
  'email.cta': 'Ver a notificação',
  'email.footer':
    'Você recebe este aviso porque as notificações por email estão ativadas. Você pode alterá-lo nas suas preferências.',
  'email.preferences': 'Preferências de notificações',
};

export const MESSAGE_CATALOGS: Readonly<Record<NotificationLocale, MessageCatalog>> = { es, en, pt };

/** Tag BCP 47 con el que se formatean números y fechas de cada idioma (NFR-USAB-002). */
export const FORMAT_LOCALE: Readonly<Record<NotificationLocale, string>> = {
  es: 'es-BO',
  en: 'en-US',
  pt: 'pt-BR',
};

/** Marcadores `{nombre}` de una plantilla. */
export const placeholdersOf = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
