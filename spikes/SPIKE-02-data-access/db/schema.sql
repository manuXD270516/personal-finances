\restrict dbmate

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: fx; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA fx;


--
-- Name: iam; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA iam;


--
-- Name: ledger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ledger;


--
-- Name: platform; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA platform;


--
-- Name: assert_entry_balanced(); Type: FUNCTION; Schema: ledger; Owner: -
--

CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ccy text; v_sum numeric;
BEGIN
  SELECT currency, sum(amount) INTO v_ccy, v_sum
  FROM ledger.posting
  WHERE journal_entry_id = NEW.journal_entry_id
  GROUP BY currency
  HAVING sum(amount) <> 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED_ENTRY: entry % currency % sum %',
      NEW.journal_entry_id, v_ccy, v_sum USING ERRCODE = 'PF001';
  END IF;
  RETURN NULL;
END $$;


--
-- Name: assert_entry_has_postings(); Type: FUNCTION; Schema: ledger; Owner: -
--

CREATE FUNCTION ledger.assert_entry_has_postings() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT count(*) FROM ledger.posting WHERE journal_entry_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: entry %', NEW.id USING ERRCODE = 'PF002';
  END IF;
  RETURN NULL;
END $$;


--
-- Name: current_workspace_id(); Type: FUNCTION; Schema: platform; Owner: -
--

CREATE FUNCTION platform.current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$ SELECT current_setting('app.workspace_id')::uuid $$;


--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: platform; Owner: -
--

CREATE FUNCTION platform.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'PF003';
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: currency; Type: TABLE; Schema: fx; Owner: -
--

CREATE TABLE fx.currency (
    code character varying(16) NOT NULL,
    kind text NOT NULL,
    scale smallint NOT NULL,
    CONSTRAINT currency_kind_check CHECK ((kind = ANY (ARRAY['FIAT'::text, 'CRYPTO'::text, 'COMMODITY'::text, 'CUSTOM'::text]))),
    CONSTRAINT currency_scale_check CHECK (((scale >= 0) AND (scale <= 18)))
);


--
-- Name: workspace; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.workspace (
    id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journal_entry; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger.journal_entry (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    sequence bigint NOT NULL,
    entry_date date NOT NULL,
    entry_type text NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    source_revision integer NOT NULL,
    reverses_entry_id uuid,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_entry_entry_type_check CHECK ((entry_type = ANY (ARRAY['STANDARD'::text, 'REVERSAL'::text, 'OPENING'::text]))),
    CONSTRAINT journal_entry_reversal_ck CHECK (((entry_type = 'REVERSAL'::text) = (reverses_entry_id IS NOT NULL)))
);

ALTER TABLE ONLY ledger.journal_entry FORCE ROW LEVEL SECURITY;


--
-- Name: journal_entry_sequence_seq; Type: SEQUENCE; Schema: ledger; Owner: -
--

ALTER TABLE ledger.journal_entry ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ledger.journal_entry_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ledger_account; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger.ledger_account (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    type text NOT NULL,
    currency character varying(16) NOT NULL,
    system_kind text,
    source_account_id uuid,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT ledger_account_system_kind_check CHECK ((system_kind = ANY (ARRAY['INCOME'::text, 'EXPENSE'::text, 'OPENING_BALANCE'::text, 'FX_TRADING'::text, 'ADJUSTMENTS'::text]))),
    CONSTRAINT ledger_account_type_check CHECK ((type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'INCOME'::text, 'EXPENSE'::text]))),
    CONSTRAINT ledger_account_user_ck CHECK (((type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text])) = (source_account_id IS NOT NULL)))
);

ALTER TABLE ONLY ledger.ledger_account FORCE ROW LEVEL SECURITY;


--
-- Name: posting; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger.posting (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    journal_entry_id uuid NOT NULL,
    entry_date date NOT NULL,
    line_no smallint NOT NULL,
    ledger_account_id uuid NOT NULL,
    account_type text NOT NULL,
    currency character varying(16) NOT NULL,
    amount numeric(38,18) NOT NULL,
    split_id uuid,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT posting_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT posting_nominal_split_ck CHECK (((account_type <> ALL (ARRAY['INCOME'::text, 'EXPENSE'::text])) OR (split_id IS NOT NULL)))
);

ALTER TABLE ONLY ledger.posting FORCE ROW LEVEL SECURITY;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: currency currency_pkey; Type: CONSTRAINT; Schema: fx; Owner: -
--

ALTER TABLE ONLY fx.currency
    ADD CONSTRAINT currency_pkey PRIMARY KEY (code);


--
-- Name: workspace workspace_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);


--
-- Name: journal_entry journal_entry_id_date_uk; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.journal_entry
    ADD CONSTRAINT journal_entry_id_date_uk UNIQUE (id, entry_date);


--
-- Name: journal_entry journal_entry_pkey; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.journal_entry
    ADD CONSTRAINT journal_entry_pkey PRIMARY KEY (id);


