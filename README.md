# Tréso Optimum

Logiciel de pilotage de trésorerie pour TPE/PME, aux couleurs de la charte Optimum.
Le dépôt contient le **lot 0** (design system), le **lot 1** (API, base de données,
authentification, sociétés et rôles), le **lot 2** (banques, opérations bancaires, import de
relevés, règles de catégorisation), le **lot 3** (plan de trésorerie complet, scénarios,
assistant prévisionnel, indicateurs), le **lot 4** (factures, rapprochements, vue au jour le jour,
alertes), le **lot 5** (analyses, rapport PDF, exports XLSX / CSV, import des budgets) et les
écrans branchés sur l'API.

## Essayer sans être développeur

Suivez le guide [LANCER-EN-LOCAL.md](LANCER-EN-LOCAL.md) : installer Docker Desktop, puis
`docker compose up --build` dans le dossier du projet, et ouvrir http://localhost:8080.

## Mettre en ligne (VPS OVH)

Guide pas à pas : [deploy/DEPLOIEMENT-OVH.md](deploy/DEPLOIEMENT-OVH.md). Une fois installé, chaque
publication sur `main` est testée puis mise en ligne automatiquement par GitHub Actions
(`.github/workflows/deploy.yml`). En production, l'API refuse de démarrer sans serveur SMTP et
n'expose jamais les liens des emails ; les inscriptions peuvent être réservées à certains domaines
(`SIGNUP_ALLOWED_DOMAINS`).

## Démarrer en local (développeurs)

Prérequis : Node 22, pnpm 10 et PostgreSQL 16 (ou Docker).

```bash
docker compose up -d db     # PostgreSQL + rôles treso_owner / treso_app + bases treso et treso_test
pnpm install
cp apps/api/.env.example apps/api/.env   # facultatif : les valeurs par défaut conviennent en local
pnpm dev                    # API sur :3000 (migrations appliquées au démarrage) + front sur :5173
```

Ouvrez http://localhost:5173, créez un compte puis choisissez « Données de démonstration »
pour explorer avec « Atelier Démo », ou « Mon entreprise » pour partir d'une société vide.

En développement, aucun email n'est réellement envoyé : le lien de confirmation (et ceux
de connexion, de réinitialisation et d'invitation) s'affiche directement à l'écran et dans
les journaux de l'API. Brancher un fournisseur (Brevo, Postmark) en implémentant `Mailer`
(`apps/api/src/mailer.ts`) avant la production.

```bash
pnpm test        # moteur de calcul (54 tests) + API (36 tests d'intégration sur PostgreSQL)
pnpm typecheck
pnpm build
```

## Structure

```
packages/engine      @optimum/treso-engine — règles de calcul (cahier des charges, section 5)
packages/demo-data   @optimum/demo-data — jeu « Atelier Démo » et arbre de catégories par défaut
apps/api             @optimum/api — API REST Fastify + PostgreSQL
apps/web             @optimum/web — application React (Vite, TypeScript, Ant Design)
```

### API (`apps/api`)

- **Isolation des sociétés par Row Level Security.** L'API se connecte avec un rôle
  `treso_app` qui n'est ni propriétaire des tables ni `BYPASSRLS`. Chaque requête ouvre une
  transaction qui positionne `app.user_id` et `app.company_id` ; les politiques ne laissent
  voir et écrire que les lignes de la société active. Les migrations passent par le rôle
  `treso_owner`. Un test vérifie qu'en SQL direct, sous le rôle applicatif, une autre
  société reste invisible et inaccessible en écriture.
- **Authentification** : mot de passe (Argon2id, 10 caractères minimum, sans règle de
  composition arbitraire), lien magique, vérification de l'adresse, mot de passe oublié.
  Jeton d'accès JWT de 15 minutes gardé en mémoire côté front ; session longue dans un cookie
  `httpOnly` avec **rotation à chaque usage et révocation de toute la famille en cas de
  réutilisation** (vol présumé). Limitation à 10 tentatives par minute sur les routes d'authentification.
- **Sociétés et rôles** : Propriétaire, Administrateur, Contributeur, Conseiller Optimum
  (scénarios alternatifs uniquement), Lecteur. Droits vérifiés par l'API (403).
