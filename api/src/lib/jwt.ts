/**
 * A very small HS256 JWT implementation.
 *
 * One user, one claim, one algorithm. Pulling in a full JWT library for this
 * would add a dependency whose main feature set — multiple algorithms, JWKS,
 * key rotation — is surface area we would never use but would still have to
 * patch. Forty lines of node:crypto is the smaller risk.
 *
 * The algorithm is pinned at verify time, so the "alg: none" family of attacks
 * has nothing to work with.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionClaims {
  /** Subject. Always 'owner' — there is exactly one account. */
  sub: string;
  /** Issued at, seconds. */
  iat: number;
  /** Expiry, seconds. */
  exp: number;
  /**
   * Password epoch. Bumped whenever the PIN changes, which instantly
   * invalidates every token issued before the change.
   */
  pe: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function signSession(
  claims: Omit<SessionClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifySession(token: string, secret: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  let parsedHeader: { alg?: string };
  try {
    parsedHeader = JSON.parse(fromB64url(header).toString('utf8'));
  } catch {
    return null;
  }
  if (parsedHeader.alg !== 'HS256') return null;

  const expected = Buffer.from(sign(`${header}.${body}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return claims;
}
