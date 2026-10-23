-- RLS: forma InitPlan de las políticas de aislamiento (openspec optimize-rls-policy-overhead, tarea 3.1; ADR-0023,
-- NFR-SEC-003, D294). Se ejecuta con `pf_migrator` (dueño de las tablas). Expand: solo cambia expresiones de política
-- y la función de partición; no toca columnas, datos, ENABLE/FORCE ROW LEVEL SECURITY, GRANT ni
-- `platform.workspace_scoped_table`.
--
-- Por qué: con `workspace_id = platform.current_workspace_id()` y el filtro `workspace_id = $1` de la consulta, el planner
-- deriva `current_workspace_id() = $1` y la ejecuta como `One-Time Filter` en un nodo `Result` sobre el acceso por
-- índice: todas las filas pasan por ese nodo (+0,805 ms en la fila INCLUDE del benchmark, issue #147).
-- El experimento `rls-policy-variants.int.test.ts` (PostgreSQL 18.6, 13 000 postings) eligió la variante V2
-- `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])`: el contexto se evalúa una vez (InitPlan), no
-- entra en la clase de equivalencia, el plan conserva los mismos nodos y el acceso por índice que sin política
-- (diferencia 0,000 ms) y el fail-closed (PF002 sin contexto) es idéntico al de la política anterior.
--
-- Alcance (D294): las 121 políticas explícitas de abajo más `ws_isolation` de cada partición de `audit.audit_log`
-- (el DO y la función `audit.protect_partition`), es decir, toda política de `pf_app`/`pf_worker` que compara con
-- `platform.current_workspace_id()`. En las que además comparan con `platform.current_user_id()` se aplica la misma
-- forma a ambas funciones. No se tocan las que usan `current_workspace_id_if_set()` ni las que no usan el contexto de
-- workspace (demo_purge_*, *_retention_*, outbox_relay_*, idempotency_key_scope, etc.).
-- Las expresiones son las que devuelve `pg_get_expr` del esquema real; cada `ALTER POLICY` conserva rol y comando.
-- Forma canónica para políticas NUEVAS: `<col> = ANY (ARRAY[(SELECT platform.current_workspace_id())])`
-- (regla de catálogo TC-SECURITY-RLS-011, `rlsNonCanonicalPolicies`).

-- migrate:up
-- Esquema accounts
ALTER POLICY ws_isolation ON accounts.account
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON accounts.account_custom_field_value
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON accounts.account_tag
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON accounts.institution
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema audit
ALTER POLICY ws_isolation_read ON audit.audit_log
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_write ON audit.audit_log
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_read ON audit.lifecycle_transition
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_write ON audit.lifecycle_transition
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema classification
ALTER POLICY ws_isolation ON classification.category
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON classification.category_group
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON classification.counterparty
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON classification.counterparty_alias
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON classification.custom_field_definition
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON classification.tag
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema commitments
ALTER POLICY ws_isolation ON commitments.occurrence_match_suggestion
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.recurring_definition
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.recurring_definition_version
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.recurring_occurrence
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.subscription
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.subscription_charge
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.subscription_price
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.subscription_price_proposal
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON commitments.subscription_reminder
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema debt
ALTER POLICY ws_isolation ON debt.card_installment
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.card_installment_plan
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.card_reminder
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.card_statement
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.card_utilization_crossing
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.card_utilization_state
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.credit_card
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.credit_card_account
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.credit_card_terms
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_installment
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_payment
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_payment_allocation
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_rate_change
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_reference_row
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_reference_schedule
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_schedule_comparison
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON debt.loan_schedule_version
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema fx
ALTER POLICY exchange_rate_insert_own ON fx.exchange_rate
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY exchange_rate_read ON fx.exchange_rate
  USING ((workspace_id IS NULL) OR (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])));