- **Invitations** par email (7 jours, usage unique), avec création de compte à l'acceptation.
- **Journal d'activité** des modifications (budgets, scénarios, opérations, membres, paramètres).
- Erreurs au format RFC 9457 (`application/problem+json`), messages en français.

Principales routes (`/api/v1`) : `auth/*`, `me`, `companies`, `companies/current`,
`memberships`, `invitations`, `bootstrap`, `budgets`, `scenarios`, `transactions/batch`,
`reconciliations`, `commitments/:id`, `rules`, `audit-logs`.

### Application (`apps/web`)

- Connexion, inscription, confirmation de l'adresse, lien magique, mot de passe oublié,
  invitation, création de société (réelle ou démonstration), changement de société.
- Accueil, À traiter, Plan de trésorerie : les modifications s'affichent immédiatement puis
  sont envoyées à l'API ; « Annuler » envoie les opérations inverses ; en cas d'échec,
  l'erreur s'affiche et les données sont rechargées.
- Paramètres : Société (seuil, mode du plan, TVA, factures, suppression), Mon profil
  (thème synchronisé entre appareils), Utilisateurs (invitations, rôles), Journal d'activité.
- L'interface s'adapte au rôle : un lecteur consulte sans pouvoir modifier.

### Lot 2 : banques et opérations

- **Banques** (Paramètres › Banques) : connexion via l'agrégateur **Bridge** (adaptateur v3 dans
  `apps/api/src/banking/bridge.ts`, activé par `BRIDGE_CLIENT_ID` et `BRIDGE_CLIENT_SECRET`) ou via
  la **banque de démonstration** (toujours disponible, 2 comptes et 90 jours d'opérations) ;
  synchronisation sans doublon, état de la connexion, comptes inclus ou exclus de la trésorerie,
  solde retenu (solde, comptable, instantané), compte par défaut des factures, comptes manuels
  (caisse, banque non couverte), limite d'une banque sur l'offre Essentiel.
- **Opérations bancaires** (`/operations`) : recherche (libellé, tiers, montant exact ou « ~120 »),
  filtres (comptes, période, sens, état, catégories), catégorisation en place avec proposition
  « Appliquer aux similaires » et « Créer une règle », détail dans un panneau (date d'imputation,
  note, exclusion), **division** en parts égales ou en pourcentages (« Reste à répartir » à 0 pour
  valider), sélection multiple, export CSV, saisie manuelle, suppression des opérations saisies ou importées.
- **Import de relevés CSV** en 3 étapes (fichier, correspondance des colonnes mémorisée, vérification
  des erreurs et des doublons), encodage UTF-8 ou Windows ; annulable depuis Paramètres › Imports.
- **Règles** (Paramètres › Règles) : conditions combinables, aperçu en direct, application
  automatique ou simple suggestion, ordre de priorité, application aux opérations existantes.
- **Exclusions automatiques** (réglables dans Paramètres › Société) : remboursements et virements
  entre les comptes de la société.

> L'adaptateur Bridge suit la documentation publique v3 ; il reste à le valider sur le bac à sable
> Bridge avec de vrais identifiants. La synchronisation planifiée (4 fois par jour) et les webhooks
> Bridge viendront avec la mise en production.

### Lot 3 : plan de trésorerie

- **Grille tableur** (`/plan`, bouton « Modifier les budgets » ou touche E) : flèches, Tab, Entrée
  (retour à la colonne de départ, comme Excel), Échap, Suppr, Début/Fin ; saisie directe ou formule
  (`=8500*1,05`) ; **collage d'une plage Excel** ; copie vers Excel ; **poignée de recopie** ;
  annulation des 20 dernières saisies (Ctrl/⌘ Z) ; enregistrement automatique (« Enregistré »).
- **Menu de cellule** (clic droit) : Répéter… (tous les 1 à 12 mois pendant 1 à 36 mois, raccourcis),
  Augmenter de x % jusqu'à la fin de la période, Revenir à la valeur de base, commentaire (coin orange),
  détail. Ligne TVA : « Calculer la TVA » (régime mensuel ou trimestriel).
- **Affichage** : période (12 mois glissants, année civile, exercice, personnalisée ≤ 24 mois),
  comptes, graphique + grille ou grille seule, colonne Total personnalisable (« Personnaliser le cumul »),
  survol du graphique qui surligne le mois, mini-barre du mois courant, horloge des factures en
  retard, valeur de base en infobulle dans les scénarios alternatifs.
- **Scénarios** : créer (description, couleur, point de départ), renommer, couleur, dupliquer,
  archiver / restaurer, supprimer ; vue **Comparer** (solde fin par scénario et écart à la base).
- **Assistant prévisionnel** : historique 3/6/12 mois (mois exceptionnels exclus), croissance par
  sens, événements (recrutement, investissement, emprunt, levée de fonds), application au scénario
  de base ou dans un nouveau scénario.
- **Indicateurs** (`/indicateurs`) : modèles prêts (marge brute, poids de la masse salariale,
  frais généraux / CA…), éditeur avec autocomplétion des catégories, validation en direct et
  aperçu sur 6 mois ; affichés dans le plan.

Mesures (navigateur, mode développement) : plan de 24 mois affiché en ~0,4 s ; 16 catégories × 12 mois
saisies au clavier sans souris ; collage Excel 12 × 20 couvert par les tests du moteur.

### Lot 4 : factures, rapprochements, au jour le jour, alertes

- **Factures clients et fournisseurs** (`/factures/clients`, `/factures/fournisseurs`) : 3 KPI
  cliquables, vues (À venir, En retard, Payées, Rapprochements, Doublons), catégorie en place,
  compte attendu (cascade 5.12) sous chaque ligne, bandeau « Choisir le compte » par défaut.
- **Saisie** dans un panneau : tiers avec autocomplétion (catégorie, TVA, délai et compte habituels
  pré-remplis), TVA calculée, délai de paiement ↔ échéance, **échéances récurrentes** (1 à 120),
  modification ou suppression « cette échéance » / « et les suivantes ».
- **Actions** : marquer payée, **rapprocher** d'un ou plusieurs paiements (candidats triés par
  score, paiements partiels, « Le total des factures dépasse le montant de ce paiement »),
  annuler un rapprochement, décaler, dupliquer, exclure des totaux, supprimer, **relancer le
  client** par email.
