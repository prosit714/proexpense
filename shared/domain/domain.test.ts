import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeBalances,
  convertMinor,
  formatMinor,
  parseToMinor,
  splitByShares,
  splitEqual,
  suggestTransfers,
  validateEvent,
  hasErrors,
} from './index.js';
import type { ExpenseEvent, ExpenseLine, Settlement } from './types.js';

function line(over: Partial<ExpenseLine> & Pick<ExpenseLine, 'id'>): ExpenseLine {
  return {
    name: 'Line',
    date: '2026-09-20',
    amountMinor: 0,
    currency: 'INR',
    rateToHome: 1,
    payerId: 'm-alex',
    participantIds: [],
    split: { mode: 'equal' },
    ...over,
  };
}

function event(over: Partial<ExpenseEvent> = {}): ExpenseEvent {
  return {
    id: 'e1',
    name: 'Goa trip',
    status: 'open',
    homeCurrency: 'INR',
    rates: {},
    families: [{ id: 'f-sharma', name: 'Sharma family' }],
    members: [
      { id: 'm-priya', name: 'Priya', familyId: 'f-sharma' },
      { id: 'm-raj', name: 'Raj', familyId: 'f-sharma' },
      { id: 'm-alex', name: 'Alex' },
      { id: 'm-bo', name: 'Bo' },
    ],
    categories: [{ id: 'c-food', name: 'Food' }],
    lines: [],
    settlements: [],
    ...over,
  };
}

function netOf(ev: ExpenseEvent, memberId: string): number {
  return computeBalances(ev).byMember.find((b) => b.memberId === memberId)!.netMinor;
}

function groupNet(ev: ExpenseEvent, groupId: string): number {
  return computeBalances(ev).byGroup.find((g) => g.groupId === groupId)!.netMinor;
}

describe('money', () => {
  it('splits an indivisible total without losing a paisa', () => {
    const shares = splitEqual(10000, ['m-a', 'm-b', 'm-c']);
    assert.deepEqual(shares, { 'm-a': 3334, 'm-b': 3333, 'm-c': 3333 });
    assert.equal(Object.values(shares).reduce((a, b) => a + b, 0), 10000);
  });

  it('hands out the remainder deterministically regardless of input order', () => {
    const a = splitEqual(10000, ['m-c', 'm-a', 'm-b']);
    const b = splitEqual(10000, ['m-a', 'm-b', 'm-c']);
    assert.deepEqual(a, b);
  });

  it('splits refunds symmetrically with charges', () => {
    const shares = splitEqual(-10000, ['m-a', 'm-b', 'm-c']);
    assert.equal(Object.values(shares).reduce((s, v) => s + v, 0), -10000);
    assert.deepEqual(shares, { 'm-a': -3334, 'm-b': -3333, 'm-c': -3333 });
  });

  it('refuses to split between nobody', () => {
    assert.throws(() => splitEqual(1000, []), RangeError);
  });

  it('weights a share split and still sums exactly', () => {
    const shares = splitByShares(10000, { 'm-a': 2, 'm-b': 1 });
    assert.deepEqual(shares, { 'm-a': 6667, 'm-b': 3333 });
    assert.equal(shares['m-a'] + shares['m-b'], 10000);
  });

  it('converts between currencies with different minor-unit digits', () => {
    // 1000 yen at 0.55 INR per yen -> 550.00 INR -> 55000 paise
    assert.equal(convertMinor(1000, 0.55, 0, 2), 55000);
    // 100.00 USD at 83.25 -> 8325.00 INR
    assert.equal(convertMinor(10000, 83.25, 2, 2), 832500);
  });

  it('rejects a non-positive exchange rate', () => {
    assert.throws(() => convertMinor(10000, 0, 2, 2), RangeError);
  });

  it('round-trips display strings', () => {
    assert.equal(formatMinor(12345), '123.45');
    assert.equal(formatMinor(-5), '-0.05');
    assert.equal(formatMinor(1000, 0), '1000');
    assert.equal(parseToMinor('123.45'), 12345);
    assert.equal(parseToMinor('1,234'), 123400);
    assert.throws(() => parseToMinor('12.345'), RangeError);
    assert.throws(() => parseToMinor('abc'), RangeError);
  });
});

