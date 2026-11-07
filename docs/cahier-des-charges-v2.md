# Cahier des charges — Tréso Optimum

Nov 6, 2026 · @jerome

## 0. Vision, principes et conventions

Tréso Optimum est un logiciel SaaS de pilotage de trésorerie pour TPE/PME, porté par la marque Optimum : il aide le dirigeant à savoir où en est sa trésorerie, où elle va, et quoi décider. Il conserve les règles métier éprouvées des outils du marché (réalisé, engagé, budgets, scénarios), mais repense l'expérience, les écrans et tous les textes.

**Promesse produit** : « La solution est là. » Le logiciel doit faire gagner du temps au dirigeant et rendre la décision évidente, comme l'orange de la charte qui ponctue les éléments décisifs.

**Principes UX (normatifs)**

1. **Une question par écran.** Chaque page répond d'abord à une question en une phrase et un chiffre (« Vous aurez 18 400 € fin mars ») avant le détail.
2. **Agir là où l'on regarde.** Pas de modale quand l'édition peut se faire en place : édition inline dans les tableaux, panneau latéral (drawer) pour le détail, modale réservée aux confirmations et assistants.
3. **Boîte de réception plutôt que listes à trous.** Les éléments à traiter (transactions à catégoriser, suggestions, factures en retard) sont regroupés dans un flux « À traiter » avec actions rapides et raccourcis clavier.
4. **L'automatique d'abord, la validation ensuite.** Règles, similarités et suggestions s'appliquent seules ; l'utilisateur valide d'un geste et peut toujours annuler (toast « Annuler » 8 s).
5. **Clavier et vitesse.** Palette de commandes (Ctrl/⌘ K), navigation au clavier dans les tableaux, raccourcis documentés (« ? »). Interface optimiste : la valeur saisie s'affiche immédiatement, la synchronisation se fait en arrière-plan.
6. **Ton Optimum.** Textes courts, tutoiement interdit, vouvoiement chaleureux, verbes d'action, aucun jargon inutile. Chaque message d'erreur dit ce qui s'est passé et quoi faire.
7. **Accessibilité RGAA / WCAG 2.2 AA**, mode sombre, responsive réel (consultation complète sur mobile, édition du plan à partir de 1024 px).

**Consignes pour l'IA de développement**

- Implémenter dans l'ordre du plan de livraison (section 9). Chaque écran de la section 7 est une user story avec ses critères d'acceptation.
- Les libellés entre « » sont les textes Tréso Optimum de référence ; ils sont centralisés dans des fichiers de traduction (`fr.json`), jamais codés en dur.
- Les règles de la section 5 sont normatives : tests unitaires obligatoires sur les exemples fournis.
- Utiliser exclusivement les composants et tokens du design system (section 1). Un détail non spécifié suit le design system et est signalé par `// HYPOTHÈSE`.
- Ne jamais utiliser `eval` : les formules passent par un parseur arithmétique.
- Aucun texte, logo, nom ou visuel d'un produit tiers. Nom du produit : **Tréso Optimum** (constante `APP_NAME`).

**Périmètre fonctionnel (modules)**

1. Comptes, authentification (dont lien magique et passkeys), multi-sociétés, invitations, onboarding guidé.
2. Connexions bancaires (agrégateur DSP2) et comptes manuels, import CSV.
3. Catégories hiérarchiques d'encaissements et de décaissements.
4. Transactions : flux « À traiter », catégorisation assistée, règles, division, rapprochement, masquage.
5. Engagements : factures de vente et d'achat (manuelles, récurrentes, import, OCR, intégrations).
6. Plan de trésorerie : réalisé, engagé, budgets, scénarios, projection, TVA, indicateurs personnalisés.
7. Vue journalière et alertes de trésorerie.
8. Analyses, KPI, rapport PDF.
9. Exports et imports (XLSX, CSV).
10. Paramètres, utilisateurs et droits, règles, formules, historique.
11. Abonnements (Stripe) et parrainage.
12. Option Pré-comptabilité : plan de comptes, TVA, associations, journaux, GED, OCR, écritures, FEC.
13. Lien conseiller Optimum : accès partagé avec un expert Optimum (gestion, audit, performance).

**Conventions**

- Devise EUR ; format français `1 234,56 €` (espace fine insécable). Dans le plan, montants arrondis à l'euro (arrondi inférieur, `Math.floor`) ; zéro affiché « — ».
- Montants stockés en décimal signé (encaissements positifs, décaissements négatifs) ; affichés en valeur absolue dans le plan, signe explicite ailleurs.
- Chiffres en police tabulaire (`font-variant-numeric: tabular-nums`) dans tous les tableaux.
- Dates : `5 nov. 2026`, `nov. 26`, `05/11/2026` selon le contexte ; date-fns locale `fr` ; mois de référence = 1er du mois (`yyyy-MM-dd`).
- « Mois courant » = mois contenant la date du jour, fuseau Europe/Paris.

## 1. Design system Tréso Optimum

L'interface applique la charte Optimum : vert pétrole pour la structure, orange réservé aux décisions, Poppins pour les titres, Raleway pour les textes. Tous les styles passent par des tokens CSS (`--opt-*`) exposés aussi au thème Ant Design v5 (`ConfigProvider` + `theme.token`).

### 1.1 Couleurs de marque

| Token | Hex | Rôle dans l'application | Contraste sur blanc |
| --- | --- | --- | --- |
| `--opt-petrol` | #114C5C | Couleur primaire : barre latérale, boutons principaux, liens, courbe de solde, en-têtes | 9,5:1 (AA texte) |
| `--opt-orange` | #E94F1C | Accent décisionnel : bouton d'action unique par écran (CTA), point « aujourd'hui », pastilles d'alerte, focus | 3,75:1 (éléments graphiques et texte ≥ 18 px gras uniquement) |
| `--opt-orange-text` | #C2410C | Orange pour texte courant et liens d'action (dérivé, conforme AA) | 5,2:1 |
| `--opt-sage` | #84ADB7 | Vert clair : rythme et respiration, séries secondaires, prévisions, fonds de survol | 2,4:1 (jamais en texte sur blanc) |
| `--opt-ink` | #303031 | Gris foncé : texte principal, titres | 13,2:1 |
| `--opt-mist` | #E5E4E4 | Gris clair : bordures, séparateurs, fonds de cartes secondaires | — |

**Règle de l'orange** : un seul élément orange plein par vue (le CTA principal ou l'alerte la plus importante). L'orange n'est jamais utilisé pour signifier « décaissement » ou « erreur ».

### 1.2 Couleurs fonctionnelles (dérivées, hors charte)

La charte ne définit pas de vert « positif » ni de rouge « négatif » ; ils sont ajoutés en tons désaturés, accordés au pétrole.

| Token | Hex | Usage |
| --- | --- | --- |
| `--opt-in` | #1E7A5A | Encaissements, montants positifs, succès (5,3:1) |
| `--opt-out` | #B42318 | Solde négatif, erreurs, factures en retard (6,6:1) |
| `--opt-out-flow` | #303031 | Décaissements : affichés en encre, pas en rouge (le rouge est réservé au danger) |
| `--opt-warning` | #B54708 | Solde sous le seuil minimum, avertissements |
| `--opt-surface` | #FFFFFF | Fond des cartes |
| `--opt-canvas` | #F6F6F5 | Fond de page (dérivé du gris clair) |
| `--opt-petrol-50` à `--opt-petrol-900` | échelle générée depuis #114C5C | Fonds teintés, états de survol, graphiques |

**Mode sombre** : fond `#0E1A1E`, cartes `#14262B`, texte `#F2F2F1` (15,8:1), primaire éclairci `#2B8A9F`, sage `#84ADB7` (7,3:1, autorisé en texte), orange conservé `#E94F1C` (4,7:1). Bascule automatique (`prefers-color-scheme`) et manuelle dans le profil.

### 1.3 Typographie

| Usage | Police | Graisse | Taille / interligne |
| --- | --- | --- | --- |
| Titre de page (H1) | Poppins | SemiBold 600 | 28 / 36 px |
| Titre de section (H2) | Poppins | SemiBold 600 | 20 / 28 px |
| Titre de carte, sur-titre | Poppins | Regular 400, capitales espacées +0,06 em | 12 / 16 px |
| Chiffre clé (KPI) | Poppins | SemiBold 600, chiffres tabulaires | 32 / 40 px |
| Texte courant | Raleway | Regular 400 | 14 / 22 px |
| Texte d'emphase, libellés de champ | Raleway | Bold 700 | 14 / 22 px |
| Montants dans les tableaux | Raleway | Regular, `tabular-nums lining-nums` | 13 / 20 px |

Polices servies en auto-hébergement (woff2, `font-display: swap`), sous-ensemble latin étendu. Raleway affiche des chiffres « elzévir » par défaut : forcer `font-feature-settings: "lnum" 1, "tnum" 1` partout où apparaît un montant.

### 1.4 Formes, espacements, élévation

- **Rayon** : 12 px pour les cartes, 8 px pour les champs et boutons, 999 px pour les pastilles et badges — écho aux bâtonnets arrondis du motif.
- **Grille** : base 4 px ; espacements 4 / 8 / 12 / 16 / 24 / 32 / 48 ; gouttière de page 24 px (16 px sur mobile).
- **Élévation** : cartes à plat avec bordure 1 px `--opt-mist` ; ombre douce uniquement pour les éléments flottants (drawer, menus, palette de commandes).
- **Mouvement** : transitions 150–200 ms, `ease-out` ; respect de `prefers-reduced-motion`.

### 1.5 Logo, favicon et motif

- **Logo** « optimum » avec le « i » en point d'exclamation orange ; déclinaison produit **optimum tréso** sur le modèle des déclinaisons gestion / formation / performance / audit (mot secondaire en vert clair #84ADB7, même typographie). Zone de respiration conforme à la charte. Version blanche sur fond pétrole dans la barre latérale.
- **Favicon / picto** : rond orange sur carré pétrole à coins arrondis ; utilisé pour l'onglet du navigateur, l'icône PWA, l'avatar des notifications et le bouton replié de la barre latérale.
- **Motif de bâtonnets** : réservé aux surfaces « respirantes » (écrans de connexion et d'inscription, états vides, en-tête des emails, page de fin d'onboarding, bandeau du rapport PDF). Jamais derrière des données. Fourni en SVG, opacité 100 % sur les écrans d'accueil, 12 % maximum en fond de carte.
- **Signature visuelle « point de décision »** : le point orange de la charte devient un repère d'interface : marqueur « aujourd'hui » sur les graphiques, pastille des éléments à traiter, indicateur de l'onglet actif.

### 1.6 Graphiques

