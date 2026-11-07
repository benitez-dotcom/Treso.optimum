#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Installation de Tréso Optimum sur un VPS Ubuntu 24.04 (OVH ou autre).
# À lancer UNE fois, en root, sur un serveur neuf :
#   curl -fsSL https://raw.githubusercontent.com/benitez-dotcom/Treso.optimum/main/deploy/install.sh -o install.sh
#   sudo bash install.sh
# Le script pose quelques questions, installe Docker, le pare-feu, l'application,
# le HTTPS, les sauvegardes quotidiennes et l'accès pour les mises à jour automatiques.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="https://github.com/benitez-dotcom/Treso.optimum.git"
DIR="/opt/treso"
BACKUPS="/opt/treso-backups"

if [ "$(id -u)" -ne 0 ]; then echo "Lancez ce script avec sudo : sudo bash install.sh"; exit 1; fi

ask() { local prompt="$1" default="${2:-}" answer; read -r -p "$prompt${default:+ [$default]} : " answer; echo "${answer:-$default}"; }
ask_secret() { local prompt="$1" answer; read -r -s -p "$prompt : " answer; echo >&2; echo "$answer"; }

echo
echo "=== Installation de Tréso Optimum ==="
echo
DOMAIN=$(ask "Adresse du site" "treso.optimumgestion.fr")
echo
echo "Mot de passe d'accès au site pendant la phase de test (demandé avant même l'écran de connexion) :"
BASIC_AUTH_USER=$(ask "  Identifiant" "optimum")
BASIC_AUTH_PASS=$(ask_secret "  Mot de passe")
echo
echo "Envoi des emails (confirmation d'adresse, invitations, mot de passe oublié)."
echo "Créez d'abord une adresse dans OVH, par exemple no-reply@optimumgestion.fr."
SMTP_USER=$(ask "  Adresse email d'envoi" "no-reply@optimumgestion.fr")
SMTP_PASS=$(ask_secret "  Mot de passe de cette adresse")
SMTP_HOST=$(ask "  Serveur SMTP" "ssl0.ovh.net")
SMTP_PORT=$(ask "  Port SMTP" "465")
echo
SIGNUP_ALLOWED_DOMAINS=$(ask "Domaines autorisés à créer un compte sans invitation (séparés par des virgules)" "optimumgestion.fr,groupe-jba.fr")

echo
echo "→ Installation de Docker, Git et du pare-feu…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git ufw unattended-upgrades >/dev/null
systemctl enable --now docker >/dev/null

echo "→ Pare-feu : seuls SSH, HTTP et HTTPS sont ouverts…"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "→ Utilisateur « deploy » pour les mises à jour automatiques…"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ ! -f /root/treso-deploy-key ]; then
  ssh-keygen -q -t ed25519 -N "" -C "github-actions-treso" -f /root/treso-deploy-key
fi
cat /root/treso-deploy-key.pub > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "→ Récupération de l'application…"
if [ ! -d "$DIR/.git" ]; then git clone --quiet "$REPO" "$DIR"; fi
chown -R deploy:deploy "$DIR"
git config --system --add safe.directory "$DIR"

echo "→ Préparation des secrets…"
BASIC_AUTH_HASH=$(docker run --rm caddy:2.8 caddy hash-password --plaintext "$BASIC_AUTH_PASS")
ENV_FILE="$DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
OWNER_DB_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
BASIC_AUTH_USER=$BASIC_AUTH_USER
BASIC_AUTH_HASH='$BASIC_AUTH_HASH'
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS='$SMTP_PASS'
SMTP_FROM='Tréso Optimum <$SMTP_USER>'
SIGNUP_ALLOWED_DOMAINS=$SIGNUP_ALLOWED_DOMAINS
# Agrégateur bancaire Bridge (à renseigner quand vous aurez vos identifiants) :
BRIDGE_CLIENT_ID=
BRIDGE_CLIENT_SECRET=
ENV
  chown deploy:deploy "$ENV_FILE"
else
  echo "  (deploy/.env existe déjà : conservé tel quel)"
fi

echo "→ Démarrage (la première fois, comptez 5 à 10 minutes)…"
sudo -u deploy docker compose -f "$DIR/deploy/docker-compose.prod.yml" up -d --build

echo "→ Sauvegarde quotidienne de la base (3 h du matin, 14 jours conservés)…"
install -d -m 700 "$BACKUPS"
cat > /etc/cron.d/treso-backup <<CRON
0 3 * * * root docker compose -f $DIR/deploy/docker-compose.prod.yml exec -T db pg_dump -U postgres treso | gzip > $BACKUPS/treso-\$(date +\%F).sql.gz && find $BACKUPS -name 'treso-*.sql.gz' -mtime +14 -delete
CRON

IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "════════════════════════════════════════════════════════════════════"
echo " Tréso Optimum est installé : https://$DOMAIN"
echo " (si la page ne s'ouvre pas, vérifiez que $DOMAIN pointe bien vers $IP)"
echo
echo " Dernière étape : dans GitHub › Treso.optimum › Settings › Secrets and"
echo " variables › Actions › New repository secret, créez ces 3 secrets :"
echo
echo "   VPS_HOST     →  $IP"
echo "   VPS_USER     →  deploy"
echo "   VPS_SSH_KEY  →  tout le bloc ci-dessous, lignes BEGIN et END comprises :"
echo
cat /root/treso-deploy-key
echo "════════════════════════════════════════════════════════════════════"
