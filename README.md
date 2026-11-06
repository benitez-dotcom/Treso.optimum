# Tréso Optimum

Logiciel de pilotage de trésorerie pour TPE/PME, aux couleurs de la charte Optimum.
Le dépôt contient le **lot 0** (design system), le **lot 1** (API, base de données,
authentification, sociétés et rôles) et les premiers écrans branchés sur l'API.

## Essayer sans être développeur

Suivez le guide [LANCER-EN-LOCAL.md](LANCER-EN-LOCAL.md) : installer Docker Desktop, puis
`docker compose up --build` dans le dossier du projet, et ouvrir http://localhost:8080.

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
pnpm test        # moteur de calcul (34 tests) + API (15 tests d'intégration sur PostgreSQL)
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

### Moteur de calcul (`packages/engine`)

| Fichier | Règles |
| --- | --- |
| `plan.ts` | 5.1 agrégation, 5.2 scénarios calques, 5.3 prévision (Budget / Projection, budget global), 5.4 soldes, 5.5 factures en retard |
| `budgets.ts` | 5.7 répétition d'une valeur, assistant « partir de mon historique » |
| `indicators.ts` | 5.6 indicateurs personnalisés : parseur arithmétique, sans `eval` |
| `vat.ts` | 5.8 estimation de la TVA |
| `kpis.ts` | 5.9 ratios, autonomie, soldes quotidiens, 5.13 seuil |
| `categorize.ts` | 5.10 règles et suggestions par similarité |
| `split.ts` | Division d'une opération |

## Prochaines étapes

1. Lot 2 : agrégation bancaire (Bridge), page Opérations, imports CSV.
2. Passkeys et connexion Google / Microsoft (prévues au cahier des charges, non incluses ici).
3. Fournisseur d'emails réel et vérification des mots de passe compromis (Have I Been Pwned).

Le logo « optimum tréso » est une reconstitution provisoire : à remplacer par le fichier du graphiste.
