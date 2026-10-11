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
  // in-app: suscripciones
  'inapp.subscription_renewal.title': 'Renovación próxima: {provider}',
  'inapp.subscription_renewal.body': 'Se renueva el {renewalDate} por {price}. Cuenta de pago: {account}.',
  'inapp.subscription_renewal.plan': 'Plan {plan}.',
  'inapp.subscription_renewal.charge': 'Cargo estimado: {charge}.',
  'inapp.subscription_renewal.approval': 'Requiere tu aprobación.',
  'inapp.subscription_trial_ending.title':
    'El trial de {provider} termina el {trialEndsOn}; primer cobro {price}',
  'inapp.subscription_trial_ending.body':
    'Cancélalo antes de esa fecha para evitar el cobro. Cuenta de pago: {account}.',
  'inapp.subscription_price_change.title': 'Posible cambio de precio: {provider}',
  'inapp.subscription_price_change.body':
    'El precio pasó de {previous} a {next} ({percent} %) desde el {effectiveFrom}. Acepta o rechaza la propuesta.',
  // email: suscripciones (basic sin nombre, plan, cuenta ni monto; detailed con ellos)
  'email.subscription_renewal.subject': 'Tienes una renovación de suscripción próxima',
  'email.subscription_renewal.basic': 'Una de tus suscripciones se renueva en {days} días.',
  'email.subscription_renewal.detailed': '{provider} se renueva el {renewalDate}: {price} con {account}.',
  'email.subscription_trial_ending.subject': 'Tienes un trial por terminar',
  'email.subscription_trial_ending.basic': 'El trial de una de tus suscripciones termina en {days} días.',
  'email.subscription_trial_ending.detailed':
    'El trial de {provider} termina el {trialEndsOn}; primer cobro {price}.',
  'email.subscription_price_change.subject': 'Detectamos un posible cambio de precio',
  'email.subscription_price_change.basic': 'Una de tus suscripciones podría haber cambiado de precio.',
  'email.subscription_price_change.detailed':
    '{provider}: el precio pasó de {previous} a {next} ({percent} %) desde el {effectiveFrom}.',
  // in-app: tarjetas de crédito
  'inapp.card_payment_due.title': 'Vencimiento de {card} ({currency}): {dueDate}',
  'inapp.card_payment_due.body':
    'Para no pagar intereses faltan {noInterest}; el pago mínimo pendiente es {minimum}.',
  'inapp.card_utilization.title': '{card} alcanzó el {threshold} % de su límite',
  'inapp.card_utilization.body': 'Utilización actual: {utilization} % ({used} de {limit}).',
  // email: tarjetas (basic sin nombre, monedas ni montos; detailed con ellos)
  'email.card_payment_due.subject': 'Tienes un vencimiento de tarjeta',
  'email.card_payment_due.basic': 'Una de tus tarjetas de crédito vence el {dueDate}.',
  'email.card_payment_due.detailed':
    'El estado de cuenta de {card} ({currency}) vence el {dueDate}: faltan {noInterest} para no pagar intereses.',
  'email.card_utilization.subject': 'Tienes un aviso de uso de tarjeta',
  'email.card_utilization.basic': 'Una de tus tarjetas de crédito alcanzó el {threshold} % de su límite.',
  'email.card_utilization.detailed':
    '{card} alcanzó el {threshold} % de su límite: utilización {utilization} % ({used} de {limit}).',
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
  'inapp.subscription_renewal.title': 'Upcoming renewal: {provider}',
  'inapp.subscription_renewal.body': 'Renews on {renewalDate} for {price}. Payment account: {account}.',
  'inapp.subscription_renewal.plan': 'Plan {plan}.',
  'inapp.subscription_renewal.charge': 'Estimated charge: {charge}.',
  'inapp.subscription_renewal.approval': 'It needs your approval.',
  'inapp.subscription_trial_ending.title': 'The {provider} trial ends on {trialEndsOn}; first charge {price}',
  'inapp.subscription_trial_ending.body':
    'Cancel before that date to avoid the charge. Payment account: {account}.',
  'inapp.subscription_price_change.title': 'Possible price change: {provider}',
  'inapp.subscription_price_change.body':
    'The price went from {previous} to {next} ({percent} %) since {effectiveFrom}. Accept or reject the proposal.',
  'email.subscription_renewal.subject': 'You have an upcoming subscription renewal',
  'email.subscription_renewal.basic': 'One of your subscriptions renews in {days} days.',
  'email.subscription_renewal.detailed': '{provider} renews on {renewalDate}: {price} with {account}.',
  'email.subscription_trial_ending.subject': 'You have a trial about to end',
  'email.subscription_trial_ending.basic': 'The trial of one of your subscriptions ends in {days} days.',
  'email.subscription_trial_ending.detailed':
    'The {provider} trial ends on {trialEndsOn}; first charge {price}.',
  'email.subscription_price_change.subject': 'We detected a possible price change',
  'email.subscription_price_change.basic': 'One of your subscriptions may have changed its price.',
  'email.subscription_price_change.detailed':
    '{provider}: the price went from {previous} to {next} ({percent} %) since {effectiveFrom}.',
  'inapp.card_payment_due.title': '{card} ({currency}) due on {dueDate}',
  'inapp.card_payment_due.body':
    'To avoid interest you still need to pay {noInterest}; the minimum payment still due is {minimum}.',
  'inapp.card_utilization.title': '{card} reached {threshold} % of its limit',
  'inapp.card_utilization.body': 'Current utilization: {utilization} % ({used} of {limit}).',
  'email.card_payment_due.subject': 'You have a card payment due',
  'email.card_payment_due.basic': 'One of your credit cards is due on {dueDate}.',
  'email.card_payment_due.detailed':
    'The statement of {card} ({currency}) is due on {dueDate}: {noInterest} left to avoid interest.',
  'email.card_utilization.subject': 'You have a card usage alert',
  'email.card_utilization.basic': 'One of your credit cards reached {threshold} % of its limit.',
  'email.card_utilization.detailed':
    '{card} reached {threshold} % of its limit: utilization {utilization} % ({used} of {limit}).',
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
  'inapp.subscription_renewal.title': 'Renovação próxima: {provider}',
  'inapp.subscription_renewal.body': 'Renova em {renewalDate} por {price}. Conta de pagamento: {account}.',
  'inapp.subscription_renewal.plan': 'Plano {plan}.',
  'inapp.subscription_renewal.charge': 'Cobrança estimada: {charge}.',
  'inapp.subscription_renewal.approval': 'Precisa da sua aprovação.',
  'inapp.subscription_trial_ending.title':
    'O teste de {provider} termina em {trialEndsOn}; primeira cobrança {price}',
  'inapp.subscription_trial_ending.body':
    'Cancele antes dessa data para evitar a cobrança. Conta de pagamento: {account}.',
  'inapp.subscription_price_change.title': 'Possível mudança de preço: {provider}',
  'inapp.subscription_price_change.body':
    'O preço passou de {previous} para {next} ({percent} %) desde {effectiveFrom}. Aceite ou rejeite a proposta.',
  'email.subscription_renewal.subject': 'Você tem uma renovação de assinatura próxima',
  'email.subscription_renewal.basic': 'Uma das suas assinaturas renova em {days} dias.',
  'email.subscription_renewal.detailed': '{provider} renova em {renewalDate}: {price} com {account}.',
  'email.subscription_trial_ending.subject': 'Você tem um teste prestes a terminar',
  'email.subscription_trial_ending.basic': 'O teste de uma das suas assinaturas termina em {days} dias.',
  'email.subscription_trial_ending.detailed':
    'O teste de {provider} termina em {trialEndsOn}; primeira cobrança {price}.',
  'email.subscription_price_change.subject': 'Detectamos uma possível mudança de preço',
  'email.subscription_price_change.basic': 'Uma das suas assinaturas pode ter mudado de preço.',
  'email.subscription_price_change.detailed':
    '{provider}: o preço passou de {previous} para {next} ({percent} %) desde {effectiveFrom}.',
  'inapp.card_payment_due.title': 'Vencimento de {card} ({currency}): {dueDate}',
  'inapp.card_payment_due.body':
    'Para não pagar juros faltam {noInterest}; o pagamento mínimo pendente é {minimum}.',
  'inapp.card_utilization.title': '{card} atingiu {threshold} % do limite',
  'inapp.card_utilization.body': 'Utilização atual: {utilization} % ({used} de {limit}).',
  'email.card_payment_due.subject': 'Você tem um vencimento de cartão',
  'email.card_payment_due.basic': 'Um dos seus cartões de crédito vence em {dueDate}.',
  'email.card_payment_due.detailed':
    'A fatura de {card} ({currency}) vence em {dueDate}: faltam {noInterest} para não pagar juros.',
  'email.card_utilization.subject': 'Você tem um aviso de uso de cartão',
  'email.card_utilization.basic': 'Um dos seus cartões de crédito atingiu {threshold} % do limite.',
  'email.card_utilization.detailed':
    '{card} atingiu {threshold} % do limite: utilização {utilization} % ({used} de {limit}).',
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
