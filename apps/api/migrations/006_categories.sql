-- Écran Catégories (7.9) : icône, couleur, note.
ALTER TABLE categories
  ADD COLUMN icon       text CHECK (length(icon) <= 40),
  ADD COLUMN color      text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN note       text CHECK (length(note) <= 500),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
