-- La fonction SECURITY DEFINER `invitation_by_token` s'exécute avec le rôle
-- propriétaire : elle doit pouvoir lire invitations et companies hors contexte
-- société. On retire donc FORCE ROW LEVEL SECURITY sur ces deux tables
-- (le propriétaire n'est utilisé que pour les migrations). Le rôle applicatif,
-- qui n'est pas propriétaire, reste soumis aux politiques RLS.
ALTER TABLE invitations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE companies NO FORCE ROW LEVEL SECURITY;
