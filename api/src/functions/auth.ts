import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';

import { type AuthDoc, AUTH_DOC_ID, readAuth, writeAuth } from '../lib/cosmos.js';
import {
  clearedCookie,
  json,
  loadConfig,
  problem,
  readJson,
  sessionCookie,
  SESSION_TTL_SECONDS,
} from '../lib/http.js';
import { signSession } from '../lib/jwt.js';
import { authenticate } from '../lib/session.js';
import {
  DEFAULT_PIN,
  hashPin,
  isValidPinFormat,
  isWeakPin,
  lockoutMs,
  remainingLockMs,
  verifyPin,
} from '../lib/pin.js';

/**
 * Creates the auth document on first ever request, seeded with the default PIN
 * and flagged so the app forces a change before anything else is reachable.
 */
async function ensureAuthDoc(connectionString: string): Promise<AuthDoc> {
  const existing = await readAuth(connectionString);
  if (existing) return existing;
  const seeded: AuthDoc = {
    id: AUTH_DOC_ID,
    pin: hashPin(DEFAULT_PIN),
    mustChangePin: true,
    failedAttempts: 0,
    pinEpoch: 1,
    updatedAt: new Date().toISOString(),
  };
  return writeAuth(connectionString, seeded);
}

app.http('login', {
  route: 'auth/login',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    const body = await readJson<{ pin?: unknown }>(request);
    const auth = await ensureAuthDoc(config.cosmosConnectionString);

    const locked = remainingLockMs(auth.lockedUntil);
    if (locked > 0) {
      return problem(429, 'Too many wrong PINs. Try again later.', {
        retryAfterSeconds: Math.ceil(locked / 1000),
      });
    }

    // Deliberately identical failure handling for malformed and wrong PINs, so
    // the response cannot be used to probe the format.
    const supplied = body?.pin;
    const ok = isValidPinFormat(supplied) && verifyPin(supplied, auth.pin);

    if (!ok) {
      const failedAttempts = auth.failedAttempts + 1;
      const lockMs = lockoutMs(failedAttempts);
      await writeAuth(config.cosmosConnectionString, {
        ...auth,
        failedAttempts,
        lockedUntil:
          lockMs > 0 ? new Date(Date.now() + lockMs).toISOString() : undefined,
      });
      return problem(401, 'That PIN is not right.', {
        retryAfterSeconds: lockMs > 0 ? Math.ceil(lockMs / 1000) : 0,
      });
    }

    await writeAuth(config.cosmosConnectionString, {
      ...auth,
      failedAttempts: 0,
      lockedUntil: undefined,
    });

    const token = signSession(
      { sub: 'owner', pe: auth.pinEpoch },
      config.sessionSecret,
      SESSION_TTL_SECONDS,
    );

    return json(
      200,
      { mustChangePin: auth.mustChangePin },
      { headers: { 'Set-Cookie': sessionCookie(token, config.secureCookies) } },
    );
  },
});

app.http('session', {
  route: 'auth/session',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    const session = await authenticate(request, config);
    if (!session) return json(200, { signedIn: false });
    const auth = await readAuth(config.cosmosConnectionString);
    return json(200, { signedIn: true, mustChangePin: auth?.mustChangePin ?? false });
  },
});

app.http('changePin', {
  route: 'auth/change-pin',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    const session = await authenticate(request, config);
    if (!session) return problem(401, 'Sign in first');

    const body = await readJson<{ currentPin?: unknown; newPin?: unknown }>(request);
    const auth = await readAuth(config.cosmosConnectionString);
    if (!auth) return problem(500, 'Account is not set up');

    // Re-checking the current PIN means a stolen session alone cannot lock the
    // real owner out of their own app.
    if (!isValidPinFormat(body?.currentPin) || !verifyPin(body.currentPin, auth.pin)) {
      return problem(401, 'Current PIN is not right.');
    }
    if (!isValidPinFormat(body?.newPin)) {
      return problem(400, 'New PIN must be exactly six digits.');
    }
    const weak = isWeakPin(body.newPin);
    if (weak) return problem(400, weak);

    const updated = await writeAuth(config.cosmosConnectionString, {
      ...auth,
      pin: hashPin(body.newPin),
      mustChangePin: false,
      failedAttempts: 0,
      lockedUntil: undefined,
      pinEpoch: auth.pinEpoch + 1,
    });

    // Issue a fresh token on the new epoch so the current device stays signed
    // in while every other device is signed out.
    const token = signSession(
      { sub: 'owner', pe: updated.pinEpoch },
      config.sessionSecret,
      SESSION_TTL_SECONDS,
    );

    return json(
      200,
      { changed: true },
      { headers: { 'Set-Cookie': sessionCookie(token, config.secureCookies) } },
    );
  },
});

app.http('logout', {
  route: 'auth/logout',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (): Promise<HttpResponseInit> => {
    const config = loadConfig();
    return json(
      200,
      { signedOut: true },
      { headers: { 'Set-Cookie': clearedCookie(config.secureCookies) } },
    );
  },
});
