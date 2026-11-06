-- Rôles et bases de développement (exécuté au premier démarrage du conteneur)
-- treso_owner : propriétaire du schéma, utilisé pour les migrations uniquement
-- treso_app   : rôle de l'application, soumis aux politiques RLS (pas de BYPASSRLS)
CREATE ROLE treso_owner LOGIN PASSWORD 'treso';
CREATE ROLE treso_app LOGIN PASSWORD 'treso_app';
CREATE DATABASE treso OWNER treso_owner;
CREATE DATABASE treso_test OWNER treso_owner;