- **Doublons** : échéance saisie à la main vs facture importée, « Remplacer » ou « Garder les deux ».
- **Import CSV / XLSX** en 3 étapes (correspondance mémorisée, erreurs par ligne, catégories reconnues).
- **Au jour le jour** (`/journalier`) : comptes, période, jour / semaine / mois, comparaison de
  comptes, budgets non couverts en option, 4 KPI, graphique avec zoom, simulation d'un report
  d'échéance puis enregistrement.
- **Alertes** (cloche) : trésorerie sous le seuil dans les 60 jours, factures clients en retard de
  plus de 7 jours, budget dépassé de plus de 10 %, banque à resynchroniser depuis plus de 24 h.

> Non inclus : dépôt de factures avec lecture automatique (OCR), connexion aux logiciels de
> facturation, envoi quotidien des alertes par email.

### Lot 5 : analyses et exports

- **Analyses** (`/analyses`) : période (12 derniers mois par défaut), comparaison avec la période
  précédente, 10 KPI de la règle 5.9 avec explication « ? », où va / d'où vient l'argent (barres
  dépliables), évolution de 6 catégories au plus (réalisé plein, prévision en pointillés),
  prévu vs réalisé sur les mois écoulés budgétés, top 10 clients et fournisseurs avec délai moyen
  et concentration.
- **Rapport PDF** : « Télécharger le rapport PDF » imprime une mise en page A4 dédiée (couverture
  avec logo et motif Optimum, synthèse, KPI, graphiques) ; choisir « Enregistrer en PDF ».
- **Exporter** (plan et analyses) : période (24 mois max), contenus (plan, prévu vs réalisé,
  budgets saisis, opérations, factures, au jour le jour, indicateurs), scénarios, format XLSX
  (un onglet par contenu, logo, en-têtes pétrole, formats € et dates, volets figés) ou CSV
  (point-virgule, archive ZIP).
- **Importer des budgets** (plan) : modèle téléchargeable, XLSX ou CSV, mois reconnus sous toutes
  les formes courantes (« janv. 2027 », « 01/2027 »…), catégories par chemin ou par nom, erreurs
  par ligne ; l'export « Budgets saisis » se réimporte sans perte ; annulable avec Ctrl/⌘ Z.

