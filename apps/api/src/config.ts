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
  /** Agrégateur bancaire Bridge (https://docs.bridgeapi.io) : absent = seule la banque de démonstration est proposée. */
  bridge: { clientId: string; clientSecret: string; baseUrl: string; version: string } | null;
  /** Serveur d'envoi d'emails (ex. OVH : ssl0.ovh.net, port 465). Absent = emails journalisés seulement. */
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string } | null;
  /** Domaines email autorisés à créer un compte sans invitation (vide = inscription ouverte). */
  signupAllowedDomains: string[];
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
    bridge:
      process.env.BRIDGE_CLIENT_ID && process.env.BRIDGE_CLIENT_SECRET
        ? {
            clientId: process.env.BRIDGE_CLIENT_ID,
            clientSecret: process.env.BRIDGE_CLIENT_SECRET,
            baseUrl: process.env.BRIDGE_BASE_URL ?? 'https://api.bridgeapi.io',
            version: process.env.BRIDGE_VERSION ?? '2025-01-15',
          }
        : null,
    smtp:
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 465),
            secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
            from: process.env.SMTP_FROM ?? `Tréso Optimum <${process.env.SMTP_USER}>`,
          }
        : null,
    signupAllowedDomains: (process.env.SIGNUP_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    ...overrides,
  };
  if (config.env === 'production') {
    // Exposer les liens des emails en ligne permettrait de prendre le contrôle de n'importe quel compte
    if (config.exposeEmailLinks) throw new Error('EXPOSE_EMAIL_LINKS doit rester à false en production.');
    if (!config.smtp) throw new Error("SMTP_HOST, SMTP_USER et SMTP_PASS sont requis en production : sans eux, personne ne peut confirmer son adresse.");
  }
  return config;
}