describe('balances', () => {
  it('credits the payer and debits every participant', () => {
    const ev = event({
      lines: [
        line({
          id: 'l1',
          name: 'Dinner',
          amountMinor: 30000,
          payerId: 'm-priya',
          categoryId: 'c-food',
          participantIds: ['m-priya', 'm-raj', 'm-alex', 'm-bo'],
        }),
      ],
    });
    assert.equal(netOf(ev, 'm-priya'), 22500);
    assert.equal(netOf(ev, 'm-raj'), -7500);
    assert.equal(netOf(ev, 'm-alex'), -7500);
    assert.equal(netOf(ev, 'm-bo'), -7500);
    assert.equal(computeBalances(ev).totalSpentMinor, 30000);
  });

  it('always nets to zero across all members', () => {
    const ev = event({
      lines: [
        line({ id: 'l1', amountMinor: 10000, payerId: 'm-alex', participantIds: ['m-alex', 'm-bo', 'm-raj'] }),
        line({ id: 'l2', amountMinor: 7777, payerId: 'm-bo', participantIds: ['m-priya', 'm-bo'] }),
        line({ id: 'l3', amountMinor: 333, payerId: 'm-raj', participantIds: ['m-priya', 'm-raj', 'm-alex', 'm-bo'] }),
      ],
    });
    const sum = computeBalances(ev).byMember.reduce((s, b) => s + b.netMinor, 0);
    assert.equal(sum, 0);
  });

  it('uses the rate snapshotted on the line, not the current event rate', () => {
    const ev = event({
      rates: { USD: 90 }, // rate was edited after the line was saved
      lines: [
        line({
          id: 'l1',
          name: 'Hotel',
          amountMinor: 10000, // $100.00
          currency: 'USD',
          rateToHome: 83.25, // snapshot at entry time
          payerId: 'm-alex',
          participantIds: ['m-alex', 'm-bo'],
        }),
      ],
    });
    assert.equal(computeBalances(ev).totalSpentMinor, 832500);
    assert.equal(netOf(ev, 'm-alex'), 416250);
  });

  it('skips a broken line instead of producing wrong numbers', () => {
    const ev = event({
      lines: [line({ id: 'bad', amountMinor: 5000, payerId: 'm-ghost', participantIds: ['m-alex'] })],
    });
    const b = computeBalances(ev);
    assert.deepEqual(b.skippedLineIds, ['bad']);
    assert.equal(b.totalSpentMinor, 0);
    assert.equal(b.isBalanced, false);
  });
});

describe('families', () => {
  it('treats an internally lopsided family as settled', () => {
    // Priya pays for a meal she shares only with Raj. She is up 5000 and he is
    // down 5000, but the Sharma family as a whole owes nobody.
    const ev = event({
      lines: [
        line({
          id: 'l1',
          name: 'Cab',
          amountMinor: 10000,
          payerId: 'm-priya',
          participantIds: ['m-priya', 'm-raj'],
        }),
      ],
    });
    assert.equal(netOf(ev, 'm-priya'), 5000);
    assert.equal(netOf(ev, 'm-raj'), -5000);
    assert.equal(groupNet(ev, 'family:f-sharma'), 0);
    assert.equal(computeBalances(ev).isBalanced, true);
  });

  it('lets one member clear the whole family debt in a single payment', () => {
    const base = event({
      lines: [
        line({
          id: 'l1',
          name: 'Villa',
          amountMinor: 40000,
          payerId: 'm-alex',
          participantIds: ['m-priya', 'm-raj', 'm-alex', 'm-bo'],
        }),
      ],
    });
    assert.equal(groupNet(base, 'family:f-sharma'), -20000);
    assert.equal(computeBalances(base).isBalanced, false);

    // Raj pays Alex the family's entire 200.00 share.
    const settlement: Settlement = {
      id: 's1',
      date: '2026-09-21',
      fromMemberId: 'm-raj',
      toMemberId: 'm-alex',
      amountMinor: 20000,
    };
    const settled = { ...base, settlements: [settlement] };

    assert.equal(groupNet(settled, 'family:f-sharma'), 0);
    // Raj individually is now up 10000 and Priya is down 10000 — that is fine,
    // they sort it out at home.
    assert.equal(netOf(settled, 'm-raj'), 10000);
    assert.equal(netOf(settled, 'm-priya'), -10000);

    // The family is square, but Bo has not paid yet, so the event stays open
    // and the only remaining suggestion is Bo -> Alex.
    assert.equal(computeBalances(settled).isBalanced, false);
    const remaining = suggestTransfers(computeBalances(settled));
    assert.deepEqual(
      remaining.map((t) => [t.fromGroupId, t.toGroupId, t.amountMinor]),
      [['member:m-bo', 'member:m-alex', 10000]],
    );

    // Once Bo settles too, the whole event closes out.
    const done = {
      ...settled,
      settlements: [
        settlement,
        { id: 's2', date: '2026-09-21', fromMemberId: 'm-bo', toMemberId: 'm-alex', amountMinor: 10000 },
      ],
    };
    assert.equal(computeBalances(done).isBalanced, true);
  });

  it('settles a member individually when their family has been deleted', () => {
    const ev = event({
      families: [],
      lines: [
        line({
          id: 'l1',
          amountMinor: 10000,
          payerId: 'm-priya',
          participantIds: ['m-priya', 'm-raj'],
        }),
      ],
    });
    assert.equal(groupNet(ev, 'member:m-raj'), -5000);
    assert.equal(computeBalances(ev).isBalanced, false);
  });
});

