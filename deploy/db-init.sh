#!/bin/sh
# Premier démarrage de la base : rôles et base de Tréso Optimum, mots de passe tirés de deploy/.env.
# treso_owner : propriétaire du schéma (migrations) ; treso_app : application, soumise au cloisonnement RLS.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE treso_owner LOGIN PASSWORD '${OWNER_DB_PASSWORD}';
CREATE ROLE treso_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE DATABASE treso OWNER treso_owner;
SQL