ALTER POLICY ws_isolation ON fx.rate_anomaly_review
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY rate_feed_episode_insert ON fx.rate_feed_episode
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY rate_feed_episode_read ON fx.rate_feed_episode
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY rate_feed_episode_update ON fx.rate_feed_episode
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON fx.rate_pair
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON fx.rate_pair_list
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON fx.rate_preference
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON fx.rate_preference_set
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY rate_withdrawal_insert ON fx.rate_withdrawal
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY rate_withdrawal_read ON fx.rate_withdrawal
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON fx.workspace_currency
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema goals
ALTER POLICY ws_isolation ON goals.account_reservation_state
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.contribution_suggestion
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.goal_linked_account
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.goal_movement
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.goal_plan
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.recurring_materialization
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON goals.savings_goal
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema iam
ALTER POLICY workspace_insert ON iam.workspace
  WITH CHECK ((id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND ((personal_of_user_id IS NULL) OR (personal_of_user_id = ANY (ARRAY[(SELECT platform.current_user_id())]))));
ALTER POLICY workspace_update ON iam.workspace
  USING (id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY membership_insert ON iam.workspace_membership
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY membership_update ON iam.workspace_membership
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema imports
ALTER POLICY ws_isolation ON imports.import_job
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON imports.row_link
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON imports.staged_transaction
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema ledger
ALTER POLICY ws_isolation_read ON ledger.balance_snapshot
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_worker ON ledger.balance_snapshot
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_read ON ledger.entry_reversal
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_write ON ledger.entry_reversal
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_read ON ledger.journal_entry
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_write ON ledger.journal_entry
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON ledger.ledger_account
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON ledger.period_lock
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_read ON ledger.posting
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_write ON ledger.posting
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema notifications
ALTER POLICY notification_delete ON notifications.notification
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY notification_insert ON notifications.notification
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY notification_refresh ON notifications.notification
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY notification_select ON notifications.notification
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND notifications.is_row_user(user_id));
ALTER POLICY notification_update ON notifications.notification
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])))
  WITH CHECK ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])));
ALTER POLICY delivery_select ON notifications.notification_delivery
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND ((CURRENT_USER = 'pf_worker'::name) OR (EXISTS ( SELECT 1 FROM notifications.notification n WHERE ((n.workspace_id = notification_delivery.workspace_id) AND (n.id = notification_delivery.notification_id))))));
ALTER POLICY delivery_worker ON notifications.notification_delivery
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY preference_delete ON notifications.notification_preference
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY preference_insert ON notifications.notification_preference
  WITH CHECK ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])));
ALTER POLICY preference_select ON notifications.notification_preference
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND notifications.is_row_user(user_id));
ALTER POLICY preference_update ON notifications.notification_preference
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])))
  WITH CHECK ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])));
ALTER POLICY setting_delete ON notifications.user_setting
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY setting_insert ON notifications.user_setting
  WITH CHECK ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])));
ALTER POLICY setting_select ON notifications.user_setting
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND notifications.is_row_user(user_id));
ALTER POLICY setting_update ON notifications.user_setting
  USING ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])))
  WITH CHECK ((workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) AND (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])));

-- Esquema planning
ALTER POLICY ws_isolation ON planning.budget
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.budget_line
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.budget_template
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.budget_template_line
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.budget_template_version
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.budget_threshold_crossing
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.close_pending_notice
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.close_snapshot
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.close_snapshot_balance
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.close_snapshot_without_statement
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.closing_policy
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.financial_period
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON planning.period_reopening
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema platform
ALTER POLICY idempotency_key_scope ON platform.idempotency_key
  USING (CASE WHEN (workspace_id IS NULL) THEN (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])) ELSE (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) END)
  WITH CHECK (CASE WHEN (workspace_id IS NULL) THEN (user_id = ANY (ARRAY[(SELECT platform.current_user_id())])) ELSE (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) END);
ALTER POLICY ws_isolation ON platform.operation
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY outbox_write ON platform.outbox
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema reporting
ALTER POLICY ws_isolation_read ON reporting.workspace_data_version
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation_worker ON reporting.workspace_data_version
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Esquema txn
ALTER POLICY ws_isolation ON txn.conversion_detail
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.conversion_fee
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.reconciliation
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.reconciliation_item
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.split_custom_field_value
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.split_tag
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.transaction
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.transaction_journal_link
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.transaction_leg
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));
ALTER POLICY ws_isolation ON txn.transaction_split
  USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))
  WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]));

