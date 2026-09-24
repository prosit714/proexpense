/**
 * Integer money arithmetic.
 *
 * Every function here takes and returns whole minor units. The only place a
 * float is allowed is an exchange rate, and its result is immediately rounded
 * back to an integer.
 */

import type { Id, MinorUnits } from './types.js';

export const DEFAULT_MINOR_DIGITS = 2;

export function minorDigitsFor(
  currency: string,
  overrides?: Record<string, number>,
): number {
  const d = overrides?.[currency];
  return Number.isInteger(d) ? (d as number) : DEFAULT_MINOR_DIGITS;
}

/**
 * Math.round breaks ties toward +Infinity, so -2.5 becomes -2 while 2.5
 * becomes 3. That asymmetry makes refunds round differently from charges.
 * Round away from zero in both directions instead.
 */
export function roundAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Convert an amount from one currency's minor units into another's.
 *
 * Handles currencies with different minor-unit digits, so ¥1000 (JPY, 0
 * digits) at a rate of 0.55 becomes 55000 paise, not 550.
 */
export function convertMinor(
  amountMinor: MinorUnits,
  rate: number,
  fromDigits: number = DEFAULT_MINOR_DIGITS,
  toDigits: number = DEFAULT_MINOR_DIGITS,
): MinorUnits {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`Exchange rate must be a positive number, got ${rate}`);
  }
  return roundAwayFromZero(amountMinor * rate * 10 ** (toDigits - fromDigits));
}

/** Deterministic order used whenever leftover minor units are handed out. */
function stableOrder(ids: Id[]): Id[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function dedupe(ids: Id[]): Id[] {
  return [...new Set(ids)];
}

/**
 * Split a total equally, distributing the leftover minor units one at a time.
 *
 * 10000 paise across 3 people is 3334 / 3333 / 3333 — never 3333.33. The extra
 * units go to participants in sorted-id order, so the same inputs always
 * produce the same output regardless of array ordering, and re-saving a line
 * never silently reshuffles who absorbed the rounding.
 *
 * The returned shares always sum exactly back to `totalMinor`.
 */
export function splitEqual(
  totalMinor: MinorUnits,
  participantIds: Id[],
): Record<Id, MinorUnits> {
  const ids = dedupe(participantIds);
  if (ids.length === 0) {
    throw new RangeError('Cannot split a line with no participants');
  }

  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(totalMinor);
  const base = Math.floor(abs / ids.length);
  const remainder = abs - base * ids.length;

  const bonus = new Set(stableOrder(ids).slice(0, remainder));
  const out: Record<Id, MinorUnits> = {};
  for (const id of ids) {
    out[id] = sign * (base + (bonus.has(id) ? 1 : 0));
  }
  return out;
}

/**
 * Weighted split using the largest-remainder method, so the shares still sum
 * exactly to the total. Ties in the fractional part are broken by sorted id.
 */
export function splitByShares(
  totalMinor: MinorUnits,
  shares: Record<Id, number>,
): Record<Id, MinorUnits> {
  const ids = Object.keys(shares);
  if (ids.length === 0) {
    throw new RangeError('Cannot split a line with no participants');
  }
  for (const id of ids) {
    if (!Number.isFinite(shares[id]) || shares[id] < 0) {
      throw new RangeError(`Share weight for ${id} must be a non-negative number`);
    }
  }

  const totalWeight = ids.reduce((sum, id) => sum + shares[id], 0);
  if (totalWeight <= 0) {
    throw new RangeError('Share weights must add up to more than zero');
  }

  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(totalMinor);

  const rows = ids.map((id) => {
    const exact = (abs * shares[id]) / totalWeight;
    const floor = Math.floor(exact);
    return { id, floor, fraction: exact - floor };
  });

  let leftover = abs - rows.reduce((sum, r) => sum + r.floor, 0);
  const ranked = [...rows].sort(
    (a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : 1),
  );
  for (const row of ranked) {
    if (leftover <= 0) break;
    row.floor += 1;
    leftover -= 1;
  }

  const out: Record<Id, MinorUnits> = {};
  for (const row of rows) out[row.id] = sign * row.floor;
  return out;
}

/** Validate a caller-supplied exact split and return it unchanged. */
export function splitExact(
  totalMinor: MinorUnits,
  amounts: Record<Id, MinorUnits>,
): Record<Id, MinorUnits> {
  const ids = Object.keys(amounts);
  if (ids.length === 0) {
    throw new RangeError('Cannot split a line with no participants');
  }
  for (const id of ids) {
    if (!Number.isInteger(amounts[id])) {
      throw new RangeError(`Exact amount for ${id} must be a whole minor-unit integer`);
    }
  }
  const sum = ids.reduce((acc, id) => acc + amounts[id], 0);
  if (sum !== totalMinor) {
    throw new RangeError(
      `Exact split adds up to ${sum} but the line total is ${totalMinor}`,
    );
  }
  return { ...amounts };
}

/** Display helper: 12345 with 2 digits becomes "123.45". */
export function formatMinor(
  amountMinor: MinorUnits,
  digits: number = DEFAULT_MINOR_DIGITS,
): string {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor).toString().padStart(digits + 1, '0');
  if (digits === 0) return sign + abs;
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

/** Input helper: "123.45" with 2 digits becomes 12345. Rejects junk. */
export function parseToMinor(
  input: string,
  digits: number = DEFAULT_MINOR_DIGITS,
): MinorUnits {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '-') {
    throw new RangeError(`"${input}" is not a valid amount`);
  }
  const negative = trimmed.startsWith('-');
  const [whole, frac = ''] = trimmed.replace('-', '').split('.');
  if (frac.length > digits) {
    throw new RangeError(`Amounts can have at most ${digits} decimal places`);
  }
  const combined = `${whole || '0'}${frac.padEnd(digits, '0')}`;
  const value = Number(combined);
  return negative ? -value : value;
}
