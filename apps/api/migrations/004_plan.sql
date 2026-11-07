-- Lot 3 : plan de trésorerie complet (écran 7.4) et indicateurs (7.13).

-- ───────── Société : début d'exercice (préréglage « Exercice ») ─────────
ALTER TABLE companies
  ADD COLUMN fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- ───────── Scénarios : description, archivage ─────────
ALTER TABLE scenarios
  ADD COLUMN description text CHECK (length(description) <= 500),
  ADD COLUMN archived    boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at  timestamptz NOT NULL DEFAULT now();

-- ───────── Commentaires de cellule (scénario × catégorie × mois) ─────────
CREATE TABLE budget_notes (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scenario_id text NOT NULL,
  category_id text NOT NULL,
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  note        text NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, scenario_id, category_id, month),
  FOREIGN KEY (company_id, scenario_id) REFERENCES scenarios(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id) ON DELETE CASCADE
);
ALTER TABLE budget_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY budget_notes_tenant ON budget_notes FOR ALL
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ───────── Indicateurs : format et ordre ─────────
ALTER TABLE indicators
  ADD COLUMN format     text NOT NULL DEFAULT 'number' CHECK (format IN ('number', 'currency', 'percent')),
  ADD COLUMN decimals   smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 2),
  ADD COLUMN position   integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
