-- Nombre visible editable por el usuario (openspec add-workspace-identity, tarea 7.3; FR-IDENTITY-003). Expand,
-- no destructiva. Se ejecuta con `pf_migrator`.
--
-- `PATCH /me` permite cambiar `display_name`, pero la provisión JIT (`iam.provision_user`) se ejecuta en cada
-- request autenticado y copiaba el nombre del IdP siempre, pisando el elegido por el usuario. Ahora se guarda el
-- último nombre visto en el IdP (`idp_display_name`) y `display_name` solo se actualiza cuando ese nombre CAMBIA
-- en el IdP (spec: "actualizar email y nombre si cambiaron"); el email se sigue sincronizando siempre.

-- migrate:up
ALTER TABLE iam."user" ADD COLUMN idp_display_name text NULL
  CHECK (idp_display_name IS NULL OR length(idp_display_name) BETWEEN 1 AND 200);

CREATE OR REPLACE FUNCTION iam.provision_user(p_issuer text, p_subject text, p_email text, p_display_name text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_id uuid;
BEGIN
  INSERT INTO iam."user" AS u
    (idp_issuer, idp_subject, email, email_verified, display_name, idp_display_name, last_login_at)
  VALUES (p_issuer, p_subject, p_email, true, p_display_name, p_display_name, now())
  ON CONFLICT (idp_issuer, idp_subject) DO UPDATE
    SET email = EXCLUDED.email,
        email_verified = true,
        display_name = CASE
          WHEN u.idp_display_name IS DISTINCT FROM EXCLUDED.idp_display_name THEN EXCLUDED.display_name
          ELSE u.display_name
        END,
        idp_display_name = EXCLUDED.idp_display_name,
        last_login_at = now(),
        updated_at = now()
  RETURNING u.id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION iam.provision_user(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.provision_user(text, text, text, text) TO pf_app;

-- migrate:down
CREATE OR REPLACE FUNCTION iam.provision_user(p_issuer text, p_subject text, p_email text, p_display_name text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_id uuid;
BEGIN
  INSERT INTO iam."user" AS u (idp_issuer, idp_subject, email, email_verified, display_name, last_login_at)
  VALUES (p_issuer, p_subject, p_email, true, p_display_name, now())
  ON CONFLICT (idp_issuer, idp_subject) DO UPDATE
    SET email = EXCLUDED.email, email_verified = true, display_name = EXCLUDED.display_name,
        last_login_at = now(), updated_at = now()
  RETURNING u.id INTO v_id;
  RETURN v_id;
END
$$;
ALTER TABLE iam."user" DROP COLUMN idp_display_name;
