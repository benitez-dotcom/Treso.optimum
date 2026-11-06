import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config';
import type { Db } from './db';
import { errorHandler } from './errors';
import type { Mailer } from './mailer';
import { registerAuthRoutes } from './routes/auth';
import { registerAccountRoutes } from './routes/account';
import { registerDataRoutes } from './routes/data';

export interface AppOptions {
  config: Config;
  db: Db;
  mailer: Mailer;
  logger?: boolean;
}

export async function buildApp({ config, db, mailer, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: 'info' } : false, trustProxy: true });
  app.decorate('deps', { config, db, mailer });
  app.setErrorHandler(errorHandler);

  await app.register(cookie);
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  // Limite globale large ; les routes d'authentification ont une limite stricte
  await app.register(rateLimit, { global: true, max: config.env === 'test' ? 10_000 : 300, timeWindow: '1 minute' });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      registerAuthRoutes(api);
      registerAccountRoutes(api);
      registerDataRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
