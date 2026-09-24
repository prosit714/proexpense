/**
 * The guard every non-auth endpoint runs first.
 *
 * Checks the signed cookie, then checks the token's PIN epoch against the one
 * stored in the database. Changing the PIN bumps that epoch, which signs every
 * other device out immediately — which is the behaviour you want if you changed
 * the PIN because you think someone saw it.
 */

import type { HttpRequest } from '@azure/functions';
import { verifySession } from './jwt.js';
import { readAuth } from './cosmos.js';
import { type Config, readCookie, SESSION_COOKIE } from './http.js';

export interface Session {
  sub: string;
  pinEpoch: number;
}

export async function authenticate(
  request: HttpRequest,
  config: Config,
): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const claims = verifySession(token, config.sessionSecret);
  if (!claims) return null;

  const auth = await readAuth(config.cosmosConnectionString);
  if (!auth || auth.pinEpoch !== claims.pe) return null;

  return { sub: claims.sub, pinEpoch: claims.pe };
}
