import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Erreur métier renvoyée au format RFC 9457 (`application/problem+json`). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new ApiError(400, code, message, details);
export const unauthorized = (code = 'auth.unauthorized', message = 'Votre session a expiré. Reconnectez-vous pour continuer.') =>
  new ApiError(401, code, message);
export const forbidden = (code = 'auth.forbidden', message = "Vous n'avez pas les droits pour cette action.") => new ApiError(403, code, message);
export const notFound = (code = 'not_found', message = 'Élément introuvable.') => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  let status = 500;
  let code = 'server.error';
  let message = 'Un incident est survenu de notre côté. Réessayez dans un instant ; si le problème persiste, contactez le support.';
  let details: unknown;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'validation.invalid';
    message = 'Certaines informations sont invalides.';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if ('statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
    status = err.statusCode;
    code = status === 429 ? 'rate_limited' : 'request.invalid';
    message = status === 429 ? 'Trop de tentatives. Réessayez dans 1 minute.' : err.message;
  } else {
    req.log.error({ err }, 'Erreur non gérée');
  }

  return reply
    .status(status)
    .type('application/problem+json')
    .send({ type: `https://treso.optimum/errors/${code}`, title: message, status, code, ...(details ? { details } : {}) });
}
