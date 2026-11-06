import pg from 'pg';

// Dates (`date`) en chaînes ISO, montants (`numeric`) en nombres
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export interface TenantContext {
  userId: string;
  companyId?: string | null;
}

/**
 * Exécute `fn` dans une transaction où les politiques RLS voient
 * l'utilisateur et la société courants (`app.user_id`, `app.company_id`).
 * Les réglages sont locaux à la transaction : ils ne fuient pas d'une requête à l'autre.
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)", [
      ctx.userId,
      ctx.companyId ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Change la société du contexte dans une transaction déjà ouverte. */
export async function setCompanyContext(tx: Tx, companyId: string): Promise<void> {
  await tx.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
}

/** Transaction sans contexte société (tables d'authentification, non cloisonnées). */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