-- Particiones de audit.audit_log (los nombres dependen de la fecha en que se migró; incluye la DEFAULT).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'audit.audit_log'::regclass
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER POLICY ws_isolation ON %s USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) '
      'WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))', r.tbl);
  END LOOP;
END
$$;

-- Particiones futuras (las crea audit.ensure_partitions): misma forma en la política que crea protect_partition.
CREATE OR REPLACE FUNCTION audit.protect_partition(p_table regclass) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, pf_app', p_table);
  EXECUTE format(
    'CREATE POLICY ws_isolation ON %s TO pf_app '
    'USING (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])) '
    'WITH CHECK (workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())]))', p_table);
  EXECUTE format(
    'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
    'EXECUTE FUNCTION platform.forbid_mutation()', p_table);
END
$$;

-- migrate:down
-- Restaura la expresión anterior de cada política (misma semántica) y la función anterior.
-- Esquema accounts
ALTER POLICY ws_isolation ON accounts.account
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON accounts.account_custom_field_value
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON accounts.account_tag
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON accounts.institution
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema audit
ALTER POLICY ws_isolation_read ON audit.audit_log
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_write ON audit.audit_log
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_read ON audit.lifecycle_transition
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_write ON audit.lifecycle_transition
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema classification
ALTER POLICY ws_isolation ON classification.category
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON classification.category_group
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON classification.counterparty
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON classification.counterparty_alias
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON classification.custom_field_definition
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON classification.tag
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema commitments
ALTER POLICY ws_isolation ON commitments.occurrence_match_suggestion
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.recurring_definition
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.recurring_definition_version
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.recurring_occurrence
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.subscription
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.subscription_charge
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.subscription_price
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.subscription_price_proposal
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON commitments.subscription_reminder
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema debt
ALTER POLICY ws_isolation ON debt.card_installment
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.card_installment_plan
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.card_reminder
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.card_statement
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.card_utilization_crossing
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.card_utilization_state
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.credit_card
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.credit_card_account
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.credit_card_terms
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_installment
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_payment
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_payment_allocation
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_rate_change
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_reference_row
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_reference_schedule
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_schedule_comparison
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON debt.loan_schedule_version
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema fx
ALTER POLICY exchange_rate_insert_own ON fx.exchange_rate
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY exchange_rate_read ON fx.exchange_rate
  USING ((workspace_id IS NULL) OR (workspace_id = platform.current_workspace_id()));
ALTER POLICY ws_isolation ON fx.rate_anomaly_review
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY rate_feed_episode_insert ON fx.rate_feed_episode
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY rate_feed_episode_read ON fx.rate_feed_episode
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY rate_feed_episode_update ON fx.rate_feed_episode
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON fx.rate_pair
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON fx.rate_pair_list
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON fx.rate_preference
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON fx.rate_preference_set
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY rate_withdrawal_insert ON fx.rate_withdrawal
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY rate_withdrawal_read ON fx.rate_withdrawal
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON fx.workspace_currency
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema goals
ALTER POLICY ws_isolation ON goals.account_reservation_state
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.contribution_suggestion
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.goal_linked_account
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.goal_movement
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.goal_plan
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.recurring_materialization
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON goals.savings_goal
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema iam
ALTER POLICY workspace_insert ON iam.workspace
  WITH CHECK ((id = platform.current_workspace_id()) AND ((personal_of_user_id IS NULL) OR (personal_of_user_id = platform.current_user_id())));
ALTER POLICY workspace_update ON iam.workspace
  USING (id = platform.current_workspace_id())
  WITH CHECK (id = platform.current_workspace_id());
ALTER POLICY membership_insert ON iam.workspace_membership
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY membership_update ON iam.workspace_membership
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema imports
ALTER POLICY ws_isolation ON imports.import_job
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON imports.row_link
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON imports.staged_transaction
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema ledger
ALTER POLICY ws_isolation_read ON ledger.balance_snapshot
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_worker ON ledger.balance_snapshot
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_read ON ledger.entry_reversal
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_write ON ledger.entry_reversal
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_read ON ledger.journal_entry
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_write ON ledger.journal_entry
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON ledger.ledger_account
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON ledger.period_lock
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_read ON ledger.posting
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_write ON ledger.posting
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema notifications
ALTER POLICY notification_delete ON notifications.notification
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY notification_insert ON notifications.notification
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY notification_refresh ON notifications.notification
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY notification_select ON notifications.notification
  USING ((workspace_id = platform.current_workspace_id()) AND notifications.is_row_user(user_id));
