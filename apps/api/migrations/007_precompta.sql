-- Pré-comptabilité (7.16) : plan de comptes, correspondances, écritures.

CREATE TABLE precompta_settings (
  company_id   uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'demo', 'other')),
  software     text CHECK (length(software) <= 80),
  dossier_code text CHECK (length(dossier_code) <= 40),
  vat_accounts jsonb,
  journals     jsonb,
  suspense     text NOT NULL DEFAULT '471000',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_accounts (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number     text NOT NULL CHECK (number ~ '^[0-9]{3,}[A-Z0-9]*$'),
  label      text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  type       text NOT NULL CHECK (type IN ('client', 'supplier', 'bank', 'expense', 'revenue', 'vat', 'general')),
  hidden     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, number)
);

CREATE TABLE category_accounts (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id text NOT NULL,
  account     text NOT NULL,
  PRIMARY KEY (company_id, category_id),
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE CASCADE
);

CREATE TABLE entries (
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id              text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('commitment', 'transaction', 'manual')),
  source_id       text,
  journal         text NOT NULL CHECK (length(journal) BETWEEN 1 AND 10),
  date            date NOT NULL,
  piece_ref       text NOT NULL,
  piece_date      date NOT NULL,
  label           text NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'sent', 'rejected')),
  number          integer,
  validated_at    timestamptz,
  sent_at         timestamptz,
  rejected_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, journal, number)
);
CREATE UNIQUE INDEX entries_source ON entries (company_id, source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE entry_lines (
  company_id uuid NOT NULL,
  entry_id   text NOT NULL,
  line_no    integer NOT NULL,
  account    text NOT NULL,
  aux_account text,
  aux_label  text,
  label      text NOT NULL DEFAULT '',
  debit      numeric(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit     numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  PRIMARY KEY (company_id, entry_id, line_no),
  FOREIGN KEY (company_id, entry_id) REFERENCES entries(company_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['precompta_settings', 'ledger_accounts', 'category_accounts', 'entries', 'entry_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t || '_tenant', t);
  END LOOP;
END $$;
