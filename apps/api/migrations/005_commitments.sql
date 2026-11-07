-- Lot 4 : factures clients et fournisseurs, séries, rapprochements (7.7, 7.8, 5.11, 5.12).

ALTER TABLE commitments
  ADD COLUMN series_index      integer,
  ADD COLUMN payment_terms     text CHECK (payment_terms IN ('on_receipt', 'd15', 'd30', 'd45', 'd60', 'end_of_month', 'custom')),
  ADD COLUMN vat_amount        numeric(14, 2),
  ADD COLUMN note              text CHECK (length(note) <= 2000),
  ADD COLUMN source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ocr', 'integration')),
  ADD COLUMN import_id         text,
  ADD COLUMN replaced_by       text,
  ADD COLUMN not_duplicate_of  text,
  ADD COLUMN paid_at           date,
  ADD COLUMN created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at        timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT commitments_import_fk
    FOREIGN KEY (company_id, import_id) REFERENCES imports(company_id, id) ON DELETE CASCADE;
CREATE INDEX commitments_series ON commitments (company_id, series_id) WHERE series_id IS NOT NULL;
CREATE INDEX commitments_due ON commitments (company_id, due_at);

-- Rapprochements : une opération peut régler plusieurs factures et inversement
CREATE TABLE reconciliations (
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id             text NOT NULL,
  transaction_id text NOT NULL,
  commitment_id  text NOT NULL,
  amount         numeric(14, 2) NOT NULL CHECK (amount > 0),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, transaction_id, commitment_id),
  FOREIGN KEY (company_id, transaction_id) REFERENCES transactions(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, commitment_id) REFERENCES commitments(company_id, id) ON DELETE CASCADE
);
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliations_tenant ON reconciliations FOR ALL
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- Compte par défaut d'une catégorie (cascade 5.12)
ALTER TABLE categories
  ADD COLUMN default_account_id text,
  ADD CONSTRAINT categories_default_account_fk
    FOREIGN KEY (company_id, default_account_id) REFERENCES bank_accounts(company_id, id) ON DELETE SET NULL (default_account_id);
