-- COMMITMENTS: la fusión de categorías y contrapartes actualiza la categoría y la contraparte de la versión vigente de
-- una definición recurrente como ANOTACIÓN, sin crear una versión nueva ni tocar ocurrencias ni montos (openspec
-- add-category-and-counterparty-merge, tarea 4.1; design.md decisión 4). Las versiones eran inmutables (PF003): esta
-- migración abre una excepción ESTRECHA y verificada en la base: solo `category_id` y `counterparty_id` pueden cambiar
-- (y solo con el privilegio de columna); cualquier otra columna sigue siendo inmutable y el DELETE y el TRUNCATE siguen
-- prohibidos. Expand, no destructiva. Se ejecuta con `pf_migrator`.

-- migrate:up
DROP TRIGGER recurring_definition_version_immutable_trg ON commitments.recurring_definition_version;

CREATE TRIGGER recurring_definition_version_no_delete_trg
  BEFORE DELETE ON commitments.recurring_definition_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

CREATE FUNCTION commitments.recurring_definition_version_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  -- Todo lo que no sea la categoría o la contraparte sigue siendo inmutable.
  IF (to_jsonb(NEW) - 'category_id' - 'counterparty_id') IS DISTINCT FROM
     (to_jsonb(OLD) - 'category_id' - 'counterparty_id') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: only category_id and counterparty_id of %.% can be updated',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'PF003';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION commitments.recurring_definition_version_guard() FROM PUBLIC;

CREATE TRIGGER recurring_definition_version_guard_trg
  BEFORE UPDATE ON commitments.recurring_definition_version
  FOR EACH ROW EXECUTE FUNCTION commitments.recurring_definition_version_guard();

GRANT UPDATE (category_id, counterparty_id) ON commitments.recurring_definition_version TO pf_app;

COMMENT ON TABLE commitments.recurring_definition_version IS
  'Versión inmutable de la plantilla de una definición ("esta y las siguientes"); WS-RO con forbid_mutation (PF003). Única excepción: category_id y counterparty_id se reasignan por la fusión de categorías y contrapartes (anotación).';

-- migrate:down
REVOKE UPDATE (category_id, counterparty_id) ON commitments.recurring_definition_version FROM pf_app;
DROP TRIGGER recurring_definition_version_guard_trg ON commitments.recurring_definition_version;
DROP FUNCTION commitments.recurring_definition_version_guard();
DROP TRIGGER recurring_definition_version_no_delete_trg ON commitments.recurring_definition_version;
CREATE TRIGGER recurring_definition_version_immutable_trg
  BEFORE UPDATE OR DELETE ON commitments.recurring_definition_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
COMMENT ON TABLE commitments.recurring_definition_version IS
  'Versión inmutable de la plantilla de una definición ("esta y las siguientes"); WS-RO con forbid_mutation (PF003).';
