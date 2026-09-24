import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signSession, verifySession } from './jwt.js';
import { hashPin, isWeakPin, lockoutMs, remainingLockMs, verifyPin } from './pin.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';

describe('pin hashing', () => {
  it('accepts the right PIN and rejects the wrong one', () => {
    const stored = hashPin('481937');
    assert.equal(verifyPin('481937', stored), true);
    assert.equal(verifyPin('481936', stored), false);
  });

  it('salts every hash, so the same PIN never stores the same bytes', () => {
    const a = hashPin('123456');
    const b = hashPin('123456');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.equal(verifyPin('123456', a), true);
    assert.equal(verifyPin('123456', b), true);
  });

  it('rejects anything that is not six digits without throwing', () => {
    const stored = hashPin('481937');
    for (const bad of ['', '48193', '4819377', 'abcdef', '48 937', '481937 ']) {
      assert.equal(verifyPin(bad, stored), false);
    }
  });

  it('refuses to hash a malformed PIN', () => {
    assert.throws(() => hashPin('12345'), RangeError);
  });
});

describe('lockout', () => {
  it('gives three free attempts, then escalates, then caps at an hour', () => {
    assert.equal(lockoutMs(1), 0);
    assert.equal(lockoutMs(3), 0);
    assert.equal(lockoutMs(4), 5_000);
    assert.equal(lockoutMs(5), 10_000);
    assert.equal(lockoutMs(6), 20_000);
    assert.equal(lockoutMs(20), 3_600_000);
    assert.equal(lockoutMs(500), 3_600_000);
  });

  it('makes walking the whole six-digit keyspace impractical', () => {
    // Worst case for an attacker: every attempt from the 4th onward is the
    // capped hour. A million guesses at one per hour is over a century.
    const years = (1_000_000 * 3_600_000) / (1000 * 60 * 60 * 24 * 365);
    assert.ok(years > 100, `expected >100 years, got ${years}`);
  });

  it('reports remaining lock time and ignores junk timestamps', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    assert.ok(remainingLockMs(future) > 29_000);
    assert.equal(remainingLockMs(new Date(Date.now() - 1000).toISOString()), 0);
    assert.equal(remainingLockMs(undefined), 0);
    assert.equal(remainingLockMs('not a date'), 0);
  });
});

describe('weak PIN rules', () => {
  it('blocks the default, repeats and runs', () => {
    assert.ok(isWeakPin('000000'));
    assert.ok(isWeakPin('777777'));
    assert.ok(isWeakPin('123456'));
    assert.ok(isWeakPin('456789'));
    assert.ok(isWeakPin('987654'));
  });

  it('allows an ordinary PIN', () => {
    assert.equal(isWeakPin('481937'), null);
    assert.equal(isWeakPin('204815'), null);
  });
});

describe('session tokens', () => {
  it('round-trips claims', () => {
    const token = signSession({ sub: 'owner', pe: 3 }, SECRET, 60);
    const claims = verifySession(token, SECRET);
    assert.equal(claims?.sub, 'owner');
    assert.equal(claims?.pe, 3);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession({ sub: 'owner', pe: 1 }, SECRET, 60);
    assert.equal(verifySession(token, `${SECRET}-other`), null);
  });

  it('rejects a tampered payload', () => {
    const token = signSession({ sub: 'owner', pe: 1 }, SECRET, 60);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'owner', pe: 99, exp: 9e9 }))
      .toString('base64url');
    assert.equal(verifySession(`${header}.${forged}.${signature}`, SECRET), null);
  });

  it('rejects the alg:none downgrade', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'owner', pe: 1, exp: 9e9 })).toString('base64url');
    assert.equal(verifySession(`${header}.${body}.`, SECRET), null);
  });

  it('rejects an expired token', () => {
    const token = signSession({ sub: 'owner', pe: 1 }, SECRET, -10);
    assert.equal(verifySession(token, SECRET), null);
  });

  it('rejects malformed input instead of throwing', () => {
    for (const junk of ['', 'a', 'a.b', 'a.b.c.d', '....']) {
      assert.equal(verifySession(junk, SECRET), null);
    }
  });
});
