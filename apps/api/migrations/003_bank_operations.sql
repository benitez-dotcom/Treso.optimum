-- Tréso Optimum — lot 2 : banques, opérations, imports
-- Connexions bancaires, comptes enrichis (manuels, solde retenu, compte par défaut),
-- opérations divisées, date d'imputation, imports annulables, exclusions automatiques.

-- ───────── Société : exclusions automatiques (5.10) ─────────
ALTER TABLE companies
  ADD COLUMN auto_hide_refunds            boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_hide_internal_transfers boolean NOT NULL DEFAULT true;

-- ───────── Connexions bancaires ─────────
CREATE TABLE bank_connections (
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id                     text NOT NULL,
  provider               text NOT NULL CHECK (provider IN ('demo', 'bridge')),
  provider_connection_id text,
  bank_name              text NOT NULL,
  status                 text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'action_required', 'error')),
  status_detail          text,
  last_sync_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id)
);
CREATE UNIQUE INDEX bank_connections_provider ON bank_connections (company_id, provider, provider_connection_id)
  WHERE provider_connection_id IS NOT NULL;

-- ───────── Comptes ─────────
ALTER TABLE bank_accounts
  ADD COLUMN connection_id              text,
  ADD COLUMN provider_account_id        text,
  ADD COLUMN display_name               text,
  ADD COLUMN type                       text NOT NULL DEFAULT 'checking'
                                        CHECK (type IN ('checking', 'savings', 'card', 'loan', 'cash', 'other')),
  ADD COLUMN balance_provider           numeric(14, 2),
  ADD COLUMN booked_balance             numeric(14, 2),
  ADD COLUMN instant_balance            numeric(14, 2),
  ADD COLUMN balance_source             text NOT NULL DEFAULT 'balance'
                                        CHECK (balance_source IN ('balance', 'booked', 'instant')),
  ADD COLUMN is_manual                  boolean NOT NULL DEFAULT false,
  ADD COLUMN opening_balance            numeric(14, 2),
  ADD COLUMN opening_date               date,
  ADD COLUMN is_default_for_commitments boolean NOT NULL DEFAULT false,
  ADD COLUMN ignore_deferred_card       boolean NOT NULL DEFAULT false,
  ADD COLUMN currency                   text NOT NULL DEFAULT 'EUR',
  ADD COLUMN iban_masked                text,
  ADD COLUMN last_sync_at               timestamptz,
  ADD CONSTRAINT bank_accounts_connection_fk
    FOREIGN KEY (company_id, connection_id) REFERENCES bank_connections(company_id, id) ON DELETE SET NULL (connection_id),
  ADD CONSTRAINT bank_accounts_manual_opening CHECK (NOT is_manual OR (opening_balance IS NOT NULL AND opening_date IS NOT NULL));
CREATE UNIQUE INDEX bank_accounts_one_default ON bank_accounts (company_id) WHERE is_default_for_commitments;
CREATE UNIQUE INDEX bank_accounts_provider ON bank_accounts (company_id, connection_id, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- ───────── Imports ─────────
CREATE TABLE imports (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id         text NOT NULL,
  type       text NOT NULL CHECK (type IN ('transactions', 'commitments', 'budgets')),
  file_name  text NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  mapping    jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id)
);

CREATE TABLE import_mappings (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('transactions', 'commitments', 'budgets')),
  mapping    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, type)
);

-- ───────── Opérations ─────────
ALTER TABLE transactions
  ADD COLUMN original_booked_at      date,
  ADD COLUMN parent_id               text,
  ADD COLUMN is_split                boolean NOT NULL DEFAULT false,
  ADD COLUMN source                  text NOT NULL DEFAULT 'bank' CHECK (source IN ('bank', 'manual', 'import', 'split')),
  ADD COLUMN import_id               text,
  ADD COLUMN provider_transaction_id text,
  ADD COLUMN hidden_reason           text CHECK (hidden_reason IN ('manual', 'refund', 'internal_transfer')),
  ADD COLUMN created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at              timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT transactions_parent_fk
    FOREIGN KEY (company_id, parent_id) REFERENCES transactions(company_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT transactions_import_fk
    FOREIGN KEY (company_id, import_id) REFERENCES imports(company_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX transactions_provider ON transactions (company_id, account_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX transactions_parent ON transactions (company_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX transactions_import ON transactions (company_id, import_id) WHERE import_id IS NOT NULL;

-- ───────── Règles : libellé lisible et compteur ─────────
ALTER TABLE rules
  ADD COLUMN vat_rate   numeric(4, 1),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- ───────── Row Level Security des nouvelles tables ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_connections', 'imports', 'import_mappings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())',
      t || '_tenant', t);
  END LOOP;
END $$;
