# Lancer Tréso Optimum sur votre ordinateur

Ce guide ne demande aucune compétence de développeur. Il faut une seule installation
(Docker Desktop), puis une seule commande. Comptez 10 minutes la première fois.

## 1. Installer Docker Desktop (une seule fois)

1. Téléchargez Docker Desktop : https://www.docker.com/products/docker-desktop/
   - Mac : choisissez « Apple Silicon » (puce M1, M2, M3…) ou « Intel » selon votre Mac
     (menu Pomme > À propos de ce Mac).
   - Windows : choisissez « Windows » et acceptez l'installation de WSL si elle est proposée.
2. Installez-le, puis **ouvrez Docker Desktop** et attendez qu'il indique qu'il est démarré
   (la baleine en haut de l'écran ne bouge plus). Il doit rester ouvert pendant l'utilisation.

## 2. Récupérer le projet

1. Ouvrez https://github.com/benitez-dotcom/Treso.optimum
2. Cliquez sur le bouton vert **Code**, puis **Download ZIP**.
3. Décompressez le fichier téléchargé (double-clic). Vous obtenez un dossier
   `Treso.optimum-main`. Placez-le où vous voulez, par exemple dans Documents.

## 3. Lancer l'application

1. Ouvrez un terminal **dans ce dossier** :
   - Mac : clic droit sur le dossier `Treso.optimum-main` > **Nouveau terminal au dossier**
     (si l'option n'apparaît pas : Réglages Système > Clavier > Raccourcis clavier > Services,
     cochez « Nouveau terminal au dossier »).
   - Windows : ouvrez le dossier, clic droit dans un espace vide > **Ouvrir dans le terminal**.
2. Tapez cette commande puis appuyez sur Entrée :

   ```
   docker compose up --build
   ```

3. La première fois, patientez 3 à 5 minutes. C'est prêt quand vous voyez une ligne
   contenant `Server listening at`.
4. Ouvrez votre navigateur à l'adresse **http://localhost:8080**

## 4. Premier usage

1. Cliquez sur **Créer mon compte** et remplissez le formulaire.
2. Aucun email n'est envoyé en local : le lien de confirmation s'affiche directement à
   l'écran (encadré « Mode développement »). Cliquez dessus.
3. Choisissez **Données de démonstration** pour explorer avec « Atelier Démo », ou
   **Mon entreprise** pour partir d'une société vide.
4. Pour essayer la partie bancaire : **Paramètres › Banques › Connecter la banque de
   démonstration**, puis ouvrez **Opérations bancaires**.

## Arrêter et relancer

- Arrêter : dans le terminal, appuyez sur **Ctrl + C**.
- Relancer plus tard : rouvrez un terminal dans le dossier et tapez `docker compose up`
  (plus rapide, sans `--build`). Vos comptes et données sont conservés.
- Après avoir téléchargé une nouvelle version du projet : `docker compose up --build`.
- Tout effacer et repartir de zéro : `docker compose down -v`

## En cas de problème

| Message | Solution |
| --- | --- |
| `docker: command not found` ou « commande introuvable » | Docker Desktop n'est pas installé ou pas ouvert. Ouvrez-le, attendez qu'il démarre, puis relancez la commande dans un nouveau terminal. |
| Windows : « Le terme docker n'est pas reconnu… » | Docker Desktop n'est pas démarré, ou le terminal a été ouvert avant la fin de l'installation. Lancez Docker Desktop (menu Démarrer), attendez « Engine running », **fermez le terminal et rouvrez-en un** dans le dossier, puis vérifiez avec `docker --version`. Si rien ne s'affiche, réinstallez Docker Desktop (Windows – AMD64) et redémarrez le PC. |
| `Cannot connect to the Docker daemon` | Docker Desktop est installé mais pas démarré : ouvrez-le. |
| `port is already allocated` (5432 ou 8080) | Un autre logiciel utilise ce port (souvent un PostgreSQL déjà installé). Fermez-le, ou envoyez le message complet à votre développeur. |
| La page http://localhost:8080 ne s'affiche pas | Attendez la ligne `Server listening at` dans le terminal, puis rechargez la page. |
