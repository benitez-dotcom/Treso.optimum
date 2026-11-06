-- Tréso Optimum — schéma initial (lot 1)
-- Exécuté par le rôle propriétaire. L'application se connecte avec un rôle
-- distinct (sans BYPASSRLS, non propriétaire) : les politiques RLS s'appliquent.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Contexte de la requête, positionné par l'API dans chaque transaction
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────────────────────── Comptes et authentification ─────────────────────────

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text,
  first_name        text NOT NULL,
  last_name         text,
  email_verified_at timestamptz,
  active_company_id uuid,
  theme             text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('verify', 'reset', 'magic')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Sociétés et membres ─────────────────────────

CREATE TABLE companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  siren              text CHECK (siren ~ '^[0-9]{9}$'),
  sector             text,
  plan               text NOT NULL DEFAULT 'PERFORMANCE'
                     CHECK (plan IN ('DISCOVERY', 'ESSENTIAL', 'PERFORMANCE', 'GROUP', 'FIRM', 'DEMO')),
  trial_ends_at      timestamptz,
  min_cash_threshold numeric(14, 2) NOT NULL DEFAULT 0,
  forecast_mode      text NOT NULL DEFAULT 'projection' CHECK (forecast_mode IN ('budget', 'projection')),
  invoices_enabled   boolean NOT NULL DEFAULT true,
  vat_enabled        boolean NOT NULL DEFAULT false,
  vat_regime         text NOT NULL DEFAULT 'monthly' CHECK (vat_regime IN ('monthly', 'quarterly')),
  overdue_in_plan    text NOT NULL DEFAULT 'current_month' CHECK (overdue_in_plan IN ('current_month', 'due_month')),
  is_demo            boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_active_company_fk
  FOREIGN KEY (active_company_id) REFERENCES companies(id) ON DELETE SET NULL;

CREATE TABLE memberships (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'ADVISOR', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE UNIQUE INDEX memberships_one_owner ON memberships (company_id) WHERE role = 'OWNER';
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'ADVISOR', 'VIEWER')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Données métier (toutes cloisonnées) ─────────────────────────

CREATE TABLE bank_accounts (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL,
  bank_name  text NOT NULL,
  balance    numeric(14, 2) NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE categories (
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id               text NOT NULL,
  name             text NOT NULL,
  flow             text NOT NULL CHECK (flow IN ('in', 'out')),
  parent_id        text,
  position         integer NOT NULL DEFAULT 0,
  kind             text NOT NULL DEFAULT 'none' CHECK (kind IN ('revenue', 'purchases', 'overheads', 'payroll', 'none')),
  vat_rate         numeric(4, 1) NOT NULL DEFAULT 0,
  budget_at_parent boolean NOT NULL DEFAULT false,
  is_vat           boolean NOT NULL DEFAULT false,
  is_system        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, parent_id) REFERENCES categories(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE transactions (
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id               text NOT NULL,
  account_id       text NOT NULL,
  booked_at        date NOT NULL,
  raw_label        text NOT NULL,
  label            text NOT NULL,
  counterparty     text,
  amount           numeric(14, 2) NOT NULL,
  category_id      text,
  suggestion       jsonb,
  hidden           boolean NOT NULL DEFAULT false,
  note             text,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, account_id) REFERENCES bank_accounts(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE SET NULL (category_id)
);
CREATE INDEX transactions_booked ON transactions (company_id, booked_at);

CREATE TABLE commitments (
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id             text NOT NULL,
  flow           text NOT NULL CHECK (flow IN ('in', 'out')),
  counterparty   text NOT NULL,
  number         text,
  label          text NOT NULL,
  amount_incl_tax numeric(14, 2) NOT NULL CHECK (amount_incl_tax >= 0),
  amount_paid    numeric(14, 2) NOT NULL DEFAULT 0,
  vat_rate       numeric(4, 1) NOT NULL DEFAULT 0,
  issued_at      date NOT NULL,
  due_at         date NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  category_id    text,
  hidden         boolean NOT NULL DEFAULT false,
  account_id     text,
  series_id      text,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE SET NULL (category_id)
);

CREATE TABLE scenarios (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL,
  color      text NOT NULL,
  is_base    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, id)
);
CREATE UNIQUE INDEX scenarios_one_base ON scenarios (company_id) WHERE is_base;

CREATE TABLE budgets (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scenario_id text NOT NULL,
  category_id text NOT NULL,
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  amount      numeric(14, 2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (company_id, scenario_id, category_id, month),
  FOREIGN KEY (company_id, scenario_id) REFERENCES scenarios(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE CASCADE
);

CREATE TABLE rules (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id          text NOT NULL,
  conditions  jsonb NOT NULL,
  category_id text NOT NULL,
  auto_apply  boolean NOT NULL DEFAULT false,
  priority    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE CASCADE
);

CREATE TABLE indicators (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL,
  formula    text NOT NULL,
  unit       text NOT NULL DEFAULT '' CHECK (length(unit) <= 3),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, name)
);

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_at ON audit_logs (company_id, at DESC);

-- ───────────────────────── Row Level Security ─────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
-- Lire : la société du contexte, ou une société dont on est membre
CREATE POLICY companies_select ON companies FOR SELECT
  USING (id = app_company_id() OR id IN (SELECT company_id FROM memberships WHERE user_id = app_user_id()));
-- Créer : toujours en son nom
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (created_by = app_user_id());
CREATE POLICY companies_update ON companies FOR UPDATE USING (id = app_company_id()) WITH CHECK (id = app_company_id());
CREATE POLICY companies_delete ON companies FOR DELETE USING (id = app_company_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (user_id = app_user_id() OR company_id = app_company_id());
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_tenant ON invitations FOR ALL
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'categories', 'transactions', 'commitments', 'scenarios', 'budgets', 'rules', 'indicators', 'audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())',
      t || '_tenant', t);
  END LOOP;
END $$;

-- Recherche d'une invitation par jeton (acceptation, avant tout contexte société)
CREATE OR REPLACE FUNCTION invitation_by_token(p_token_hash text)
RETURNS TABLE (id uuid, company_id uuid, company_name text, email citext, role text, inviter text, expires_at timestamptz, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.company_id, c.name, i.email, i.role, u.first_name, i.expires_at, i.accepted_at
  FROM invitations i
  JOIN companies c ON c.id = i.company_id
  LEFT JOIN users u ON u.id = i.invited_by
  WHERE i.token_hash = p_token_hash
$$;