> Non inclus : exports programmés par email et génération du PDF côté serveur.

### Catégories (Paramètres › Catégories)

- Deux arbres (encaissements, décaissements) : icône et couleur, type (chiffre d'affaires,
  achats, frais généraux, masse salariale), TVA, nombre d'opérations sur 12 mois.
- **Glisser-déposer** pour réordonner ou changer de parent ; si des budgets sont concernés,
  aperçu (« Les budgets de Loyer (12 mois) seront regroupés dans Frais généraux… ») et choix
  « Conserver en additionnant » / « Supprimer les budgets ».
- Panneau d'édition : nom, icône, couleur, note, TVA, type (hérité du parent sinon), compte par
  défaut des factures (avec report sur les factures non payées), budget global au niveau du parent,
  sous-catégorie, **fusion** et **suppression avec déplacement** (opérations, factures, règles,
  budgets additionnés, sous-catégories).
- **Modèles sectoriels** (Commerce, Services, BTP, Restauration, Profession libérale) : ajoutent
  les catégories manquantes, sans rien supprimer.

### Lot 6 (en cours) : pré-comptabilité

- **Pré-comptabilité** (`/precompta`) : flux À traiter → À vérifier → Prêtes à envoyer → Envoyées,
  écritures proposées depuis les factures (journaux VT / HA : tiers 411 / 401, produit ou charge HT,
  TVA collectée / déductible par taux) et les opérations bancaires (journal par banque, contre le
  tiers si la facture est rapprochée), vérification avec la pièce à côté, lignes modifiables,
  **équilibre contrôlé en direct : une écriture déséquilibrée ne peut pas être validée**,
  numérotation continue par journal, refus avec motif, envoi.
- **Configuration** : logiciel comptable, plan de comptes (PCG par défaut, un 512 par banque),
  comptes de TVA par taux, correspondances catégorie ↔ compte proposées automatiquement, journaux.
- **Export FEC** (article A47 A-1 du LPF) : 18 colonnes, contrôle de conformité bloquant avant
  téléchargement (SIREN, équilibre, numérotation, validation), archive ZIP.
- SIREN modifiable dans Paramètres › Société.

### Moteur de calcul (`packages/engine`)

| Fichier | Règles |
| --- | --- |
| `plan.ts` | 5.1 agrégation, 5.2 scénarios calques, 5.3 prévision (Budget / Projection, budget global), 5.4 soldes, 5.5 factures en retard |
| `budgets.ts` | 5.7 répétition d'une valeur, assistant « partir de mon historique » |
| `invoices.ts` | Délais, séries récurrentes, statuts, 5.11 rapprochements et scores, 5.12 compte d'une facture, doublons, import, relance |
| `daily.ts` | Projection au jour le jour, regroupement semaine / mois, KPI, 5.13 alertes |
| `analytics.ts` | 5.9 KPI sur une période, période précédente, répartition par catégorie, prévu vs réalisé, tiers |
| `exports.ts` | Contenus d'export (onglets typés), CSV, modèle et import des budgets |
| `categories.ts` | Déplacements et conséquences sur les budgets, fusion, modèles sectoriels |
| `precompta.ts` | Plan comptable, correspondances, écritures depuis factures et opérations, équilibre, FEC |
| `planning.ts` | Saisie et formules de cellule, collage Excel, recopie, hausse en %, périodes (24 mois max), assistant (historique, croissance, événements, emprunt), comparaison de scénarios, TVA en budgets |
| `indicators.ts` | 5.6 indicateurs personnalisés : parseur arithmétique, sans `eval` |
| `vat.ts` | 5.8 estimation de la TVA |
| `kpis.ts` | 5.9 ratios, autonomie, soldes quotidiens, 5.13 seuil |
| `categorize.ts` | 5.10 règles et suggestions par similarité |
| `split.ts` | Division d'une opération |

## Prochaines étapes

1. Lot 6 : abonnement, intégrations, conseiller, pré-comptabilité.
2. Passkeys et connexion Google / Microsoft (prévues au cahier des charges, non incluses ici).
3. Fournisseur d'emails réel et vérification des mots de passe compromis (Have I Been Pwned).

Le logo « optimum tréso » est une reconstitution provisoire : à remplacer par le fichier du graphiste.