- Solde : courbe pétrole 2,5 px, aire dégradée pétrole 16 % → 0 %.
- Réalisé = couleur pleine ; prévu = même teinte en sage ou en hachures légères. Encaissements `--opt-in`, décaissements `--opt-ink`.
- Scénarios alternatifs : palette ordonnée pétrole, sage, orange-texte, ink, et deux teintes dérivées (#5B8C5A, #8A6FB0) ; tirets pour les scénarios superposés.
- Seuil minimum : ligne pointillée `--opt-warning` avec étiquette.
- Ligne « aujourd'hui » : trait vertical fin `--opt-mist` surmonté du point orange.
- Bibliothèque : Recharts ou visx, infobulles au format français, aucune couleur codée en dur.

### 1.7 Composants clés

| Composant | Description |
| --- | --- |
| Carte KPI | Sur-titre en capitales, chiffre clé Poppins 32 px, variation colorée (▲ `--opt-in` / ▼ `--opt-out`), mini-courbe (sparkline) sur 6 mois |
| Bouton | Primaire pétrole ; CTA orange (un par vue) ; secondaire contour pétrole ; fantôme ; danger rouge |
| Pastille « À traiter » | Point orange 8 px + compteur ; disparaît à zéro |
| Cellule de plan éditable | Affiche la valeur ; un clic ou une touche numérique passe en saisie ; Entrée/Tab valide ; valeur alternative d'un scénario soulignée d'un trait de la couleur du scénario |
| Drawer de détail | Panneau latéral droit 480 px, ouvert sans quitter la page, URL partageable (`?detail=`) |
| Toast | En bas à gauche, avec action « Annuler » pour toute action réversible |
| État vide | Illustration du motif + phrase d'action + un bouton |
| Palette de commandes | Ctrl/⌘ K : recherche de transactions, factures, catégories, écrans et actions |
| Squelettes de chargement | À la place des spinners pour les tableaux et graphiques |

### 1.8 Accessibilité

- Contraste AA minimum pour tout texte ; jamais d'information portée par la seule couleur (icône ou signe en plus).
- Focus visible : anneau 2 px orange + décalage 2 px.
- Tableaux du plan navigables au clavier (flèches, Entrée, Échap), annoncés par lecteur d'écran (`role="grid"`).
- Cibles tactiles ≥ 44 px sur mobile.

## 2. Architecture technique

Tréso Optimum est une application web TypeScript de bout en bout : un front React servi en statique, une API REST multi-tenant typée, une base PostgreSQL avec isolation par société (Row Level Security) et des workers pour les tâches de fond.

| Couche | Choix | Pourquoi |
| --- | --- | --- |
| Front | React 19 + Vite + TypeScript strict, Ant Design v5 thémé avec les tokens Optimum, TanStack Query, TanStack Table + virtualisation pour le plan, Recharts, date-fns `fr`, react-hook-form + Zod | Écosystème stable, composants riches pour les tableaux et formulaires |
| API | NestJS (Node 22) ou Fastify + tRPC/OpenAPI ; schémas Zod partagés front/back ; contrat OpenAPI 3.1 généré | Types partagés, documentation automatique |
| Base | PostgreSQL 16 ; RLS sur `company_id` ; montants en `numeric(14,2)` ; migrations versionnées (Prisma ou Drizzle) | Isolation stricte des données entre sociétés |
| Calculs du plan | Module de calcul pur (package `@optimum/treso-engine`) exécuté côté serveur et testable isolément ; le front recalcule en local pour l'affichage optimiste | Règles de la section 5 testées une seule fois |
| Auth | Email + mot de passe (Argon2id), lien magique, passkeys (WebAuthn), Google/Microsoft OIDC ; JWT court + refresh token rotatif en cookie httpOnly ; 2FA TOTP optionnelle | Standards actuels, sans dépendance à un fournisseur |
| Tâches de fond | BullMQ (Redis) : synchro bancaire, OCR, intégrations, emails, rapports, alertes | Reprises automatiques, planification |
| Temps réel | Server-Sent Events : fin de synchro bancaire, OCR prêt, modification par un autre utilisateur | L'interface se met à jour sans recharger |
| Fichiers | Stockage S3 compatible hébergé en France (Scaleway, OVHcloud) ; URLs signées | Données financières hébergées en UE |
| Agrégation bancaire | Bridge API (agréé ACPR), lecture seule ; Powens en secours | Couverture des banques françaises |
| Paiement | Stripe Billing (Checkout, Customer Portal, webhooks) | — |
| Emails | Brevo ou Postmark ; gabarits MJML aux couleurs Optimum | — |
| Observabilité | Sentry (front + API), OpenTelemetry, logs structurés, tableau d'audit | — |
| Analytics / support | PostHog (auto-hébergeable) et chat support, chargés après consentement | Conformité RGPD |

**Exigences non fonctionnelles**

- Plan de trésorerie affiché en ≤ 1,5 s (p95) pour 24 mois × 150 catégories × 10 000 transactions ; saisie d'une cellule visible en < 100 ms (optimiste).
- Disponibilité 99,5 % ; sauvegardes quotidiennes chiffrées, rétention 30 jours, test de restauration mensuel.
- Hébergement en France ; chiffrement au repos et en transit ; secrets d'intégration chiffrés (KMS).
- RGPD : registre des traitements, export et suppression des données d'une société à la demande, DPA disponible.
- Journal d'audit : qui a modifié quel budget, quelle catégorie, quelle facture, et quand ; consultable par l'administrateur.
- PWA installable ; consultation hors ligne du dernier état (lecture seule).
- Messages d'erreur standard : session expirée → « Votre session a expiré. Reconnectez-vous pour continuer. » ; réseau → « Connexion perdue. Vos modifications seront envoyées dès son retour. » ; erreur serveur → « Un incident est survenu de notre côté. Réessayez dans un instant ; si le problème persiste, contactez le support. »

## 3. Rôles, offres et droits

Un utilisateur peut appartenir à plusieurs sociétés avec un rôle par société ; les fonctionnalités dépendent de l'offre de la société. Les droits sont vérifiés côté API (403) et reflétés dans l'interface (actions masquées, jamais grisées sans explication).

**Rôles**

| Code | Libellé UI | Droits |
| --- | --- | --- |
| `OWNER` | Propriétaire | Tout, dont abonnement, suppression de la société, transfert de propriété (un seul par société) |
| `ADMIN` | Administrateur | Tout sauf suppression et transfert : utilisateurs, intégrations, paramètres |
| `EDITOR` | Contributeur | Lecture et modification des données (transactions, factures, budgets, catégories) |
| `ADVISOR` | Conseiller Optimum | Lecture complète, commentaires, création de scénarios ; pas d'accès aux paramètres de facturation |
| `VIEWER` | Lecteur | Lecture seule, commentaires possibles, exports autorisés |

**Offres** (champ `company.plan`)

| Code | Nom affiché | Utilisateurs inclus | Banques | Contenu |
| --- | --- | --- | --- | --- |
| `DISCOVERY` | Découverte (gratuit) | 1 | 1 | Synchronisation bancaire, catégorisation automatique, tableau de bord du réalisé, vue journalière du réalisé |
| `ESSENTIAL` | Essentiel | 2 | 1 | + Prévisionnel, engagements, TVA estimée, 1 scénario alternatif, alertes |
| `PERFORMANCE` | Performance | 10 | illimitées (payantes au-delà de 1) | + Scénarios illimités, indicateurs personnalisés, exports et imports, analyses complètes, rapport PDF, intégrations |
| `GROUP` | Groupe | 10 | — | Plan consolidé de plusieurs sociétés (lecture agrégée + éliminations intra-groupe manuelles) |
| `FIRM` | Cabinet | — | — | Compte d'un cabinet (dont Optimum Gestion) gérant des sociétés clientes : vue portefeuille, alertes clients |
| `DEMO` | Démonstration | — | — | Données générées, toutes fonctionnalités visibles, bandeau « Données de démonstration » |

**Règles de tarification** (page Abonnement)

- Prix lus depuis Stripe (`price.metadata.feature` = essential / performance / extraBank / ocr / precompta ; `interval` = month / year). Aucune valeur codée en dur hors défauts de secours.
- Bascule Mensuel / Annuel ; badge « −x % » = `round((12 × mensuel − annuel) / (12 × mensuel) × 100)`.
- Prix mensuel affiché = prix de l'offre (÷ 12 si annuel) + (banques − 1) × prix banque supplémentaire (Performance).
- Plus d'une banque → seule l'offre Performance est proposée, avec explication.
- Options : Lecture automatique des factures (OCR), Pré-comptabilité (inclut l'OCR).
- Essai : 14 jours de Performance à l'inscription (`trialEndsAt`) ; compte à rebours discret dans la barre latérale (« Essai : 9 jours restants »), rappel J−3 et dernier jour.

**Fonctionnalités hors offre (approche moderne)**

- Pas de contenu flouté ni de cadenas partout : la fonctionnalité reste visible avec un **aperçu sur données d'exemple** et une carte « Disponible avec l'offre Essentiel » + bouton « Découvrir l'offre » (CTA orange).
- Un bandeau d'information unique et refermable (« Vous utilisez l'offre Découverte ») remplace les bandeaux permanents.
- Échec de paiement : bannière persistante « Votre dernier paiement n'a pas abouti » + « Mettre à jour ma carte » (portail Stripe) ; accès conservé 14 jours, puis retour à Découverte sans perte de données.

## 4. Modèle de données

Toutes les entités métier portent `id` (UUID v7), `companyId`, `createdAt`, `updatedAt`, `createdBy` ; la base est en snake\_case, l'API en camelCase. Les noms ci-dessous sont propres à Tréso Optimum.

| Entité | Champs principaux | Règles |
| --- | --- | --- |
| **User** | email (unique), passwordHash, firstName, lastName, phone, activeCompanyId, locale, theme (light/dark/system), notificationPrefs (JSON), twoFactorEnabled, referralCode | Mot de passe ≥ 10 caractères ou phrase de passe ; vérification contre les fuites (HIBP, k-anonymat) |
| **Membership** | userId, companyId, role | Lien N–N utilisateur/société ; un seul OWNER |
| **Company** | name, siren, nafCode, sector, plan, extraBanks, seats, options (ocr, precompta), trialEndsAt, stripeCustomerId, stripeSubscriptionId, minCashThreshold (€), vat { enabled, regime: monthly/quarterly }, invoicesEnabled, forecastMode (planned/projection), autoHide { refunds, internalTransfers }, currency (EUR), isDemo | SIREN contrôlé (Luhn) et pré-rempli via l'API Sirene |
| **GroupLink** | parentCompanyId, childCompanyId | Consolidation |
| **BankConnection** | provider (bridge/powens/manual), providerConnectionId, bankName, bankLogoUrl, status (ok / action\_required / error), statusDetail, lastSyncAt | Une connexion = une banque |
| **BankAccount** | connectionId, providerAccountId, name, displayName, type, balance, bookedBalance, instantBalance, balanceSource, isActive, isDefaultForCommitments, ignoreDeferredCard, currency, ibanMasked, lastSyncAt | Un seul compte par défaut des engagements par société |
| **Category** | name, flow (in/out), parentId, position, kind (revenue/purchases/overheads/payroll/none), vatRate (0/2.1/5.5/10/20), note, budgetAtParent (bool), isSystem, isVat, defaultAccountId, icon, color | Arbre illimité ; le `kind` d'un parent s'applique aux enfants sans `kind` |
| **Transaction** | accountId, bookedAt, originalBookedAt, rawLabel, label (nettoyé), counterparty (extrait), amount (signé), currency, categoryId, suggestion { categoryId, source: rule/similar/ai, confidence }, hidden, note, parentId, isSplit, externalId, importId, providerTransactionId | Unicité (accountId, providerTransactionId) |
| **Commitment** (facture engagée) | flow (in/out), counterparty, number, label, amountInclTax, vatRate, vatAmount, issuedAt, paymentTermDays, dueAt, originalDueAt, status (pending/paid/cancelled), categoryId, suggestion, hidden, note, accountId (nullable = hérité), seriesId, recurrence { every, unit, count }, source (manual/csv/ocr/integration), sourceRef, replacedById, documentId, importId | Statut affiché calculé : Payée / En retard (dueAt < aujourd'hui et non payée) / À venir |
| **Reconciliation** | transactionId, commitmentId, amount, status (suggested/confirmed) | Remplace les booléens de prérapprochement ; N–N avec montant |
| **Document** | file, fileName, mimeType, status (processing/to\_review/validated/duplicate), extracted (JSON), duplicateOfId, uploadedAt | OCR et pièces jointes |
| **Scenario** | name, color, isBase, description, archivedAt | Un scénario de base par société |
| **Budget** | scenarioId, categoryId, month (1er du mois), amount (≥ 0, nullable), note | Unicité (scenarioId, categoryId, month) ; null = hérite du scénario de base |
| **Rule** | conditions (JSON : contient / commence par / montant entre / compte), categoryId, vatRate, autoApply (bool), priority, matchCount | Règles éditables avec aperçu des transactions concernées |
| **Indicator** | name (unique par société), expression (AST JSON), unit (≤ 3 car.), format (number/percent/currency) | Formules personnalisées |
| **Import** | fileName, type (transactions/commitments/budgets), rowsCount, status, mapping | Supprimer un import supprime ce qu'il a créé |
| **ImportMapping** | type, mapping (JSON colonne → champ) | Dernière correspondance mémorisée |
| **Integration** | provider, credentials (chiffrés), status, lastSyncAt, settings | — |
| **Alert** | type (low\_cash, overdue, sync\_error, budget\_overrun), threshold, channel (app/email/push), isActive | Alertes configurables |
| **Comment** | targetType (cell/transaction/commitment), targetRef, body, authorId, resolvedAt | Fils de discussion avec le conseiller |
| **AuditLog** | actorId, action, entity, entityId, before, after, at | Lecture seule |
| **AdvisorRequest** | contact, preferredChannel, topic (gestion/audit/performance/formation), message, status | Demande d'accompagnement Optimum |
| **Referral** | referrerId, referredCompanyId, status, reward | Parrainage |
| **Pré-comptabilité** | AccountingConnection, LedgerAccount, VatAccount, CategoryMapping, BankMapping, Journal, DmsConfig, Entry, EntryLine | Module optionnel, voir 7.15 |

**Arbre de catégories par défaut** (créé à l'inscription, adapté au secteur choisi)

- Encaissements : Ventes (revenue) ; Subventions et aides ; Apports et emprunts ; Remboursement de TVA.
- Décaissements : Achats et sous-traitance (purchases) ; Salaires et charges (payroll) > Salaires nets, URSSAF, Prélèvement à la source, Retraite et prévoyance, Mutuelle ; Frais généraux (overheads) > Loyer, Logiciels et abonnements, Assurances, Honoraires ; Impôts et taxes ; Frais bancaires ; TVA (isVat) ; Remboursement d'emprunts ; Rémunération du dirigeant.
- Lignes système non supprimables : « À catégoriser » (par sens), « Exclu des totaux ».

## 5. Règles de calcul

Le plan combine trois sources par catégorie et par mois : le **réalisé** (transactions), l'**engagé** (factures non payées) et le **budget** (par scénario). Ces règles vivent dans le module `@optimum/treso-engine` et sont couvertes par des tests unitaires sur les exemples donnés.

### 5.1 Agrégation (catégorie feuille × mois M)

- `actual` = Σ `amount` des transactions non exclues, `bookedAt` ∈ M, de la catégorie.
- `hiddenActual` = Σ des transactions exclues des totaux.
- `committed` = Σ `amountInclTax` des factures non payées et non rapprochées (rapprochements confirmés déduits), `dueAt` ∈ M ; `hiddenCommitted` idem pour les exclues. Seulement si `company.invoicesEnabled`.
- `budget[s]` = montant du Budget (s, catégorie, M) ou `null`.
- Montants convertis en EUR au taux du jour de l'opération si la devise diffère.

### 5.2 Scénarios « calques »

```
planned(c, s, base) = budget[s]    si budget[s] ≠ null
                    = budget[base] si budget[base] ≠ null
                    = 0
estAlternative(c, s) = s ≠ base ET budget[s] ≠ null ET budget[s] ≠ budget[base]
```

Un scénario alternatif hérite de toutes les valeurs du scénario de base sauf celles qu'il redéfinit. Effacer une cellule d'un scénario alternatif la remet à `null` (héritage). Action « Revenir à la valeur de base » dans le menu de la cellule.

### 5.3 Prévision par catégorie

Deux modes (`company.forecastMode`) : **Budget** (« Afficher uniquement mes budgets ») et **Projection** (« Afficher mes budgets, ajustés des dépassements constatés »). Projection est le mode par défaut.

| Cas | budget | forecast |
| --- | --- | --- |
| Feuille normale | planned | Budget : planned · Projection : max(\|actual + committed\|, planned) |
| Feuille sous un parent à budget global | 0 | \|actual + committed\| |
| Parent à budget global (`budgetAtParent`) | planned du parent | Budget : planned · Projection : max(Σ \|actual + committed\| enfants, planned) |
| Parent normal | Σ budgets enfants | Σ forecasts enfants |

Totaux Encaissements / Décaissements = Σ des catégories racines du sens. En mode Budget, le total vaut `max(actual total + committed total, budget total)`. Les comparaisons se font en valeur absolue par sens.

**Exemples de test** (catégorie Ventes, mois courant, mode Projection) : réel 3 324, engagé 0, budget 8 500 → 8 500. Mois futur : budget 8 500, engagé 9 000 → 9 000. Mode Budget, même cas → 8 500.

### 5.4 Soldes

Pour chaque scénario, à partir de `openingBalance` (solde réel des comptes actifs au 1er du premier mois affiché, calculé par l'API) :

```
hiddenNet(M)   = exclus encaissements(M) − exclus décaissements(M)
actualNet(M)   = Σ réel encaissements(M) − Σ réel décaissements(M)
forecastNet(M) = forecast encaissements(M) − forecast décaissements(M)
opening(M)     = closing(M−1)          (premier mois : openingBalance)
closing(M)     = opening(M) + hiddenNet(M) + (M passé ? actualNet(M) : forecastNet(M))
variation(M)   = closing(M) − opening(M)
```

Le mois courant utilise la prévision (qui, en mode Projection, intègre déjà le réalisé) et s'affiche « réalisé / prévu ».

### 5.5 Factures en retard

Dans la vue journalière, le tableau de bord et les alertes, une facture non payée dont `dueAt` < aujourd'hui est comptée **aujourd'hui**. Dans le plan mensuel, elle est reportée au **mois courant** avec un marqueur « en retard » (choix Tréso Optimum : la trésorerie future ne doit pas ignorer un encaissement attendu). Le paramètre `overdueInPlan` (current\_month / due\_month) permet de revenir au mois d'échéance.

### 5.6 Indicateurs personnalisés

- `expression` = arbre syntaxique JSON (nœuds `number`, `category`, `line` (Encaissements, Décaissements, Solde fin), `op` + - × ÷, `group`).
- Valeur par mois et scénario : chaque catégorie vaut son `forecast[s]` si M ≥ mois courant, sinon son `actual` ; référence inconnue = 0 ; division par zéro → « — ».
- Évaluation par parcours de l'arbre (aucun `eval`). Affichage avec l'unité : « 26,96 % ».
- Exemple : Taux d'achats consommés = Achats ÷ 1,2 ÷ (Ventes ÷ 1,1) × 100, unité %.
- Bibliothèque de modèles prêts : marge brute, poids de la masse salariale, frais généraux / CA, BFR en jours.

### 5.7 Répéter une valeur budgétaire

Depuis une cellule : « Répéter tous les \[1–12\] mois pendant \[1–36\] mois » → crée ou écrase les budgets aux mois M, M+i, M+2i… jusqu'à M + durée − 1. Raccourcis : « Jusqu'à la fin de l'année », « Sur 12 mois ». Glisser la poignée de la cellule vers la droite (comme dans un tableur) recopie la valeur.

### 5.8 Estimation de la TVA

Active si `company.vat.enabled` ; régime mensuel ou trimestriel.

- TVA collectée du mois = Σ (forecast TTC × taux ÷ (100 + taux)) des encaissements par catégorie à taux non nul ; TVA déductible = idem sur décaissements.
- TVA due = collectée − déductible ; payée le mois suivant (mensuel) ou le mois suivant la fin du trimestre (trimestriel) ; négative → crédit reporté, puis remboursement proposé en « Remboursement de TVA ».
- Résultat écrit en budgets de la catégorie TVA, marqués « calculé » (recalcul automatique à chaque modification, désactivable).
- À valider avec un expert-comptable Optimum : dates d'exigibilité, acomptes du régime simplifié.

### 5.9 KPI (page Analyses, période \[début, fin\])

| KPI | Formule | Affichage |
| --- | --- | --- |
| Frais généraux / CA | Σ réel overheads ÷ Σ réel revenue × 100 (0 si un terme est nul) | « 12,5 % » |
| Achats / CA | Σ purchases ÷ Σ revenue × 100 | % |
| Masse salariale / CA | Σ payroll ÷ Σ revenue × 100 | % |
| Charges fixes / variables | a = Σ purchases ÷ Σ décaissements × 100 | « Variables a % · Fixes (100 − a) % » |
| Jours sous zéro | nombre de jours où le solde quotidien < 0 | « n jours » |
| Jours sous le seuil | nombre de jours où le solde < `minCashThreshold` | « n jours » |
| Solde moyen | Σ soldes quotidiens ÷ nombre de jours | « 382 € » |
| Autonomie de trésorerie | solde actuel ÷ moyenne des décaissements mensuels des 3 derniers mois | « 2,4 mois » |
| Délai moyen d'encaissement clients | moyenne (date de paiement − dueAt) des factures de vente payées de la période + (aujourd'hui − dueAt) des factures échues non payées | « 6 jours de retard » / « 3 jours d'avance » |
| Délai moyen de paiement fournisseurs | idem sur factures d'achat | idem |

### 5.10 Catégorisation assistée

1. **Règle** (priorité décroissante) : la première règle dont les conditions correspondent fixe la catégorie ; si `autoApply`, la transaction est catégorisée directement, sinon elle reçoit une suggestion.
2. **Similarité** : même `counterparty` ou même libellé nettoyé qu'une transaction déjà catégorisée → suggestion (confiance haute si ≥ 3 occurrences identiques).
3. **Suggestion IA** (optionnelle, Performance) : modèle de classification sur le libellé et le montant, confiance affichée ; jamais appliquée sans validation.
4. Catégoriser une transaction propose immédiatement : « 4 transactions similaires — Appliquer » et « Créer une règle ».
5. Exclusion automatique (paramètre) : remboursements (paire débit/crédit de même montant absolu, libellé proche, ≤ 30 jours) et virements internes (montants opposés entre deux comptes de la société, ±3 jours).

### 5.11 Rapprochement facture ↔ transaction

- Suggestion quand une transaction non rapprochée de même sens a un montant égal au TTC d'une facture non payée (± 0,01 €), ou un libellé contenant son numéro ou son tiers ; score affiché.
- Une transaction peut régler plusieurs factures et une facture peut être réglée par plusieurs transactions ; Σ des montants rapprochés ≤ montant de la transaction (« Le total des factures dépasse le montant de ce paiement »).
- Paiement partiel : la facture reste ouverte pour le « Reste à payer », sans duplication.
- Confirmer un rapprochement total passe la facture en Payée.

### 5.12 Compte d'une facture

Cascade : compte de la facture → compte des factures du même tiers → compte par défaut de la catégorie → du parent → compte par défaut des engagements. Affiché sous la facture : « Compte pro · Banque X » ou « Par défaut ». Les filtres par compte du plan et de la vue journalière utilisent ce compte.

### 5.13 Alertes de trésorerie

- **Seuil bas** : si le solde projeté (vue journalière) passe sous `minCashThreshold` dans les 60 prochains jours → alerte « Votre trésorerie passera sous 5 000 € le 14 déc. ».
- **Retards** : facture de vente en retard de plus de 7 jours.
- **Dépassement de budget** : catégorie dont le réel du mois dépasse le budget de plus de 10 %.
- **Synchronisation** : connexion bancaire en action requise depuis plus de 24 h.
- Envoi selon les préférences (in-app, email, push PWA), regroupé en un message par jour maximum.

## 6. Navigation et layout

L'application s'organise autour de trois zones : une barre latérale pétrole avec libellés lisibles (repliable en icônes), une barre supérieure fine avec recherche et société active, et un contenu sur fond `--opt-canvas`. Il n'y a plus de sous-menus flottants au survol : tout est visible en un coup d'œil.

**Barre latérale** (240 px dépliée, 72 px repliée ; état mémorisé par utilisateur)

| Groupe | Entrée (route) | Pastille |
| --- | --- | --- |
| — | Accueil (`/`) | — |
| — | À traiter (`/a-traiter`) | point orange + nombre d'éléments en attente |
| Trésorerie | Plan de trésorerie (`/plan`) | — |
| Trésorerie | Au jour le jour (`/journalier`) | — |
| Trésorerie | Opérations bancaires (`/operations`) | — |
| Engagements | Factures clients (`/factures/clients`) | nombre en retard |
| Engagements | Factures fournisseurs (`/factures/fournisseurs`) | nombre en retard |
| Analyse | Analyses (`/analyses`) | — |
| Analyse | Indicateurs (`/indicateurs`) | — |
| Comptabilité (option) | Pré-comptabilité (`/precompta`) | — ; si option inactive : entrée « Découvrir » |
| Bas de barre | Paramètres (`/parametres`) · Aide et nouveautés · Mon conseiller Optimum | — |

En haut de la barre : logo optimum tréso (blanc), puis sélecteur de société (nom + offre, recherche si plus de 5 sociétés, « Ajouter une société »). En bas : avatar, nom, menu profil (Mon profil, Thème, Raccourcis clavier, Se déconnecter), compte à rebours d'essai le cas échéant.

**Barre supérieure** (56 px)

- Fil d'Ariane + titre de page.
- Recherche globale / palette de commandes (« Rechercher ou lancer une action… » · Ctrl/⌘ K).
- Sélecteur de comptes partagé (voir ci-dessous) sur les pages qui l'utilisent.
- Indicateur de synchronisation (« Synchronisé il y a 12 min » ; clic = synchroniser maintenant).
- Cloche des notifications (alertes 5.13, commentaires, fin d'import) avec panneau latéral.
- Bouton contextuel principal de la page (CTA orange).

**Sélecteur de comptes** : menu « Tous les comptes · 3 » avec solde total ; cases par compte (multi-sélection), logo de la banque, solde, groupement par banque ; sélection mémorisée dans l'URL (`?comptes=`) pour qu'un lien partagé montre la même vue.

**Bannières** : une seule à la fois, par ordre de priorité (paiement en échec > banque à reconnecter > intégration en erreur > fin d'essai > information produit) ; les suivantes restent accessibles dans la cloche. Toutes refermables sauf le paiement en échec.

**Mobile** (< 768 px) : barre d'onglets en bas (Accueil, À traiter, Plan, Opérations, Plus) ; le plan s'affiche en lecture par carte-mois avec balayage horizontal ; le flux « À traiter » est l'écran mobile prioritaire (catégorisation par balayage).

**Pages hors application** (layout à deux colonnes : motif Optimum à gauche, formulaire à droite) : `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser/:token`, `/invitation/:token`, `/verification-email`, `/bienvenue/*` (onboarding), `/societes`.

## 7. Spécifications écran par écran

Chaque écran est une user story : objectif, contenu, interactions, textes et critères d'acceptation. Les tableaux utilisent TanStack Table virtualisé (pas de pagination sous 5 000 lignes), colonnes redimensionnables et masquables, préférences mémorisées par utilisateur.

### 7.1 Connexion, inscription et onboarding

**Connexion** (`/connexion`) — objectif : entrer en moins de 10 secondes.

- Colonne gauche : motif Optimum plein cadre, logo blanc, phrase « La solution est là. ».
- Formulaire : « Adresse email », bouton « Continuer ». L'écran suivant propose selon le compte : « Mot de passe », « Recevoir un lien de connexion par email », « Utiliser ma clé d'accès » (passkey), ou les boutons Google / Microsoft.
- « Rester connecté 30 jours » (case), « Mot de passe oublié ? ».
- Erreurs : « Email ou mot de passe incorrect. » ; « Confirmez d'abord votre adresse : nous vous avons envoyé un email. » + « Renvoyer l'email » ; « Ce compte est suspendu. Contactez le support. » ; « Trop de tentatives. Réessayez dans 1 minute. ».

**Inscription** (`/inscription`) — en une seule étape courte : Prénom, Adresse email professionnelle, Mot de passe (jauge de robustesse en direct, pas de règle arbitraire), case « J'accepte les conditions d'utilisation » ; bouton « Créer mon compte ». Inscription Google / Microsoft disponible. Code promo derrière un lien « J'ai un code ». Paramètres UTM et parrainage conservés 30 jours.

**Vérification de l'email** : écran « Vérifiez votre boîte mail » avec l'adresse, « Ouvrir Gmail / Outlook » (liens directs), « Renvoyer » (après 30 s), « Modifier l'adresse ». Le lien de l'email connecte directement et ouvre l'onboarding.

**Onboarding** (`/bienvenue/*`, barre de progression en 4 points orange) :

1. **Votre entreprise** : recherche par nom ou SIREN (API Sirene) qui pré-remplit raison sociale, SIREN, code NAF et secteur ; saisie manuelle possible. « Votre rôle » (Dirigeant, Comptable / DAF, Conseiller). Option « Explorer avec des données de démonstration ».
2. **Vos banques** : rassurance (« Connexion sécurisée agréée par l'ACPR », « Lecture seule : aucun virement possible », « Déconnexion en un clic ») ; recherche de banque avec logos ; redirection agrégateur ; au retour, écran d'attente animé avec le point orange (« Nous récupérons vos 12 derniers mois d'opérations… ») ; « Passer cette étape ».
3. **Vos comptes** : liste des comptes trouvés avec interrupteur et solde ; choix du compte par défaut des engagements.
4. **Votre seuil** : « En dessous de quel solde voulez-vous être alerté ? » (champ €, suggestion = 1 mois de décaissements moyens) puis écran final « Votre trésorerie est prête » avec 3 actions recommandées.

Critères : un nouvel utilisateur atteint l'accueil avec ses données en < 3 minutes ; chaque étape est reprise là où elle a été quittée.

**Mes sociétés** (`/societes`) : cartes par société (nom, offre, solde actuel, nombre d'éléments à traiter) ; clic = changement de société sans rechargement complet ; « Ajouter une société » ; « Créer une vue groupe » (offre Groupe).

**Invitation** (`/invitation/:token`) : « Jean Dupont vous invite à rejoindre SARL Exemple sur Tréso Optimum en tant que Contributeur. » ; création du compte en un champ (mot de passe) ou via Google / Microsoft.

### 7.2 Accueil (`/`)

Objectif : répondre en 5 secondes à « Où en est ma trésorerie et que dois-je faire ? ».

1. **Phrase-réponse** en tête (Poppins 20 px) : « Bonjour Jérôme. Votre trésorerie est de **42 180 €** et devrait atteindre **38 900 €** fin décembre. » Variante d'alerte : « … mais passera sous votre seuil de 10 000 € le 14 janvier. » avec lien « Voir pourquoi ».
2. **4 cartes KPI** : Solde actuel · Encaissements du mois (réalisé / prévu) · Décaissements du mois (réalisé / prévu) · Autonomie de trésorerie (en mois). Chaque carte : chiffre clé, variation vs mois précédent, sparkline 6 mois.
3. **Carte « Trajectoire »** : graphique 3 mois passés + 6 mois futurs (barres encaissements/décaissements réel vs prévu, courbe de solde, seuil, point « aujourd'hui ») ; sélecteur de scénario ; lien « Ouvrir le plan ».
4. **Carte « À traiter »** : 3 premières actions (« 14 opérations à catégoriser », « 3 rapprochements suggérés », « 2 factures clients en retard · 4 850 € ») avec bouton par ligne et « Tout traiter » (CTA orange).
5. **Carte « Prévu vs réalisé du mois »** : deux barres de progression (encaissements, décaissements) avec montants et écart.
6. **Carte « Prochaines échéances »** : 5 prochaines factures (date, tiers, montant, sens) sur 30 jours.
7. **Carte « Conseils »** : 1 à 3 conseils générés (règles ci-dessous) + encart « Un expert Optimum à vos côtés » : « Construisez votre prévisionnel avec un conseiller Optimum et prenez vos décisions en confiance. » + « Être rappelé ».

Règles des conseils (ordre de priorité) : factures clients en retard → « 4 850 € de factures clients sont en retard. Relancez vos clients : » + lien vers la liste ; solde projeté sous le seuil → « Votre trésorerie passera sous votre seuil le 14 janv. Anticipez avec un scénario. » ; opérations à catégoriser → « Catégorisez vos 14 opérations pour fiabiliser vos prévisions. » ; aucun budget futur → « Aucun prévisionnel au-delà de décembre. Prolongez vos budgets en 1 clic. » ; nouveau compte → « Commencez par catégoriser vos opérations : nous ferons le reste. ».

Personnalisation : cartes réordonnables et masquables (bouton « Personnaliser »), disposition mémorisée par utilisateur.

**Être rappelé par un conseiller** (drawer) : Prénom, Nom, Email, Téléphone (pré-remplis), Sujet (Construire mon prévisionnel / Difficulté de trésorerie / Financement / Autre), Créneau préféré, Message (« Dites-nous en quelques mots ce dont vous avez besoin ») → « Envoyer ma demande » → « Merci ! Un conseiller Optimum vous contacte sous 24 h ouvrées. ».

### 7.3 À traiter (`/a-traiter`)

Objectif : vider la file en quelques minutes par semaine. Écran nouveau qui regroupe tout ce qui demande une décision.

- **Filtres en puces** : Tout · À catégoriser (n) · Suggestions à valider (n) · Rapprochements (n) · Factures en retard (n) · Documents OCR à vérifier (n) · Doublons (n).
- **Carte par élément** : libellé, date, compte, montant ; proposition (catégorie suggérée avec source « règle », « similaire » ou « IA » et niveau de confiance) ; actions « Valider » (Entrée), « Changer » (C), « Ignorer » (I), « Exclure des totaux » (X). Navigation ↑/↓ ; les cartes validées disparaissent avec une animation courte et un toast « Annuler ».
- **Regroupement intelligent** : les opérations du même tiers sont groupées (« URSSAF · 6 opérations ») et validées d'un coup.
- Après une catégorisation manuelle : proposition « Toujours classer URSSAF en Charges sociales ? » → crée une règle.
- **État vide** : motif Optimum + « Tout est à jour. Votre trésorerie est fiable. » + lien vers le plan.
- Mobile : balayage à droite = valider, à gauche = changer.

Critères : 50 opérations traitables au clavier sans souris ; chaque action annulable pendant 8 s.

### 7.4 Plan de trésorerie (`/plan`)

Objectif : voir et construire la trésorerie mois par mois, scénario par scénario. Graphique en haut (repliable), grille en dessous, totaux figés.

**Barre d'outils** : onglets de scénarios (pastille de couleur ; « + Scénario » ; menu : renommer, dupliquer, couleur, archiver, comparer) · période (préréglages « 12 mois glissants », « Année civile », « Exercice », « Personnalisée » ; défaut M−2 → M+9) · sélecteur de comptes · affichage (Graphique + grille / Grille seule) · mode (Budget / Projection) · « Exporter » · bouton « Modifier les budgets » (bascule d'édition, CTA orange quand actif : « Terminer »).

**Graphique** : « Solde aujourd'hui » à gauche en chiffre clé ; barres groupées par mois (réel plein, prévu en sage) ; courbe de solde par scénario affiché ; zone passée sur fond neutre, futur légèrement teinté ; point orange « aujourd'hui » ; seuil minimum en pointillé avec étiquette ; superposition d'autres scénarios en tirets (cases dans le menu « Comparer »). Survol d'un mois = surlignage de la colonne correspondante dans la grille.

**Grille** (colonne libellés figée à gauche, colonne Total figée à droite, en-têtes « nov. 26 », mois courant marqué d'une bordure pétrole et d'un point orange) — lignes dans l'ordre :

1. Solde en début de mois.
2. Encaissements (total sur fond teinté vert très pâle, repliable), catégories et sous-catégories indentées, « À catégoriser ».
3. Décaissements (fond gris très pâle), même structure.
4. Exclu des totaux.
5. Variation du mois (signée : « +6 517 »).
6. Solde en fin de mois (rouge si < 0, orange foncé si < seuil, avec icône).
7. Indicateurs personnalisés (une ligne par indicateur, groupe repliable).

**Cellules** : passé = réel ; mois courant = « réel / prévu » avec mini-barre de progression ; futur = prévision ; zéro = « — » ; valeur redéfinie dans un scénario alternatif = soulignée de la couleur du scénario + infobulle « Valeur de base : 8 500 € » ; facture en retard reportée = petite icône horloge ; cellule commentée = coin orange.

**Édition des budgets** (mode « Modifier les budgets » ou touche E) :

- Cellules futures (et passées si « Inclure les mois passés » est activé) éditables comme un tableur : taper un nombre remplace la valeur, Entrée/Tab/flèches valident et déplacent, Échap annule ; copier-coller d'une plage depuis Excel ; poignée de recopie vers la droite ; saisie de formule simple (« =8500\*1,05 »).
- Menu de cellule (clic droit) : Répéter… (5.7), Augmenter de x % jusqu'à la fin de la période, Revenir à la valeur de base, Ajouter un commentaire, Voir le détail.
- Ligne TVA : bouton « Calculer la TVA » (5.8).
- Enregistrement automatique par cellule (indicateur « Enregistré » discret), recalcul immédiat des totaux, soldes et graphique ; « Annuler » (Ctrl/⌘ Z) sur les 20 dernières saisies.

**Détail d'une cellule** (clic hors édition → drawer « Ventes · nov. 26 ») : en tête « 3 324 € réalisés sur 8 500 € prévus (39 %) » + barre ; blocs Réalisé, Engagé, Budget (éditable), Projection ; note ; onglets « Opérations » et « Factures » de la catégorie et du mois avec catégorisation en place ; commentaires.

**Colonne Total** : par défaut la période affichée, « Réel / Prévu » ; réglable (« Personnaliser le cumul » : mois de début et de fin, 24 mois maximum : « La période ne peut pas dépasser 24 mois. »).

**Construire mon prévisionnel** (assistant proposé quand aucun budget futur n'existe, et via le bouton « Assistant ») :

1. « Partir de mon historique » : propose pour chaque catégorie la moyenne des 3, 6 ou 12 derniers mois (choix), avec option « Exclure les mois exceptionnels » ; aperçu avant application.
2. « Ajouter une croissance » : +x % sur les encaissements, +y % sur les charges.
3. « Ajouter des événements » : recrutement, investissement, emprunt, levée de fonds (formulaires guidés qui créent les budgets correspondants).
4. Validation : « Appliquer à mon scénario de base » ou « Créer un nouveau scénario ».

Autres sources : « Importer depuis Excel » (modèle XLSX téléchargeable pré-rempli des catégories et des mois ; consignes « Gardez les en-têtes et les identifiants tels quels » ; rapport d'import détaillant les cellules ignorées), import des factures (7.8).

**Créer un scénario** (drawer) : Nom (« Ex. : Recrutement commercial en mars »), Description, Couleur (6 pastilles), Point de départ (Scénario de base / Copie d'un autre scénario) ; texte d'aide : « Votre scénario reprend toutes les valeurs du scénario de base. Modifiez uniquement ce qui change : le reste suit automatiquement. » ; « Créer le scénario ». Offre Essentiel : 1 scénario alternatif.

**Comparer des scénarios** : vue dédiée affichant pour chaque mois le solde fin de chaque scénario et l'écart au scénario de base, avec graphique superposé.

Critères : saisie de 12 mois × 20 catégories au clavier sans souris ; collage d'une plage Excel 12 × 20 ; plan de 24 mois affiché en ≤ 1,5 s.

### 7.5 Exports (drawer « Exporter »)

Accessible depuis le plan, les analyses et la palette de commandes ; génère un classeur XLSX mis en forme aux couleurs Optimum (logo, en-têtes pétrole, formats € et dates français, volets figés).

- Période (requise : « Choisissez une période »).
- Contenu (au moins un : « Choisissez au moins un élément à exporter ») : Plan de trésorerie · Prévu vs réalisé · Budgets saisis · Opérations bancaires · Factures (clients / fournisseurs ; toutes / à venir / en retard) · Trésorerie au jour le jour · Indicateurs.
- Scénarios (au moins un ; défaut = scénario affiché).
- Format : XLSX (un onglet par contenu) ou CSV (un fichier par contenu, archive ZIP).
- Bouton « Exporter » ; génération en arrière-plan au-delà de 5 s avec notification « Votre export est prêt » et lien de téléchargement valable 7 jours.
- Exports programmés (Performance) : « Recevoir cet export chaque lundi / chaque 1er du mois » par email.

### 7.6 Opérations bancaires (`/operations`)

Objectif : retrouver, comprendre et corriger n'importe quelle opération.

- **En-tête** : recherche plein texte (libellé, tiers, montant exact ou approché : « \~120 »), sélecteur de comptes, période, filtres en puces cumulables (Catégorie, Sens, Montant, État : à catégoriser / suggérée / rapprochée / exclue / divisée, Commentée). Filtres enregistrables en vues (« Mes vues »).
- **Colonnes** : sélection · Date (« 5 nov. 2026 », icône si date modifiée) · Libellé (nettoyé en gras, tiers détecté avec logo si connu, libellé bancaire brut en gris) · Catégorie (sélecteur en place) · Compte · Montant (encaissement vert avec « + », décaissement encre avec « − ») · État (icônes : rapprochée, exclue, divisée, commentée).
- **Sélecteur de catégorie** : recherche floue, catégories du sens du montant d'abord puis l'autre sens en section « Autre sens (remboursement, avoir…) », catégories récentes en tête, « Créer « Assurance flotte » » en pied si aucun résultat. Sans catégorie : pastille « À catégoriser » orange pâle. Suggestion : catégorie en italique + bouton ✓ de validation.
- **Après catégorisation** : toast « Catégorisée en Loyer · 3 opérations similaires — Appliquer · Créer une règle · Annuler ».
- **Drawer de détail** (clic sur une ligne) : montant, date, compte, libellé brut, tiers ; catégorie ; note ; « Changer la date d'imputation » (et « Revenir à la date bancaire ») ; « Diviser » ; « Rapprocher d'une facture » ; « Exclure des totaux » ; pièces jointes (glisser un justificatif) ; commentaires ; historique des modifications.
- **Diviser** : lignes Catégorie + Montant ; « Répartir à parts égales » en n parts (dernière part = reste : 258,20 en 2 → 130,00 + 128,20) ; ou en pourcentages ; « Reste à répartir : 0,00 € » requis pour valider ; « Annuler la division » ensuite.
- **Sélection multiple** (barre flottante en bas) : Catégoriser · Valider les suggestions · Exclure / Réintégrer · Exporter · Supprimer (opérations manuelles ou importées uniquement : « Supprimer 12 opérations ? Cette action est définitive. »). Montants de sens mélangés : le sélecteur propose les deux sens avec avertissement « Votre sélection contient des encaissements et des décaissements. ».
- **Ajouter** : « Nouvelle opération » (Date, Libellé, Montant, Compte manuel, Catégorie) ; « Importer un fichier » (7.8).
- **Sans banque** : état vide « Connectez votre banque pour voir vos opérations arriver automatiquement. » + « Connecter une banque ».

### 7.7 Au jour le jour (`/journalier`)

Objectif : voir les creux de trésorerie à venir, jour par jour.

- **Barre** : sélecteur de comptes, période (préréglages : ce mois, 30 / 60 / 90 jours, personnalisée), granularité (Jour / Semaine / Mois), « Comparer des comptes » (une courbe par compte), « Inclure les budgets » (interrupteur, défaut désactivé ; aide : « Désactivé : seules les factures engagées sont projetées. Activé : les budgets non couverts par des factures sont répartis sur le mois. »).
- **4 KPI** : Solde de début · Solde de fin · Variation (€ et %) · Point bas (montant et date, en orange foncé si < seuil).
- **Graphique** : barres entrées / sorties (sorties vers le bas), réel plein et prévu clair, courbe de solde, point orange « aujourd'hui », futur teinté, seuil en pointillé, zone de zoom (brush). Infobulle : solde de début, entrées réalisées / prévues, sorties réalisées / prévues, solde de fin, factures du jour.
- **Sous le graphique** : onglets « Factures à venir » (Échéance, Tiers, Libellé, Statut, Catégorie, Compte, Montant, action « Décaler » pour simuler un report de paiement) et « Opérations » (colonnes de 7.6). Survol d'une barre = filtre la liste sur ce jour.
- **Simulation rapide** : décaler une facture (glisser son point sur le graphique ou action « Décaler ») met à jour la courbe en direct ; « Enregistrer la nouvelle échéance » ou « Annuler la simulation ».

### 7.8 Factures clients et fournisseurs (`/factures/clients`, `/factures/fournisseurs`)

Même écran paramétré par sens. Titre « Factures clients » / « Factures fournisseurs ».

**En-tête** : 3 KPI cliquables (À venir · En retard · Payées ce mois, montants et nombres) ; bouton « Ajouter » (menu : Nouvelle facture · Déposer des factures (OCR) · Importer un fichier · Connecter mon logiciel de facturation) ; « Exporter ».

**Vues en puces** : Toutes · À venir · En retard · Payées · Suggestions de rapprochement · Doublons possibles · À vérifier (OCR). États vides propres à chaque vue (« Aucune facture en retard. Bravo ! »).

**Alertes en tête de liste** :

- Sans compte par défaut des engagements : « Choisissez le compte qui recevra vos factures par défaut. » + « Choisir le compte ».
- Doublons possibles (échéance récurrente manuelle vs facture importée) : carte comparant les deux (« Saisie manuelle » / « Importée de Pennylane ») + « Remplacer par la facture importée » / « Garder les deux ».

**Colonnes** : sélection · Échéance (tri) · Tiers · Libellé / numéro (icône récurrence ; compte sous la ligne : « Compte pro · Banque X » ou « Par défaut ») · Statut (pastille : À venir pétrole, En retard rouge avec « +12 j », Payée vert, Partiellement payée) · Catégorie (sélecteur en place) · Montant TTC · Reste à payer.

**Drawer de facture** (création et modification) :

| Champ | Type | Règles |
| --- | --- | --- |
| Tiers | saisie avec autocomplétion des tiers connus | Pré-remplit catégorie, TVA, délai et compte habituels du tiers |
| Numéro | texte | Optionnel ; sert au rapprochement |
| Catégorie | sélecteur du sens | Requis ; pré-remplit TVA et compte |
| Montant TTC | nombre | Requis (« Indiquez le montant TTC ») |
| Taux de TVA | 0 / 2,1 / 5,5 / 10 / 20 % | Défaut = taux de la catégorie |
| Montant TVA | calculé = TTC × taux ÷ (100 + taux) | Modifiable |
| Date d'émission | date | Défaut aujourd'hui |
| Délai de paiement | À réception / 15 / 30 / 45 / 60 jours / fin de mois / personnalisé | Recalcule l'échéance |
| Échéance | date | Modifiée → recalcule le délai |
| Compte | sélecteur | Aide : « Compte sur lequel le paiement est attendu. Pré-rempli depuis la catégorie. » |
| Répéter | interrupteur | « Crée automatiquement les prochaines échéances. » |
| Fréquence | Chaque mois / 2 mois / trimestre / semestre / année / personnalisée | Si Répéter |
| Nombre d'échéances ou date de fin | nombre (1–120) ou date | Défaut 12 |
| Pièce jointe | dépôt de fichier | Aperçu à droite |
| Note | texte | Optionnel |

Modification d'une échéance récurrente : choix « Cette échéance seulement » / « Cette échéance et les suivantes » (les échéances passées, payées ou remplacées ne sont jamais modifiées). Suppression d'une série : même choix, avec confirmation « Supprimer les 8 prochaines échéances ? ».

**Actions par ligne** (menu et drawer) : Marquer comme payée (avec date et compte) · Rapprocher d'un paiement (liste des opérations candidates triées par score, montant restant affiché) · Annuler le rapprochement · Décaler l'échéance · Dupliquer · Changer le compte · Exclure des totaux · Supprimer (« Supprimer la facture FA-2026-112 ? ») · Relancer le client (factures clients en retard : génère un email de relance personnalisable avec la facture jointe). Factures issues d'une intégration : montant et suppression verrouillés, avec explication.

**Dépôt de factures (OCR)** : zone de dépôt plein écran au glisser (« Déposez vos factures PDF, PNG ou JPEG »), envoi par email à une adresse dédiée (`factures+societe@treso.optimum…`) ; vue « À vérifier » : aperçu du document à gauche, champs extraits à droite avec niveau de confiance par champ (champs incertains surlignés), détection des doublons ; « Valider » (Entrée) et passage au suivant.

**Import de fichier** (assistant en 3 étapes) :

1. **Fichier** : CSV ou XLSX (séparateur et encodage détectés), sens et compte ; « Télécharger un fichier modèle ».
2. **Correspondance** : colonnes du fichier ↔ champs Tréso Optimum, avec aperçu des 5 premières lignes et correspondance proposée automatiquement (mémorisée pour le prochain import) ; champs requis manquants signalés (« Associez une colonne à : Libellé, Montant »).
3. **Vérification** : lignes valides / en erreur (motif par ligne : « Date illisible ligne 14 »), catégories reconnues par nom (inconnues → « À catégoriser » ou création proposée) ; « Importer 248 lignes » → « 248 factures importées. » avec lien « Annuler cet import ».

Erreurs de lecture CSV affichées en français : « Guillemet non fermé ligne 12 », « Guillemet mal placé ligne 12 ».

### 7.9 Catégories (`/parametres/categories`)

Deux colonnes « Encaissements » et « Décaissements », chacune avec un arbre et « Ajouter une catégorie ».

- **Ligne** : poignée de glisser-déposer, chevron, icône et couleur (choisies dans une bibliothèque), nom, puce du type (Chiffre d'affaires, Achats, Frais généraux, Masse salariale), puce TVA (« 20 % »), nombre d'opérations sur 12 mois.
- **Glisser-déposer** pour réordonner ou changer de parent dans le même sens ; si des budgets existent, aperçu des conséquences avant validation (« Les budgets de Loyer (12 mois) seront regroupés dans Frais généraux. ») et choix « Conserver en additionnant » / « Supprimer les budgets ».
- **Drawer d'édition** : Nom (requis), Icône et couleur, Note, Taux de TVA par défaut, Type (radio, avec aide « Le type alimente les indicateurs d'analyse ; il s'applique aussi aux sous-catégories. »), Compte par défaut des factures (aide « Si vide : catégorie parente, puis compte par défaut des engagements. ») + case « Appliquer aux 6 factures non payées de cette catégorie », interrupteur « Budget saisi au niveau de cette catégorie » (avec explication de l'effet sur les sous-catégories), « Ajouter une sous-catégorie », « Fusionner avec… » (déplace opérations, factures et budgets vers une autre catégorie), « Supprimer ».
- **Suppression** : si la catégorie a des sous-catégories ou des données, proposer « Déplacer vers… » une autre catégorie au lieu de bloquer ; sinon confirmation simple.
- La catégorie TVA est marquée « Catégorie de la TVA » (infobulle : « Utilisée pour vos paiements et l'estimation de TVA. »).
- **Modèles sectoriels** : « Appliquer un modèle » (Commerce, Services, BTP, Restauration, Profession libérale…) qui ajoute les catégories manquantes sans rien supprimer.

### 7.10 Banques (`/parametres/banques`)

- **Carte par connexion** : logo, nom de la banque, état (« À jour · il y a 12 min » vert ; « Action requise » orange avec bouton précis : « Renouveler l'accès », « Saisir le code reçu », « Valider sur l'application de votre banque » ; « Erreur » rouge avec « Réessayer »), menu (Synchroniser, Gérer l'accès, Déconnecter : « Déconnecter Banque X ? Vos opérations passées et leurs catégories sont conservées. »).
- **Comptes de la connexion** : interrupteur « Inclus dans la trésorerie », nom (renommable en place), type, solde, dernière synchro ; badge « Par défaut pour les factures ».
- **Drawer compte** : Nom d'affichage, Solde retenu (Solde / Solde comptable / Solde instantané, avec valeur de chacun ou « Non fourni par la banque »), « Ignorer les cumuls de carte à débit différé », « Compte par défaut des factures » (indisponible si le compte est exclu, avec explication).
- **Ajouter** : « Connecter une banque » (offre limitée : « Votre offre inclut 1 banque. Passez à Performance pour en ajouter. » + « Voir les offres ») ; « Créer un compte manuel » (nom, solde d'ouverture, date) pour caisse ou banque non couverte.
- Démonstration : bandeau « Vous explorez des données de démonstration » + « Passer à mes vraies données ».

### 7.11 Intégrations (`/parametres/integrations`)

Catalogue en cartes filtrable (Facturation, Comptabilité, Paiement) : logo, nom, description en une ligne, état (Connecté / Non connecté / Bientôt), bouton « Connecter ».

| Connecteur | Authentification | Fonction |
| --- | --- | --- |
| Pennylane | OAuth2 (ou jeton API) | Factures clients et fournisseurs, statut de paiement, renvoi des rapprochements |
| Axonaut | Clé API | Factures |
| Evoliz | Clés publique et secrète | Factures |
| Sellsy | OAuth2 | Factures |
| Qonto, Stripe, GoCardless (paiements) | OAuth2 | Encaissements détaillés par client |
| ACD iSuite (Pré-comptabilité) | Identifiants cabinet | Plan de comptes, GED, envoi des écritures |

- Connexion par clé : drawer avec guide illustré en étapes (« Ouvrez Paramètres > API… »), champ masqué, « Tester la connexion » avant enregistrement.
- Carte connectée : dernière synchro, nombre de factures synchronisées, « Synchroniser », « Paramètres » (période d'import, sens, catégorie par défaut), « Déconnecter » (« Les factures déjà importées sont conservées et ne seront plus mises à jour. »), « Supprimer avec les factures importées ».
- Facture importée correspondant à une échéance récurrente manuelle → proposition de remplacement (7.8).

### 7.12 Analyses (`/analyses`)

Objectif : comprendre la structure de la trésorerie et ses tendances. Période (défaut : 12 derniers mois), comparaison avec la période précédente (interrupteur), « Télécharger le rapport PDF ».

1. **Indicateurs clés** : cartes KPI de 5.9 avec variation vs période précédente et bouton « ? » ouvrant une explication courte : ce que l'indicateur mesure, comment il est calculé, ce qu'il faut configurer (ex. : « Pour fiabiliser cet indicateur, indiquez le type de vos catégories. » + lien). KPI non calculable : « Configurez vos catégories pour afficher cet indicateur ».
2. **Où va l'argent** : deux graphiques en barres horizontales triées (encaissements et décaissements par catégorie racine, montant et part), dépliables par sous-catégorie. Les donuts sont abandonnés au profit de barres, plus lisibles.
3. **Évolution par catégorie** : courbes sur 12 mois (réel passé, prévision du scénario choisi en pointillés), sélection jusqu'à 6 catégories, palette du design system.
4. **Prévu vs réalisé** : tableau par catégorie (prévu, réalisé, écart €, écart %) trié par écart absolu, avec mini-barres.
5. **Clients et fournisseurs** : top 10 tiers par montant, délai moyen de paiement par tiers, concentration (part des 3 premiers clients).

**Rapport PDF** : couverture avec motif Optimum et logo, synthèse en une phrase, KPI, graphiques, prévu vs réalisé ; police Poppins / Raleway ; généré côté serveur (rendu HTML → PDF). Erreur : « Le rapport n'a pas pu être généré. Réessayez dans un instant. ».

### 7.13 Indicateurs (`/indicateurs`)

- Liste des indicateurs (nom, formule lisible, unité, valeur du mois courant, sparkline) ; « Nouvel indicateur » ; « Partir d'un modèle » (5.6).
- **Éditeur** : champ de formule avec autocomplétion des catégories et lignes (taper « Ven » propose « Ventes »), opérateurs + − × ÷ et parenthèses au clavier, coloration syntaxique (catégories en puces pétrole), validation en direct (« Parenthèse fermante manquante »), aperçu des valeurs sur 6 mois. Nom (unique : « Un indicateur porte déjà ce nom. »), Unité (3 caractères maximum), Format.
- Les indicateurs apparaissent dans le plan (7.4) et les exports.

### 7.14 Paramètres (`/parametres`)

Navigation verticale à gauche : Société · Mon profil · Utilisateurs · Catégories · Règles · Banques · Intégrations · Alertes · Abonnement · Imports · Journal d'activité. Rubriques d'administration masquées aux rôles non autorisés.

**Société** (enregistrement automatique par champ, toast « Enregistré ») :

| Libellé | Champ | Aide |
| --- | --- | --- |
| Nom de l'entreprise | name | — |
| SIREN, code NAF, secteur | siren, nafCode, sector | Pré-remplis depuis l'API Sirene |
| Seuil de trésorerie minimum | minCashThreshold | « Votre découvert autorisé ou le niveau sous lequel vous voulez être alerté. » |
| Estimation de la TVA | vat.enabled, vat.regime | Interrupteur + Mensuelle / Trimestrielle ; lien vers l'aide |
| Factures engagées | invoicesEnabled | « Intégrer vos factures à venir dans la trésorerie prévisionnelle. » |
| Mode du plan | forecastMode | Budget : « Le prévisionnel affiche vos budgets tels que saisis. » · Projection : « Le prévisionnel ajoute les dépassements déjà constatés. » ; schéma explicatif |
| Factures en retard dans le plan | overdueInPlan | Mois courant (recommandé) / Mois d'échéance |
| Exclusions automatiques | autoHide.refunds, autoHide.internalTransfers | « Exclure les remboursements » ; « Exclure les virements entre mes comptes » |
| Début d'exercice | fiscalYearStart | Utilisé pour le préréglage « Exercice » |

Zone sensible en bas : « Quitter cette société », « Supprimer la société » (saisie du nom pour confirmer ; « Toutes les données seront supprimées sous 30 jours. Les utilisateurs perdront l'accès. »).

**Mon profil** : prénom, nom, email (modification avec revalidation), téléphone, photo ; sécurité (mot de passe, passkeys, 2FA, sessions actives avec « Déconnecter ») ; préférences (thème, densité des tableaux, première page à l'ouverture) ; notifications par canal (récapitulatif hebdomadaire, rapport mensuel, alertes) ; parrainage (« Parrainez une entreprise : elle gagne 2 mois offerts, vous aussi. » + lien à copier + liste des filleuls).

**Utilisateurs** : « Inviter » (email, rôle avec description de chaque rôle) ; tableau Nom · Email · Rôle (modifiable) · Dernière activité · Statut (actif / invitation envoyée, « Renvoyer ») ; sièges utilisés / inclus ; « Inviter mon conseiller Optimum » (rôle Conseiller pré-sélectionné). Erreur : « Cette personne a déjà accès à la société. ».

**Règles** : liste (conditions lisibles « Libellé contient URSSAF », catégorie, application automatique oui/non, nombre d'opérations concernées) ; éditeur avec conditions combinables et aperçu en direct des opérations qui correspondent ; « Appliquer aux opérations existantes » ; ordre de priorité par glisser-déposer.

**Alertes** : une ligne par type (5.13) avec seuil, canaux et destinataires.

**Imports** : historique (fichier, date, type, lignes, auteur) ; « Annuler l'import » (« Les 248 opérations créées par cet import seront supprimées. »).

**Journal d'activité** : liste filtrable (utilisateur, type, période) des modifications (entité AuditLog, section 4), avec valeur avant / après.

### 7.15 Abonnement (`/parametres/abonnement`)

- Offre actuelle (nom, prix, prochaine facture, moyen de paiement, « Gérer le paiement » → portail Stripe), utilisation (banques, utilisateurs, options).
- Comparateur des offres : bascule Mensuel / Annuel (badge « −x % »), choix du nombre de banques (1 à 10), 3 cartes Découverte / Essentiel / Performance (prix, utilisateurs inclus, 6 points forts, « Choisir Essentiel »), carte Performance mise en avant (bordure orange, « Recommandé »), tableau détaillé dépliable « Comparer toutes les fonctionnalités ».
- Options : Lecture automatique des factures, Pré-comptabilité.
- Récapitulatif dynamique (offre, cycle, banques, utilisateurs, options, total HT / TTC) ; « Confirmer mon abonnement » (Stripe Checkout si aucun moyen de paiement, sinon mise à jour directe avec prorata affiché).
- Factures Stripe téléchargeables ; « Résilier » (parcours en 2 étapes avec motif et rappel : « Vous repasserez en offre Découverte le 30 nov. Vos données sont conservées. »).
- Société gérée par un cabinet : « Votre abonnement est géré par votre cabinet » et lien de contact.

### 7.16 Pré-comptabilité (`/precompta`, option)

Objectif : transformer factures et opérations en écritures prêtes pour l'expert-comptable.

**Tableau de bord** : flux en 4 colonnes type kanban — À traiter (OCR en cours) → À vérifier → Prêtes à envoyer → Envoyées — avec compteurs et actions en série (« Vérifier en série », « Envoyer en série »). KPI : écritures du mois, brouillons, validées, envoyées, erreurs.

**Vérification d'une pièce** : document à gauche, champs extraits à droite (Fournisseur / Client, Numéro, Date, Échéance, Montant TTC, TVA, Catégorie) puis **écriture proposée** générée automatiquement : compte de tiers (401/411) au TTC, compte de charge ou de produit (6xx/7xx selon l'association de la catégorie) au HT, compte de TVA (44566 / 44571 selon le taux) ; lignes modifiables (Compte, Libellé, Débit, Crédit, « Ajouter une ligne ») ; contrôle d'équilibre en direct (« Écart de 12,40 € entre débit et crédit ») ; « Valider » / « Refuser » (avec motif).

**Configuration** (onglets) :

- **Connexion comptable** : fournisseur (ACD iSuite, Démonstration), code dossier, URL du serveur, identifiants (chiffrés) ; « Tester la connexion » (« Connexion réussie » / « Échec : vérifiez l'URL et les identifiants ») ; « Synchroniser le plan de comptes ».
- **Plan de comptes** : recherche, filtre par type (Clients, Fournisseurs, Banques, Charges, Produits, TVA, Général), comptes visibles ou masqués.
- **TVA** : comptes de TVA déductible et collectée par taux, compte par défaut.
- **Correspondances** : catégorie ↔ compte comptable (avec taux), proposées automatiquement selon les noms ; filtre « Sans correspondance ».
- **Journaux** : journal des ventes, des achats, et un journal par compte bancaire (ou caisse).
- **GED** : arborescence des dossiers du logiciel comptable, choix des dossiers de destination des factures d'achat et de vente.

**Export FEC** : période, statut des écritures ; ZIP contenant le fichier FEC (format de l'article A47 A-1 du LPF, 18 colonnes) et les PDF des pièces ; contrôle de conformité avant téléchargement.

## 8. API, intégrations et notifications

L'API REST est versionnée (`/api/v1`), décrite en OpenAPI 3.1 et typée de bout en bout ; toutes les routes exigent une session valide sauf `/auth/*` et les webhooks signés, et filtrent sur la société active.

**Conventions**

- Ressources au pluriel, en anglais : `/transactions`, `/commitments`, `/budgets`, `/scenarios`…
- Listes : `?filter[categoryId]=…&filter[bookedAt][gte]=2026-01-01&sort=-bookedAt&cursor=…&limit=100` ; pagination par curseur ; `GET /<ressource>/count` avec les mêmes filtres.
- Écritures en lot : `POST /<ressource>/batch` (`{ "ops": [...] }`), réponse par élément.
- Erreurs au format RFC 9457 (`application/problem+json`) avec `code` stable (ex. `reconciliation.amount_exceeded`) traduit côté front.
- Idempotence des créations via l'en-tête `Idempotency-Key`.
- Concurrence optimiste : `If-Match` sur `updatedAt` pour les budgets et factures (conflit → « Cette valeur a été modifiée par Marie à l'instant. Recharger ? »).

**Routes principales**

| Domaine | Routes |
| --- | --- |
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/magic-link`, `/auth/passkey/*`, `/auth/oidc/:provider`, `/auth/refresh`, `/auth/logout`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/verify` |
| Moi et sociétés | `GET /me`, `PATCH /me`, `PUT /me/active-company`, `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id`, `GET /companies/lookup?q=` (Sirene), `/group-links` |
| Membres | `GET/POST /memberships`, `PATCH/DELETE /memberships/:id`, `POST /invitations`, `POST /invitations/:token/accept` |
| Banques | `POST /bank-connections/link` (URL agrégateur), `POST /bank-connections/:id/sync`, `GET/PATCH/DELETE /bank-connections/:id`, `GET/PATCH /bank-accounts/:id` |
| Opérations | `GET /transactions`, `PATCH /transactions/:id`, `POST /transactions/batch`, `POST /transactions/:id/split`, `DELETE /transactions/:id/split`, `GET /transactions/:id/similar`, `POST /transactions/import` |
| À traiter | `GET /inbox` (éléments typés : uncategorized, suggestion, reconciliation, overdue, document, duplicate), `POST /inbox/:id/resolve` |
| Factures | `GET/POST /commitments`, \`PATCH/DELETE /commitments/:id?scope=one |
| Rapprochements | `GET /reconciliations/suggestions`, `POST /reconciliations`, `PATCH /reconciliations/:id` (confirm/reject), `DELETE /reconciliations/:id` |
| Documents | `POST /documents` (upload signé), `GET /documents/:id`, `PATCH /documents/:id` (validation des champs), `POST /documents/:id/convert` (→ facture) |
| Catégories et règles | `GET/POST /categories`, `PATCH/DELETE /categories/:id`, `POST /categories/:id/move`, `POST /categories/:id/merge`, `POST /categories/templates/:sector`, `GET/POST /rules`, `PATCH/DELETE /rules/:id`, `POST /rules/:id/preview`, `POST /rules/:id/apply` |
| Budgets et scénarios | `GET /plan?from=2026-09-01&months=12&scenario=…&accounts=…`, `PUT /budgets` (lot de cellules), `POST /budgets/repeat`, `POST /budgets/from-history`, `POST /budgets/vat`, `GET/POST /scenarios`, `PATCH/DELETE /scenarios/:id`, `GET /scenarios/compare?ids=` |
| Journalier et analyses | `GET /daily?from&to&granularity&accounts&includeBudgets`, `GET /analytics/kpis?from&to`, `GET /analytics/breakdown`, `GET /analytics/trends`, `GET /analytics/counterparties` |
| Indicateurs | `GET/POST /indicators`, `PATCH/DELETE /indicators/:id`, `POST /indicators/validate` |
| Exports et imports | `POST /exports` (asynchrone, renvoie un job), `GET /exports/:id`, `GET /budgets/template.xlsx`, `POST /budgets/import`, `GET/DELETE /imports/:id` |
| Alertes et notifications | `GET/PUT /alerts`, `GET /notifications`, `POST /notifications/read`, `GET /events` (SSE) |
| Commentaires et audit | `GET/POST /comments`, `PATCH /comments/:id`, `GET /audit-logs` |
| Abonnement | `GET /billing`, `POST /billing/checkout`, `POST /billing/portal`, `PUT /billing/subscription`, `GET /billing/invoices`, `POST /webhooks/stripe` |
| Intégrations | `GET /integrations/catalog`, `POST /integrations/:provider/connect`, `GET /integrations/:provider/callback`, `POST /integrations/:id/sync`, `DELETE /integrations/:id?withData=` |
| Pré-comptabilité | `/precompta/connection` (+ `/test`, `/sync`), `/precompta/ledger-accounts`, `/precompta/vat-accounts`, `/precompta/mappings`, `/precompta/journals`, `/precompta/dms`, `/precompta/entries` (+ `/:id/validate`, `/send`, `/reject`), `POST /precompta/fec-export` |
| Divers | `POST /advisor-requests`, `GET /referrals`, `POST /demo-data` |

**Intégrations indispensables au MVP** : agrégateur bancaire (Bridge : lien, retour, synchro planifiée 4 fois par jour, webhooks de nouvelles opérations), Stripe (Checkout, portail, webhooks d'abonnement, d'essai et d'échec de paiement) et emails transactionnels. OCR : service spécialisé factures (Mindee ou Azure Document Intelligence) appelé par un worker.

**Notifications in-app** : toasts courts (succès 4 s, erreur persistante jusqu'à fermeture), avec action « Annuler » ou « Voir » quand c'est utile. Exemples : « Catégorie enregistrée », « 3 opérations similaires catégorisées — Annuler », « Budget enregistré », « Import terminé : 248 lignes », « Connexion bancaire rétablie ». Écran d'erreur global : motif Optimum + « Quelque chose s'est mal passé. Rechargez la page ; si le problème continue, notre équipe est déjà prévenue. » + « Recharger ».

**Emails** (gabarits MJML : en-tête pétrole avec logo blanc, bande de motif, police Raleway, bouton orange) :

| Email | Déclencheur | Contenu |
| --- | --- | --- |
| Vérification de l'adresse | Inscription | Bouton « Confirmer mon adresse » (lien valable 24 h, connexion directe) |
| Lien de connexion | Demande de lien magique | Bouton « Me connecter » (valable 15 min) |
| Bienvenue | Fin de l'onboarding | 3 premiers gestes + contact d'un conseiller Optimum |
| Réinitialisation du mot de passe | Demande | Bouton (valable 1 h) |
| Invitation | Ajout d'un membre | Société, invitant, rôle, bouton « Rejoindre » |
| Récapitulatif hebdomadaire | Lundi 8 h, si activé | Solde, variation de la semaine, point bas à 30 jours, éléments à traiter, factures en retard |
| Rapport mensuel | 2 du mois, si activé | Prévu vs réalisé du mois écoulé, solde fin de mois, 3 KPI, PDF joint |
| Alerte de trésorerie | Règles 5.13 | Phrase d'alerte, graphique miniature, bouton « Voir le plan » |
| Banque à reconnecter | Action requise > 24 h | Bouton « Rétablir la connexion » |
| Fin d'essai | J−3 et dernier jour | Ce qui reste et ce qui change, bouton « Choisir mon offre » |
| Paiement en échec | Webhook Stripe | Bouton « Mettre à jour ma carte » |

**Prise en main** : liste de démarrage dans l'accueil (« Connecter une banque », « Catégoriser 10 opérations », « Saisir un premier budget », « Inviter un collaborateur », « Définir votre seuil ») avec progression ; info-bulles contextuelles à la première visite de chaque écran (refermables, jamais bloquantes) ; centre d'aide intégré dans un panneau latéral.

## 9. Plan de livraison et critères d'acceptation

Le développement se fait en 7 lots livrables indépendamment, le lot 0 posant le design system avant tout écran ; un lot est accepté quand ses critères passent en tests automatisés (unitaires, end-to-end Playwright, accessibilité axe) et en recette manuelle.

| Lot | Contenu | Critères d'acceptation clés |
| --- | --- | --- |
| 0. Design system | Tokens, thème Ant Design, polices, composants clés (1.7), mode sombre, Storybook | Tous les composants documentés dans Storybook en clair et sombre ; contrastes AA vérifiés automatiquement ; aucune couleur codée en dur hors tokens |
| 1. Socle | Auth (mot de passe, lien magique, passkeys, OIDC), sociétés, rôles, layout, navigation, palette de commandes, onboarding, paramètres Société / Profil / Utilisateurs | Inscription → vérification → onboarding → accueil en < 3 min ; un Lecteur ne peut rien modifier (UI et API 403) ; changement de société sans rechargement ; RLS testée (aucune fuite inter-sociétés) |
| 2. Banque et opérations | Agrégateur, comptes manuels, import, page Opérations, À traiter, règles, catégorisation assistée, division, exclusions | Catégoriser une opération propose les similaires et la création de règle ; division 258,20 en 2 = 130,00 + 128,20 ; « Reste à répartir » ≠ 0 bloque la validation ; 50 éléments traités au clavier dans À traiter |
| 3. Plan de trésorerie | Moteur de calcul, budgets, scénarios calques, modes Budget / Projection, édition type tableur, répétition, assistant prévisionnel, comparaison, indicateurs | Tests unitaires 5.2 à 5.7 ; soldes enchaînés mois par mois ; scénario alternatif vide = valeurs de base ; collage Excel 12 × 20 ; plan 24 mois ≤ 1,5 s |
| 4. Engagements | Factures manuelles et récurrentes, OCR, import, rapprochements, compte en cascade, doublons, vue au jour le jour, simulation de report, alertes | Série mensuelle de 12 = 12 échéances ; modification « et les suivantes » épargne passées / payées / remplacées ; rapprochement > montant refusé ; facture en retard comptée aujourd'hui ; alerte seuil déclenchée sur un jeu de test |
| 5. Analyses et exports | KPI 5.9, graphiques, rapport PDF, exports XLSX/CSV, import/export des budgets, TVA | KPI recalculés sur le jeu de test fourni ; un onglet XLSX par contenu coché ; aller-retour export → import des budgets sans perte ; TVA trimestrielle versée le mois suivant la fin du trimestre |
| 6. Abonnement, intégrations, pré-compta | Stripe, offres et aperçus hors offre, intégrations facturation, conseiller Optimum, module pré-comptabilité, FEC | Offre Découverte : aperçus sur données d'exemple, aucune donnée réelle exposée ; > 1 banque impose Performance ; FEC conforme (18 colonnes, contrôle avant export) ; écriture déséquilibrée non validable |

**Jeu de données de démonstration** (`POST /demo-data`) : société « Atelier Démo », 2 comptes, 12 mois d'opérations catégorisées (ventes \~10 k€/mois avec saisonnalité, fournisseurs, salaires, URSSAF, loyer, frais bancaires), budgets sur 12 mois, 7 factures clients dont 2 en retard, 4 factures fournisseurs, 1 scénario alternatif « Recrutement en mars », 1 indicateur « Taux d'achats consommés », 1 règle, 1 alerte de seuil.

**Points à décider**

- Factures en retard dans le plan : mois courant (proposé, 5.5) ou mois d'échéance.
- Règles exactes de TVA (exigibilité, acomptes du régime simplifié) : à valider avec un expert-comptable Optimum.
- Suggestion de catégorie par IA (5.10) : fournisseur et hébergement des données (UE) à choisir.
- Tarifs des offres Essentiel et Performance et des options : à fixer dans Stripe.
- Contenu exact des emails de récapitulatif et du rapport mensuel : maquettes à produire.
- Liste définitive des intégrations au lancement (Pennylane, Axonaut, Evoliz, Sellsy, Qonto) et de l'éditeur comptable pour la pré-comptabilité.
- Déclinaison du logo « optimum tréso » : à faire valider par le graphiste de la charte.
