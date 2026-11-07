import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { MemoryMailer, SmtpMailer, type Mailer } from './mailer';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl);

if (process.env.MIGRATE_ON_START !== 'false') {
  await migrate(config.databaseOwnerUrl, config.appDbRole, (m) => console.log(m));
}

// Emails réels si un serveur SMTP est configuré, sinon journalisés (développement)
const mailer: Mailer = config.smtp ? new SmtpMailer(config.smtp, config.appUrl) : new MemoryMailer((m) => console.log(`[email] ${m}`));
const app = await buildApp({ config, db, mailer, logger: true });

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
