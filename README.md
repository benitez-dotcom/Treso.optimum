# Tréso Optimum

Logiciel de pilotage de trésorerie pour TPE/PME, aux couleurs de la charte Optimum.
Ce dépôt contient le **lot 0** (design system) et un premier socle front branché sur un
moteur de calcul testé, avec des données de démonstration (« Atelier Démo »).

## Démarrer

Prérequis : Node 22 et pnpm 10.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # tests du moteur de calcul
pnpm build      # vérification des types + build de production
```

Les données de démonstration sont générées par rapport à la date du jour et
conservées dans le navigateur (localStorage). Menu profil (en bas de la barre
latérale) → « Réinitialiser les données de démonstration » pour repartir de zéro.

## Structure

```
packages/engine   @optimum/treso-engine — règles de calcul (cahier des charges, section 5)
apps/web          @optimum/web — application React (Vite, TypeScript, Ant Design)
```

### Moteur de calcul (`packages/engine`)

Module pur, sans dépendance à l'interface, couvert par 34 tests unitaires
reprenant les exemples normatifs du cahier des charges :

| Fichier | Règles |
| --- | --- |
| `plan.ts` | 5.1 agrégation, 5.2 scénarios calques, 5.3 prévision (Budget / Projection, budget global), 5.4 soldes, 5.5 factures en retard |
| `budgets.ts` | 5.7 répétition d'une valeur, assistant « partir de mon historique » |
| `indicators.ts` | 5.6 indicateurs personnalisés : parseur arithmétique, sans `eval` |
| `vat.ts` | 5.8 estimation de la TVA (mensuelle / trimestrielle, crédit reporté) |
| `kpis.ts` | 5.9 ratios, autonomie de trésorerie, soldes quotidiens, 5.13 seuil |
| `categorize.ts` | 5.10 règles et suggestions par similarité |
| `split.ts` | Division d'une opération (258,20 en 2 → 130,00 + 128,20) |
| `format.ts` | Formats français (montants, mois, dates) |

### Application (`apps/web`)

- **Design system** : tokens CSS `--opt-*` (`src/theme/tokens.css`), thème Ant Design
  (`src/theme/antdTheme.ts`), Poppins / Raleway auto-hébergées, mode sombre (auto, clair, sombre).
- **Accueil** : phrase de synthèse, alerte de seuil, KPI, trajectoire, éléments à traiter,
  prévu vs réalisé, échéances, conseils.
- **À traiter** : file de validation au clavier (↑ ↓, Entrée, C, X), suggestions de catégorie,
  rapprochements, factures en retard, « Annuler » sur chaque action, création de règle.
- **Plan de trésorerie** : scénarios (création, comparaison), modes Budget / Projection,
  édition type tableur (Entrée, Échap, clic droit pour répéter), détail d'une cellule,
  ligne d'indicateur, alertes de seuil.

Les autres écrans affichent un état « à venir » : ils sont prévus dans les lots suivants.

## Prochaines étapes (plan de livraison, section 9)

1. API (NestJS + PostgreSQL avec RLS) et authentification — lot 1.
2. Agrégation bancaire, page Opérations, imports — lot 2.
3. Factures, OCR, vue au jour le jour — lot 4.

Le logo « optimum tréso » est une reconstitution provisoire : à remplacer par le fichier du graphiste.
