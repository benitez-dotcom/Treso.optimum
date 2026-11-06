import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { MemoryMailer } from './mailer';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl);

if (process.env.MIGRATE_ON_START !== 'false') {
  await migrate(config.databaseOwnerUrl, config.appDbRole, (m) => console.log(m));
}

// En production, remplacer MemoryMailer par un fournisseur d'emails
const mailer = new MemoryMailer((m) => console.log(`[email] ${m}`));
const app = await buildApp({ config, db, mailer, logger: true });

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
