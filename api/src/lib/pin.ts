/**
 * PIN hashing and lockout.
 *
 * Uses Node's built-in scrypt rather than argon2. argon2 is a native module,
 * and Static Web Apps' managed Functions build in an Oryx container where a
 * failed node-gyp compile is both likely and miserable to debug. scrypt is a
 * memory-hard KDF in the standard library, needs no install step, and at these
 * parameters costs ~100ms per attempt — which combined with the lockout below
 * is what makes a 6-digit secret survivable.
 *
 * The threat model matters here: 6 digits is a million combinations. The hash
 * protects the PIN if the database leaks. The lockout is what stops someone
 * walking the keyspace against the live endpoint. Neither alone is enough.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 32;
// 128 * N * r = 32 MiB, which is exactly Node's default cap. Ask for more or
// scrypt throws.
const MAX_MEM = 64 * 1024 * 1024;

export const DEFAULT_PIN = '000000';
export const PIN_PATTERN = /^\d{6}$/;

export interface PinHash {
  salt: string;
  hash: string;
  algorithm: 'scrypt';
  params: { N: number; r: number; p: number; keyLength: number };
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

export function hashPin(pin: string): PinHash {
  if (!isValidPinFormat(pin)) {
    throw new RangeError('PIN must be exactly six digits');
  }
  const salt = randomBytes(32);
  const hash = scryptSync(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: MAX_MEM,
  });
  return {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    algorithm: 'scrypt',
    params: { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, keyLength: KEY_LENGTH },
  };
}

export function verifyPin(pin: string, stored: PinHash): boolean {
  if (!isValidPinFormat(pin)) return false;
  const salt = Buffer.from(stored.salt, 'base64');
  const expected = Buffer.from(stored.hash, 'base64');
  const actual = scryptSync(pin, salt, stored.params.keyLength, {
    N: stored.params.N,
    r: stored.params.r,
    p: stored.params.p,
    maxmem: MAX_MEM,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Escalating backoff. Three free attempts for genuine fat fingers, then
 * doubling delays capped at an hour.
 *
 *   attempts 1-3  -> no lock
 *   4             -> 5s
 *   5             -> 10s
 *   6             -> 20s
 *   ...
 *   11 and beyond -> 1 hour
 *
 * At a one-hour cap, walking a million PINs takes about 114 years.
 */
export function lockoutMs(failedAttempts: number): number {
  if (failedAttempts <= 3) return 0;
  const seconds = Math.min(5 * 2 ** (failedAttempts - 4), 3600);
  return seconds * 1000;
}

export function remainingLockMs(lockedUntil: string | undefined, now = Date.now()): number {
  if (!lockedUntil) return 0;
  const until = Date.parse(lockedUntil);
  if (Number.isNaN(until)) return 0;
  return Math.max(0, until - now);
}

/** Is this PIN too guessable to allow as a replacement for the default? */
export function isWeakPin(pin: string): string | null {
  if (pin === DEFAULT_PIN) return 'Choose something other than the default PIN';
  if (/^(\d)\1{5}$/.test(pin)) return 'Six identical digits is too easy to guess';
  const ascending = '01234567890';
  const descending = '09876543210';
  if (ascending.includes(pin) || descending.includes(pin)) {
    return 'Sequential digits are too easy to guess';
  }
  return null;
}