describe('settlement suggestions', () => {
  it('closes out an event in at most (groups - 1) transfers', () => {
    const ev = event({
      lines: [
        line({
          id: 'l1',
          name: 'Villa',
          amountMinor: 40000,
          payerId: 'm-alex',
          participantIds: ['m-priya', 'm-raj', 'm-alex', 'm-bo'],
        }),
      ],
    });
    const balances = computeBalances(ev);
    const transfers = suggestTransfers(balances);
    // Three groups: Sharma family, Alex, Bo.
    assert.equal(balances.byGroup.length, 3);
    assert.ok(transfers.length <= 2, `expected <= 2 transfers, got ${transfers.length}`);
    assert.ok(transfers.every((t) => t.toGroupId === 'member:m-alex'));
    assert.equal(transfers.reduce((s, t) => s + t.amountMinor, 0), 30000);
  });

  it('applying every suggested transfer balances the event', () => {
    const ev = event({
      lines: [
        line({ id: 'l1', amountMinor: 33333, payerId: 'm-alex', participantIds: ['m-priya', 'm-raj', 'm-alex', 'm-bo'] }),
        line({ id: 'l2', amountMinor: 12000, payerId: 'm-bo', participantIds: ['m-bo', 'm-priya'] }),
        line({ id: 'l3', amountMinor: 900, payerId: 'm-raj', participantIds: ['m-alex'] }),
      ],
    });
    const transfers = suggestTransfers(computeBalances(ev));

    // Each family transfer is paid by its first member; the group nets are what matter.
    const settlements: Settlement[] = transfers.map((t, i) => ({
      id: `s${i}`,
      date: '2026-09-22',
      fromMemberId: computeBalances(ev).byGroup.find((g) => g.groupId === t.fromGroupId)!.memberIds[0],
      toMemberId: computeBalances(ev).byGroup.find((g) => g.groupId === t.toGroupId)!.memberIds[0],
      amountMinor: t.amountMinor,
    }));

    const after = computeBalances({ ...ev, settlements });
    assert.equal(after.isBalanced, true);
    assert.deepEqual(suggestTransfers(after), []);
  });

  it('suggests nothing for an already square event', () => {
    assert.deepEqual(suggestTransfers(computeBalances(event())), []);
  });
});

describe('validation', () => {
  it('flags a foreign line with no rate and a line with no participants', () => {
    const ev = event({
      lines: [
        line({ id: 'l1', name: 'Hotel', amountMinor: 10000, currency: 'USD', rateToHome: 0, participantIds: ['m-alex'] }),
        line({ id: 'l2', name: 'Taxi', amountMinor: 500, participantIds: [] }),
      ],
    });
    const issues = validateEvent(ev);
    assert.ok(hasErrors(issues));
    assert.ok(issues.some((i) => i.target === 'line:l1' && /exchange rate/i.test(i.message)));
    assert.ok(issues.some((i) => i.target === 'line:l2' && /participant/i.test(i.message)));
  });

  it('warns rather than errors when a family has been deleted underneath a member', () => {
    const issues = validateEvent(event({ families: [] }));
    assert.equal(hasErrors(issues), false);
    assert.equal(issues.filter((i) => i.severity === 'warning').length, 2);
  });

  it('accepts a clean event', () => {
    const ev = event({
      lines: [line({ id: 'l1', name: 'Dinner', amountMinor: 30000, participantIds: ['m-alex', 'm-bo'] })],
    });
    assert.deepEqual(validateEvent(ev), []);
  });
});