--
-- Name: journal_entry journal_entry_ws_id_uk; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.journal_entry
    ADD CONSTRAINT journal_entry_ws_id_uk UNIQUE (workspace_id, id);


--
-- Name: ledger_account ledger_account_id_ccy_uk; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.ledger_account
    ADD CONSTRAINT ledger_account_id_ccy_uk UNIQUE (id, currency, type);


--
-- Name: ledger_account ledger_account_pkey; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.ledger_account
    ADD CONSTRAINT ledger_account_pkey PRIMARY KEY (id);


--
-- Name: ledger_account ledger_account_ws_id_uk; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.ledger_account
    ADD CONSTRAINT ledger_account_ws_id_uk UNIQUE (workspace_id, id);


--
-- Name: posting posting_line_uk; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_line_uk UNIQUE (journal_entry_id, line_no);


--
-- Name: posting posting_pkey; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: posting_balance_ix; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX posting_balance_ix ON ledger.posting USING btree (workspace_id, ledger_account_id, entry_date, id) INCLUDE (amount);


--
-- Name: journal_entry journal_entry_immutable_trg; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER journal_entry_immutable_trg BEFORE DELETE OR UPDATE ON ledger.journal_entry FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();


--
-- Name: journal_entry journal_entry_postings_trg; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE CONSTRAINT TRIGGER journal_entry_postings_trg AFTER INSERT ON ledger.journal_entry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_has_postings();


--
-- Name: posting posting_balanced_trg; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE CONSTRAINT TRIGGER posting_balanced_trg AFTER INSERT ON ledger.posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();


--
-- Name: posting posting_immutable_trg; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER posting_immutable_trg BEFORE DELETE OR UPDATE ON ledger.posting FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();


--
-- Name: posting posting_no_truncate_trg; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER posting_no_truncate_trg BEFORE TRUNCATE ON ledger.posting FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();


--
-- Name: journal_entry journal_entry_reversal_fk; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.journal_entry
    ADD CONSTRAINT journal_entry_reversal_fk FOREIGN KEY (workspace_id, reverses_entry_id) REFERENCES ledger.journal_entry(workspace_id, id);


--
-- Name: journal_entry journal_entry_workspace_id_fkey; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.journal_entry
    ADD CONSTRAINT journal_entry_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES iam.workspace(id);


--
-- Name: ledger_account ledger_account_currency_fkey; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.ledger_account
    ADD CONSTRAINT ledger_account_currency_fkey FOREIGN KEY (currency) REFERENCES fx.currency(code);


--
-- Name: ledger_account ledger_account_workspace_id_fkey; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.ledger_account
    ADD CONSTRAINT ledger_account_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES iam.workspace(id);


--
-- Name: posting posting_account_ccy_fk; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_account_ccy_fk FOREIGN KEY (ledger_account_id, currency, account_type) REFERENCES ledger.ledger_account(id, currency, type);


--
-- Name: posting posting_account_ws_fk; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_account_ws_fk FOREIGN KEY (workspace_id, ledger_account_id) REFERENCES ledger.ledger_account(workspace_id, id);


--
-- Name: posting posting_currency_fkey; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_currency_fkey FOREIGN KEY (currency) REFERENCES fx.currency(code);


--
-- Name: posting posting_entry_date_fk; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_entry_date_fk FOREIGN KEY (journal_entry_id, entry_date) REFERENCES ledger.journal_entry(id, entry_date);


--
-- Name: posting posting_entry_fk; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger.posting
    ADD CONSTRAINT posting_entry_fk FOREIGN KEY (workspace_id, journal_entry_id) REFERENCES ledger.journal_entry(workspace_id, id);


--
-- Name: journal_entry; Type: ROW SECURITY; Schema: ledger; Owner: -
--

ALTER TABLE ledger.journal_entry ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_account; Type: ROW SECURITY; Schema: ledger; Owner: -
--

ALTER TABLE ledger.ledger_account ENABLE ROW LEVEL SECURITY;

--
-- Name: posting; Type: ROW SECURITY; Schema: ledger; Owner: -
--

ALTER TABLE ledger.posting ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entry ws_isolation; Type: POLICY; Schema: ledger; Owner: -
--

CREATE POLICY ws_isolation ON ledger.journal_entry USING ((workspace_id = platform.current_workspace_id())) WITH CHECK ((workspace_id = platform.current_workspace_id()));


--
-- Name: ledger_account ws_isolation; Type: POLICY; Schema: ledger; Owner: -
--

CREATE POLICY ws_isolation ON ledger.ledger_account USING ((workspace_id = platform.current_workspace_id())) WITH CHECK ((workspace_id = platform.current_workspace_id()));


--
-- Name: posting ws_isolation; Type: POLICY; Schema: ledger; Owner: -
--

CREATE POLICY ws_isolation ON ledger.posting USING ((workspace_id = platform.current_workspace_id())) WITH CHECK ((workspace_id = platform.current_workspace_id()));


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261001000001');
