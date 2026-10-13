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
  // in-app: metas de ahorro
  'inapp.goal_over_allocated.title': 'Lo reservado para metas supera el saldo de {account}',
  'inapp.goal_over_allocated.body':
    'Saldo {balance}, reservado {reserved}: faltan {shortfall}. Metas afectadas: {goals}.',
  'inapp.goal_reached.title': 'Alcanzaste tu meta {goal}',
  'inapp.goal_reached.body': 'Llevas {progress} de {target} (al {reachedDate}).',
  'inapp.goal_milestone.title': '{goal} llegó al {milestone} % de su objetivo',
  'inapp.goal_milestone.body': 'Llevas {progress} de {target} ({percent} %).',
  'inapp.goal_milestone.also': 'También se cruzaron los hitos {also}.',
  // email: metas (basic sin montos, monedas ni nombres de metas o cuentas; detailed con ellos)
  'email.goal_over_allocated.subject': 'Tienes una cuenta con más reservado que su saldo',
  'email.goal_over_allocated.basic': 'Una de tus cuentas tiene más dinero reservado para metas que su saldo.',
  'email.goal_over_allocated.detailed':
    'En {account} lo reservado para metas ({reserved}) supera el saldo ({balance}) por {shortfall}. Metas afectadas: {goals}.',
  'email.goal_reached.subject': 'Alcanzaste una de tus metas de ahorro',
  'email.goal_reached.basic': 'Una de tus metas de ahorro alcanzó su objetivo.',
  'email.goal_reached.detailed': 'Alcanzaste tu meta {goal}: llevas {progress} de {target}.',
  'email.goal_milestone.subject': 'Una de tus metas de ahorro avanzó',
  'email.goal_milestone.basic': 'Una de tus metas de ahorro llegó al {milestone} % de su objetivo.',
  'email.goal_milestone.detailed':
    '{goal} llegó al {milestone} % de su objetivo: llevas {progress} de {target}.',
  // in-app y email: alertas de tasas (add-rate-feed-alerts; los emails `basic` no llevan valores, monedas ni providers)
  'inapp.fx_rate_feed_stale.title': '{pair} lleva más de {hours} horas sin tasa automática',
  'inapp.fx_rate_feed_stale.body':
    'La última tasa automática es del {lastRate} (hace {elapsed}). Revisa el estado de las tasas automáticas.',
  'inapp.fx_rate_feed_stale.body_never':
    'Este par todavía no tiene ninguna tasa automática aceptada. Revisa el estado de las tasas automáticas.',
  'inapp.fx_rate_feed_recovered.title': '{pair} volvió a tener tasa automática',
  'inapp.fx_rate_feed_recovered.body': 'Llegó una tasa automática con vigencia {asOf}.',
  'inapp.fx_rate_anomaly_retained.title': 'Tasa {pair} retenida: variación de {variation} %',
  'inapp.fx_rate_anomaly_retained.body':
    '{provider} publicó {value} frente a {baseline} de la tasa anterior. La muestra no se usa hasta que la confirmes o la rechaces.',
  'email.fx_rate_feed_stale.subject': 'Una tasa automática lleva horas sin actualizarse',
  'email.fx_rate_feed_stale.basic':
    'Un par de tasas automáticas lleva más de {hours} horas sin una tasa nueva. Revisa su estado en la app.',
  'email.fx_rate_feed_stale.detailed':
    '{pair} lleva más de {hours} horas sin tasa automática. Última tasa: {lastRate}.',
  'email.fx_rate_feed_stale.detailed_never':
    '{pair} lleva más de {hours} horas sin tasa automática y todavía no tiene ninguna aceptada.',
  'email.fx_rate_feed_recovered.subject': 'Una tasa automática volvió a actualizarse',
  'email.fx_rate_feed_recovered.basic':
    'Un par de tasas automáticas volvió a recibir tasas. Puedes verlo en la app.',
  'email.fx_rate_feed_recovered.detailed': '{pair} volvió a tener tasa automática (vigencia {asOf}).',
  'email.fx_rate_anomaly_retained.subject': 'Tienes una tasa retenida por revisar',
  'email.fx_rate_anomaly_retained.basic':
    'Una tasa automática quedó retenida y necesita tu revisión en la app.',
  'email.fx_rate_anomaly_retained.detailed':
    '{pair}: {provider} publicó {value} (tasa anterior {baseline}, {variation} %). Confírmala o recházala en la app.',
  // email: común
  // aviso agrupado por par (refine-rate-anomaly-alert-grouping): plural `_one` / `_other` según las muestras pendientes
  'inapp.fx_rate_anomaly_group.title_one': '{pair}: {count} tasa automática retenida',
  'inapp.fx_rate_anomaly_group.title_other': '{pair}: {count} tasas automáticas retenidas',
  'inapp.fx_rate_anomaly_group.body_one':
    '{provider} publicó {rateType} {value} frente a {baseline} ({variation} %). La muestra no se usa hasta que la confirmes o la rechaces.',
  'inapp.fx_rate_anomaly_group.body_other':
    'La mayor variación es {rateType} {value} frente a {baseline} ({variation} %) de {provider}. Providers con muestras pendientes: {providers}. Las muestras no se usan hasta que las confirmes o las rechaces.',
  'email.fx_rate_anomaly_group.subject': 'Tienes tasas automáticas retenidas por revisar',
  'email.fx_rate_anomaly_group.basic':
    'Una o más tasas automáticas quedaron retenidas y necesitan tu revisión en la app.',
  'email.fx_rate_anomaly_group.detailed_one':
    '{pair}: {provider} publicó {rateType} {value} (tasa anterior {baseline}, {variation} %). Confírmala o recházala en la app.',
  'email.fx_rate_anomaly_group.detailed_other':
    '{pair}: {count} tasas automáticas retenidas pendientes de revisión. La mayor variación es {rateType} {value} frente a {baseline} ({variation} %, {provider}). Confírmalas o recházalas en la app.',
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
  'inapp.goal_over_allocated.title': 'Money set aside for goals exceeds the balance of {account}',
  'inapp.goal_over_allocated.body':
    'Balance {balance}, set aside {reserved}: {shortfall} short. Affected goals: {goals}.',
  'inapp.goal_reached.title': 'You reached your goal {goal}',
  'inapp.goal_reached.body': 'You have {progress} of {target} (as of {reachedDate}).',
  'inapp.goal_milestone.title': '{goal} reached {milestone} % of its target',
  'inapp.goal_milestone.body': 'You have {progress} of {target} ({percent} %).',
  'inapp.goal_milestone.also': 'Milestones {also} were also crossed.',
  'email.goal_over_allocated.subject': 'You have an account with more set aside than its balance',
  'email.goal_over_allocated.basic':
    'One of your accounts has more money set aside for goals than its balance.',
  'email.goal_over_allocated.detailed':
    'In {account} the amount set aside for goals ({reserved}) exceeds the balance ({balance}) by {shortfall}. Affected goals: {goals}.',
  'email.goal_reached.subject': 'You reached one of your savings goals',
  'email.goal_reached.basic': 'One of your savings goals reached its target.',
  'email.goal_reached.detailed': 'You reached your goal {goal}: you have {progress} of {target}.',
  'email.goal_milestone.subject': 'One of your savings goals moved forward',
  'email.goal_milestone.basic': 'One of your savings goals reached {milestone} % of its target.',
  'email.goal_milestone.detailed':
    '{goal} reached {milestone} % of its target: you have {progress} of {target}.',
  // in-app and email: rate alerts (add-rate-feed-alerts; `basic` emails carry no values, currencies or providers)
  'inapp.fx_rate_feed_stale.title': '{pair} has had no automatic rate for more than {hours} hours',
  'inapp.fx_rate_feed_stale.body':
    'The last automatic rate is from {lastRate} ({elapsed} ago). Check the status of the automatic rates.',
  'inapp.fx_rate_feed_stale.body_never':
    'This pair has no accepted automatic rate yet. Check the status of the automatic rates.',
  'inapp.fx_rate_feed_recovered.title': '{pair} has an automatic rate again',
  'inapp.fx_rate_feed_recovered.body': 'An automatic rate arrived, effective {asOf}.',
  'inapp.fx_rate_anomaly_retained.title': 'Rate {pair} held: {variation} % change',
  'inapp.fx_rate_anomaly_retained.body':
    '{provider} published {value} against {baseline} for the previous rate. The sample is not used until you confirm or reject it.',
  'email.fx_rate_feed_stale.subject': 'An automatic rate has not been updated for hours',
  'email.fx_rate_feed_stale.basic':
    'A pair of automatic rates has gone more than {hours} hours without a new rate. Check its status in the app.',
  'email.fx_rate_feed_stale.detailed':
    '{pair} has had no automatic rate for more than {hours} hours. Last rate: {lastRate}.',
  'email.fx_rate_feed_stale.detailed_never':
    '{pair} has had no automatic rate for more than {hours} hours and has no accepted one yet.',
  'email.fx_rate_feed_recovered.subject': 'An automatic rate is being updated again',
  'email.fx_rate_feed_recovered.basic':
    'A pair of automatic rates is receiving rates again. You can see it in the app.',
  'email.fx_rate_feed_recovered.detailed': '{pair} has an automatic rate again (effective {asOf}).',
  'email.fx_rate_anomaly_retained.subject': 'You have a held rate to review',
  'email.fx_rate_anomaly_retained.basic': 'An automatic rate was held and needs your review in the app.',
  'email.fx_rate_anomaly_retained.detailed':
    '{pair}: {provider} published {value} (previous rate {baseline}, {variation} %). Confirm or reject it in the app.',
  'inapp.fx_rate_anomaly_group.title_one': '{pair}: {count} automatic rate held',
  'inapp.fx_rate_anomaly_group.title_other': '{pair}: {count} automatic rates held',
  'inapp.fx_rate_anomaly_group.body_one':
    '{provider} published {rateType} {value} against {baseline} ({variation} %). The sample is not used until you confirm or reject it.',
  'inapp.fx_rate_anomaly_group.body_other':
    'The largest change is {rateType} {value} against {baseline} ({variation} %) from {provider}. Providers with pending samples: {providers}. The samples are not used until you confirm or reject them.',
  'email.fx_rate_anomaly_group.subject': 'You have automatic rates held for review',
  'email.fx_rate_anomaly_group.basic':
    'One or more automatic rates were held and need your review in the app.',
  'email.fx_rate_anomaly_group.detailed_one':
    '{pair}: {provider} published {rateType} {value} (previous rate {baseline}, {variation} %). Confirm or reject it in the app.',
  'email.fx_rate_anomaly_group.detailed_other':
    '{pair}: {count} automatic rates held for review. The largest change is {rateType} {value} against {baseline} ({variation} %, {provider}). Confirm or reject them in the app.',
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
  'inapp.goal_over_allocated.title': 'O valor reservado para metas supera o saldo de {account}',
  'inapp.goal_over_allocated.body':
    'Saldo {balance}, reservado {reserved}: faltam {shortfall}. Metas afetadas: {goals}.',
  'inapp.goal_reached.title': 'Você alcançou sua meta {goal}',
  'inapp.goal_reached.body': 'Você tem {progress} de {target} (em {reachedDate}).',
  'inapp.goal_milestone.title': '{goal} chegou a {milestone} % do objetivo',
  'inapp.goal_milestone.body': 'Você tem {progress} de {target} ({percent} %).',
  'inapp.goal_milestone.also': 'Também foram cruzados os marcos {also}.',
  'email.goal_over_allocated.subject': 'Você tem uma conta com mais reservado do que o saldo',
  'email.goal_over_allocated.basic':
    'Uma das suas contas tem mais dinheiro reservado para metas do que o seu saldo.',
  'email.goal_over_allocated.detailed':
    'Em {account} o valor reservado para metas ({reserved}) supera o saldo ({balance}) em {shortfall}. Metas afetadas: {goals}.',
  'email.goal_reached.subject': 'Você alcançou uma das suas metas de poupança',
  'email.goal_reached.basic': 'Uma das suas metas de poupança alcançou o objetivo.',
  'email.goal_reached.detailed': 'Você alcançou sua meta {goal}: tem {progress} de {target}.',
  'email.goal_milestone.subject': 'Uma das suas metas de poupança avançou',
  'email.goal_milestone.basic': 'Uma das suas metas de poupança chegou a {milestone} % do objetivo.',
  'email.goal_milestone.detailed':
    '{goal} chegou a {milestone} % do objetivo: você tem {progress} de {target}.',
  // in-app e email: alertas de taxas (add-rate-feed-alerts; os emails `basic` não levam valores, moedas nem provedores)
  'inapp.fx_rate_feed_stale.title': '{pair} está há mais de {hours} horas sem taxa automática',
  'inapp.fx_rate_feed_stale.body':
    'A última taxa automática é de {lastRate} (há {elapsed}). Confira o estado das taxas automáticas.',
  'inapp.fx_rate_feed_stale.body_never':
    'Este par ainda não tem nenhuma taxa automática aceita. Confira o estado das taxas automáticas.',
  'inapp.fx_rate_feed_recovered.title': '{pair} voltou a ter taxa automática',
  'inapp.fx_rate_feed_recovered.body': 'Chegou uma taxa automática com vigência {asOf}.',
  'inapp.fx_rate_anomaly_retained.title': 'Taxa {pair} retida: variação de {variation} %',
  'inapp.fx_rate_anomaly_retained.body':
    '{provider} publicou {value} contra {baseline} da taxa anterior. A amostra não é usada até você confirmá-la ou rejeitá-la.',
  'email.fx_rate_feed_stale.subject': 'Uma taxa automática está há horas sem atualização',
  'email.fx_rate_feed_stale.basic':
    'Um par de taxas automáticas está há mais de {hours} horas sem uma taxa nova. Confira o estado no app.',
  'email.fx_rate_feed_stale.detailed':
    '{pair} está há mais de {hours} horas sem taxa automática. Última taxa: {lastRate}.',
  'email.fx_rate_feed_stale.detailed_never':
    '{pair} está há mais de {hours} horas sem taxa automática e ainda não tem nenhuma aceita.',
  'email.fx_rate_feed_recovered.subject': 'Uma taxa automática voltou a ser atualizada',
  'email.fx_rate_feed_recovered.basic':
    'Um par de taxas automáticas voltou a receber taxas. Você pode ver no app.',
  'email.fx_rate_feed_recovered.detailed': '{pair} voltou a ter taxa automática (vigência {asOf}).',
  'email.fx_rate_anomaly_retained.subject': 'Você tem uma taxa retida para revisar',
  'email.fx_rate_anomaly_retained.basic': 'Uma taxa automática ficou retida e precisa da sua revisão no app.',
  'email.fx_rate_anomaly_retained.detailed':
    '{pair}: {provider} publicou {value} (taxa anterior {baseline}, {variation} %). Confirme ou rejeite no app.',
  'inapp.fx_rate_anomaly_group.title_one': '{pair}: {count} taxa automática retida',
  'inapp.fx_rate_anomaly_group.title_other': '{pair}: {count} taxas automáticas retidas',
  'inapp.fx_rate_anomaly_group.body_one':
    '{provider} publicou {rateType} {value} contra {baseline} ({variation} %). A amostra não é usada até você confirmá-la ou rejeitá-la.',
  'inapp.fx_rate_anomaly_group.body_other':
    'A maior variação é {rateType} {value} contra {baseline} ({variation} %) de {provider}. Providers com amostras pendentes: {providers}. As amostras não são usadas até você confirmá-las ou rejeitá-las.',
  'email.fx_rate_anomaly_group.subject': 'Você tem taxas automáticas retidas para revisar',
  'email.fx_rate_anomaly_group.basic':
    'Uma ou mais taxas automáticas ficaram retidas e precisam da sua revisão no app.',
  'email.fx_rate_anomaly_group.detailed_one':
    '{pair}: {provider} publicou {rateType} {value} (taxa anterior {baseline}, {variation} %). Confirme ou rejeite no app.',
  'email.fx_rate_anomaly_group.detailed_other':
    '{pair}: {count} taxas automáticas retidas para revisar. A maior variação é {rateType} {value} contra {baseline} ({variation} %, {provider}). Confirme ou rejeite no app.',
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
