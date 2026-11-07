import { randomUUID } from 'node:crypto';
import { buildDemoData, demoCategories, type DemoData } from '@optimum/demo-data';
import { todayInParis } from '@optimum/treso-engine';
import { setCompanyContext, type Tx } from '../db';

export interface NewCompany {
  name: string;
  siren?: string | null;
  sector?: string | null;
  demo: boolean;
}

/** Insère en lot des lignes dans une table (paramètres positionnels). */
async function insertMany(tx: Tx, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values: unknown[] = [];
    const tuples = part.map((r) => {
      const ph = r.map((v) => {
        values.push(v);
        return `$${values.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    await tx.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
}

/** Écrit les données d'une société (catégories, comptes, opérations…). */
export async function seedCompany(tx: Tx, companyId: string, data: DemoData): Promise<void> {
  // Parents avant enfants pour respecter la clé étrangère
  const cats = [...data.categories].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
  await insertMany(
    tx,
    'categories',
    ['company_id', 'id', 'name', 'flow', 'parent_id', 'position', 'kind', 'vat_rate', 'budget_at_parent', 'is_vat', 'is_system'],
    cats.map((c) => [companyId, c.id, c.name, c.flow, c.parentId, c.position, c.kind, c.vatRate, c.budgetAtParent, c.isVat ?? false, c.isSystem ?? false]),
  );
  await insertMany(
    tx,
    'bank_accounts',
    ['company_id', 'id', 'name', 'bank_name', 'balance', 'is_active'],
    data.accounts.map((a) => [companyId, a.id, a.name, a.bankName, a.balance, a.isActive]),
  );
  await insertMany(
    tx,
    'transactions',
    ['company_id', 'id', 'account_id', 'booked_at', 'raw_label', 'label', 'counterparty', 'amount', 'category_id', 'suggestion', 'hidden'],
    data.transactions.map((t) => [
      companyId, t.id, t.accountId, t.bookedAt, t.rawLabel, t.label, t.counterparty ?? null, t.amount, t.categoryId,
      t.suggestion ? JSON.stringify(t.suggestion) : null, t.hidden,
    ]),
  );
  await insertMany(
    tx,
    'commitments',
    ['company_id', 'id', 'flow', 'counterparty', 'number', 'label', 'amount_incl_tax', 'amount_paid', 'vat_rate', 'issued_at', 'due_at', 'status', 'category_id', 'hidden', 'account_id', 'series_id', 'series_index', 'payment_terms', 'source'],
    data.commitments.map((c) => [
      companyId, c.id, c.flow, c.counterparty, c.number ?? null, c.label, c.amountInclTax, c.amountPaid ?? 0, c.vatRate, c.issuedAt, c.dueAt, c.status,
      c.categoryId, c.hidden, c.accountId ?? null, c.seriesId ?? null, c.seriesIndex ?? null, c.paymentTerms ?? null, c.source ?? 'manual',
    ]),
  );
  await insertMany(tx, 'scenarios', ['company_id', 'id', 'name', 'color', 'is_base'], data.scenarios.map((s) => [companyId, s.id, s.name, s.color, s.isBase]));
  await insertMany(
    tx,
    'budgets',
    ['company_id', 'scenario_id', 'category_id', 'month', 'amount'],
    data.budgets.filter((b) => b.amount !== null).map((b) => [companyId, b.scenarioId, b.categoryId, b.month, b.amount]),
  );
  await insertMany(
    tx,
    'rules',
    ['company_id', 'id', 'conditions', 'category_id', 'auto_apply', 'priority'],
    data.rules.map((r) => [companyId, r.id, JSON.stringify(r.conditions), r.categoryId, r.autoApply, r.priority]),
  );
  await insertMany(tx, 'indicators', ['company_id', 'id', 'name', 'formula', 'unit'], data.indicators.map((i) => [companyId, i.id, i.name, i.formula, i.unit]));
}

/**
 * Crée une société, rend son créateur propriétaire et l'active.
 * Une société normale démarre avec l'arbre de catégories par défaut et un
 * scénario de base ; une société de démonstration reçoit « Atelier Démo ».
 */
export async function createCompany(tx: Tx, userId: string, input: NewCompany): Promise<string> {
  const id = randomUUID();
  // Le contexte RLS doit viser la nouvelle société avant l'insertion (lecture du RETURNING, membres)
  await setCompanyContext(tx, id);
  await tx.query(
    `INSERT INTO companies (id, name, siren, sector, plan, is_demo, created_by, trial_ends_at, min_cash_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '14 days', $8)`,
    [id, input.name, input.siren ?? null, input.sector ?? null, input.demo ? 'DEMO' : 'PERFORMANCE', input.demo, userId, input.demo ? 35_000 : 0],
  );
  await tx.query("INSERT INTO memberships (company_id, user_id, role) VALUES ($1, $2, 'OWNER')", [id, userId]);
  await tx.query('UPDATE users SET active_company_id = $2, updated_at = now() WHERE id = $1', [userId, id]);

  const data: DemoData = input.demo
    ? buildDemoData(todayInParis())
    : {
        companyName: input.name,
        accounts: [],
        categories: demoCategories,
        transactions: [],
        commitments: [],
        scenarios: [{ id: 'base', name: 'Scénario de base', color: '#114C5C', isBase: true }],
        budgets: [],
        rules: [],
        indicators: [],
      };
  await seedCompany(tx, id, data);
  return id;
}
