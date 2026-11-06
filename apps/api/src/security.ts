import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { badRequest } from './errors';

/** Jeton aléatoire opaque (lien d'email, refresh token, invitation). */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Seule l'empreinte d'un jeton est stockée en base. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Politique de mot de passe (section 4) : au moins 10 caractères, sans règle
 * de composition arbitraire ; refus des mots de passe triviaux.
 */
const trivial = new Set(['motdepasse', 'password12', 'azertyuiop', '1234567890', 'tresorerie', 'optimum123']);
export function checkPasswordPolicy(password: string, email?: string): void {
  if (password.length < 10) throw badRequest('auth.password_too_short', 'Choisissez un mot de passe d\'au moins 10 caractères.');
  if (password.length > 256) throw badRequest('auth.password_too_long', 'Ce mot de passe est trop long.');
  const lower = password.toLowerCase();
  if (trivial.has(lower) || /^(.)\1+$/.test(password) || (email && email.split('@')[0]!.length >= 4 && lower.includes(email.split('@')[0]!.toLowerCase()))) {
    throw badRequest('auth.password_weak', 'Ce mot de passe est trop facile à deviner. Essayez une phrase de passe.');
  }
}

export const hashPassword = (password: string): Promise<string> =>
  hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hashed: string, password: string): Promise<boolean> => verify(hashed, password).catch(() => false);

export interface AccessClaims {
  sub: string;
}

export async function signAccessToken(userId: string, secret: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('treso-optimum')
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: 'treso-optimum', algorithms: ['HS256'] });
    return payload.sub ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}
