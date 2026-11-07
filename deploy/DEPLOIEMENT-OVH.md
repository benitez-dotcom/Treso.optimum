# Mettre Tréso Optimum en ligne sur OVH

Résultat : l'application est accessible sur **https://treso.optimumgestion.fr** et se met à jour
toute seule, 5 à 10 minutes après chaque nouvelle version publiée sur GitHub.
Comptez 30 minutes, une seule fois.

## 1. Commander un VPS

Votre hébergement Web (offre PRO) sert aux sites internet ; l'application a besoin d'un serveur
privé virtuel (VPS).

1. Espace client OVH › **Bare Metal Cloud** › **Serveurs privés virtuels** › **Commander**.
2. Choisissez le premier niveau de VPS, localisation **France** (Gravelines ou Strasbourg).
3. Système d'exploitation : **Ubuntu 24.04**.
4. Vous recevez par email l'**adresse IP** du VPS, l'identifiant (`ubuntu`) et le mot de passe.

## 2. Faire pointer le sous-domaine vers le VPS

1. Espace client OVH › **Web Cloud** › **Noms de domaine** › **optimumgestion.fr** › onglet **Zone DNS**.
2. **Ajouter une entrée** › type **A**.
3. Sous-domaine : `treso` · Cible : l'adresse IP du VPS · Valider.

La prise en compte prend de quelques minutes à quelques heures.

## 3. Créer l'adresse d'envoi des emails

L'application envoie des emails (confirmation d'adresse, invitations, mot de passe oublié).

1. Espace client OVH › **Web Cloud** › **Emails** › **optimumgestion.fr** › **Créer une adresse email**.
2. Créez par exemple `no-reply@optimumgestion.fr` et notez son mot de passe.

## 4. Installer l'application sur le VPS

1. Ouvrez un terminal sur votre PC (menu Démarrer › « Terminal ») et connectez-vous au VPS :

   ```
   ssh ubuntu@ADRESSE_IP_DU_VPS
   ```

   Tapez `yes` à la première question, puis le mot de passe reçu d'OVH (il ne s'affiche pas
   pendant la saisie, c'est normal).

2. Copiez-collez ces deux lignes :

   ```
   curl -fsSL https://raw.githubusercontent.com/benitez-dotcom/Treso.optimum/main/deploy/install.sh -o install.sh
   sudo bash install.sh
   ```

3. Répondez aux questions (Entrée = valeur proposée entre crochets) :
   - adresse du site : `treso.optimumgestion.fr` ;
   - identifiant et mot de passe d'accès au site pendant la phase de test ;
   - l'adresse `no-reply@…` et son mot de passe ;
   - les domaines autorisés à créer un compte (les autres personnes passent par une invitation).

À la fin, le script affiche **3 informations à copier** pour l'étape suivante. Gardez le terminal ouvert.

## 5. Brancher les mises à jour automatiques

1. Sur GitHub, ouvrez **Treso.optimum** › **Settings** › **Secrets and variables** › **Actions**.
2. **New repository secret**, trois fois :

| Name | Secret |
| --- | --- |
| `VPS_HOST` | l'adresse IP affichée |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | tout le bloc affiché, de `-----BEGIN OPENSSH PRIVATE KEY-----` à `-----END OPENSSH PRIVATE KEY-----` inclus |

C'est terminé. Ouvrez https://treso.optimumgestion.fr : le navigateur demande l'identifiant
d'accès, puis l'écran de connexion de l'application s'affiche. Créez votre compte avec une
adresse d'un domaine autorisé.

## Au quotidien

- **Mises à jour** : automatiques. L'onglet **Actions** de GitHub montre chaque mise en ligne
  (pastille verte = en ligne ; rouge = un test a échoué, rien n'a été modifié sur le serveur).
- **Sauvegardes** : chaque nuit à 3 h dans `/opt/treso-backups` sur le VPS, 14 jours conservés.
  Pensez aussi à activer l'option de sauvegarde automatique du VPS chez OVH.
- **Mettre à jour à la main** : `ssh ubuntu@IP` puis `sudo -u deploy /opt/treso/deploy/update.sh`.
- **Changer un réglage** (mot de passe d'accès, Bridge…) : modifier `/opt/treso/deploy/.env`
  puis relancer la commande de mise à jour.

## En cas de problème

| Symptôme | Solution |
| --- | --- |
| La page ne s'ouvre pas du tout | Le sous-domaine ne pointe pas encore vers le VPS (étape 2) : patientez, ou vérifiez l'IP dans la zone DNS. |
| « Votre connexion n'est pas privée » | Le certificat HTTPS se crée au premier accès, une fois le DNS à jour : patientez 2 minutes et rechargez. |
| Les emails n'arrivent pas | Vérifiez l'adresse et le mot de passe `SMTP_USER` / `SMTP_PASS` dans `/opt/treso/deploy/.env`, puis relancez la mise à jour. |
| Pastille rouge dans GitHub Actions | Ouvrez-la et envoyez la capture à votre développeur : la version en ligne n'a pas changé. |
