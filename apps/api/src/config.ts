/** Configuration lue dans l'environnement (voir `.env.example`). */
export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  /** Connexion du rôle applicatif (soumis aux politiques RLS). */
  databaseUrl: string;
  /** Connexion du rôle propriétaire (migrations uniquement). */
  databaseOwnerUrl: string;
  /** Rôle PostgreSQL de l'application, qui reçoit les droits après migration. */
  appDbRole: string;
  jwtSecret: string;
  /** URL publique du front, pour les liens envoyés par email. */
  appUrl: string;
  corsOrigins: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  /** Tolérance (ms) avant de traiter la réutilisation d'un refresh token comme un vol. */
  refreshReuseGraceMs: number;
  /** Dossier du front compilé, servi par l'API (déploiement en un seul service). */
  webDist: string | null;
  /** Cookie de session réservé au HTTPS (désactivable pour un usage local en http). */
  cookieSecure: boolean;
  /** Expose les liens des emails dans les réponses (développement et tests uniquement). */
  exposeEmailLinks: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV ?? 'development') as Config['env'];
  const jwtSecret = process.env.JWT_SECRET ?? (env === 'production' ? '' : 'dev-secret-change-me-dev-secret-change-me');
  if (env === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET doit faire au moins 32 caractères en production.');
  }
  const config: Config = {
    env,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://treso_app:treso_app@localhost:5432/treso',
    databaseOwnerUrl: process.env.DATABASE_OWNER_URL ?? 'postgres://treso_owner:treso@localhost:5432/treso',
    appDbRole: process.env.APP_DB_ROLE ?? 'treso_app',
    jwtSecret,
    appUrl: process.env.APP_URL ?? 'http://localhost:5173',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    refreshReuseGraceMs: 10_000,
    webDist: process.env.WEB_DIST ?? null,
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env === 'production',
    exposeEmailLinks: process.env.EXPOSE_EMAIL_LINKS ? process.env.EXPOSE_EMAIL_LINKS === 'true' : env !== 'production',
    ...overrides,
  };
  return config;
}