ALTER POLICY notification_update ON notifications.notification
  USING ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()))
  WITH CHECK ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()));
ALTER POLICY delivery_select ON notifications.notification_delivery
  USING ((workspace_id = platform.current_workspace_id()) AND ((CURRENT_USER = 'pf_worker'::name) OR (EXISTS ( SELECT 1 FROM notifications.notification n WHERE ((n.workspace_id = notification_delivery.workspace_id) AND (n.id = notification_delivery.notification_id))))));
ALTER POLICY delivery_worker ON notifications.notification_delivery
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY preference_delete ON notifications.notification_preference
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY preference_insert ON notifications.notification_preference
  WITH CHECK ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()));
ALTER POLICY preference_select ON notifications.notification_preference
  USING ((workspace_id = platform.current_workspace_id()) AND notifications.is_row_user(user_id));
ALTER POLICY preference_update ON notifications.notification_preference
  USING ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()))
  WITH CHECK ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()));
ALTER POLICY setting_delete ON notifications.user_setting
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY setting_insert ON notifications.user_setting
  WITH CHECK ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()));
ALTER POLICY setting_select ON notifications.user_setting
  USING ((workspace_id = platform.current_workspace_id()) AND notifications.is_row_user(user_id));
ALTER POLICY setting_update ON notifications.user_setting
  USING ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()))
  WITH CHECK ((workspace_id = platform.current_workspace_id()) AND (user_id = platform.current_user_id()));

-- Esquema planning
ALTER POLICY ws_isolation ON planning.budget
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.budget_line
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.budget_template
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.budget_template_line
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.budget_template_version
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.budget_threshold_crossing
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.close_pending_notice
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.close_snapshot
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.close_snapshot_balance
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.close_snapshot_without_statement
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.closing_policy
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.financial_period
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON planning.period_reopening
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema platform
ALTER POLICY idempotency_key_scope ON platform.idempotency_key
  USING (CASE WHEN (workspace_id IS NULL) THEN (user_id = platform.current_user_id()) ELSE (workspace_id = platform.current_workspace_id()) END)
  WITH CHECK (CASE WHEN (workspace_id IS NULL) THEN (user_id = platform.current_user_id()) ELSE (workspace_id = platform.current_workspace_id()) END);
ALTER POLICY ws_isolation ON platform.operation
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY outbox_write ON platform.outbox
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema reporting
ALTER POLICY ws_isolation_read ON reporting.workspace_data_version
  USING (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation_worker ON reporting.workspace_data_version
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Esquema txn
ALTER POLICY ws_isolation ON txn.conversion_detail
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.conversion_fee
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.reconciliation
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.reconciliation_item
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.split_custom_field_value
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.split_tag
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.transaction
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.transaction_journal_link
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.transaction_leg
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY ws_isolation ON txn.transaction_split
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Particiones de audit.audit_log (los nombres dependen de la fecha en que se migró; incluye la DEFAULT).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'audit.audit_log'::regclass
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER POLICY ws_isolation ON %s USING (workspace_id = platform.current_workspace_id()) '
      'WITH CHECK (workspace_id = platform.current_workspace_id())', r.tbl);
  END LOOP;
END
$$;

-- Particiones futuras (las crea audit.ensure_partitions): forma anterior de la política que crea protect_partition.
CREATE OR REPLACE FUNCTION audit.protect_partition(p_table regclass) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, pf_app', p_table);
  EXECUTE format(
    'CREATE POLICY ws_isolation ON %s TO pf_app USING (workspace_id = platform.current_workspace_id()) '
    'WITH CHECK (workspace_id = platform.current_workspace_id())', p_table);
  EXECUTE format(
    'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
    'EXECUTE FUNCTION platform.forbid_mutation()', p_table);
END
$$;
