/**
 * The balance engine.
 *
 * Pure functions over an ExpenseEvent. No I/O, no dates, no randomness — the
 * same event always produces the same balances, which is what makes this
 * testable and safe to run on both the API and the client.
 *
 * Sign convention for `netMinor`, everywhere:
 *     positive  -> this member/group is OWED money (they are up)
 *     negative  -> this member/group OWES money (they are down)
 *     zero      -> square
 */

import {
  convertMinor,
  minorDigitsFor,
  splitByShares,
  splitEqual,
  splitExact,
} from './money.js';
import type {
  ExpenseEvent,
  ExpenseLine,
  Id,
  Member,
  MinorUnits,
} from './types.js';

export interface MemberBalance {
  memberId: Id;
  name: string;
  groupId: Id;
  /** Total this member fronted as payer, in home currency. */
  paidMinor: MinorUnits;
  /** Total consumed as a participant, in home currency. */
  shareMinor: MinorUnits;
  /** Cash handed to others via settlements. */
  settledOutMinor: MinorUnits;
  /** Cash received from others via settlements. */
  settledInMinor: MinorUnits;
  netMinor: MinorUnits;
}

export interface GroupBalance {
  groupId: Id;
  label: string;
  isFamily: boolean;
  memberIds: Id[];
  netMinor: MinorUnits;
}

export interface Transfer {
  fromGroupId: Id;
  toGroupId: Id;
  fromLabel: string;
  toLabel: string;
  amountMinor: MinorUnits;
}

export interface Balances {
  homeCurrency: string;
  homeDigits: number;
  byMember: MemberBalance[];
  byGroup: GroupBalance[];
  /** Everything spent on the event, in home currency. */
  totalSpentMinor: MinorUnits;
  totalsByCategoryMinor: Record<Id, MinorUnits>;
  /** True when every GROUP nets to zero, within `tolerance`. */
  isBalanced: boolean;
  /** Lines the engine could not compute (no participants, unknown payer, ...). */
  skippedLineIds: Id[];
}

/**
 * The unit that actually has to settle. Members in a family settle together;
 * everyone else settles as themselves.
 */
export function groupIdOf(member: Member, knownFamilyIds: Set<Id>): Id {
  return member.familyId && knownFamilyIds.has(member.familyId)
    ? `family:${member.familyId}`
    : `member:${member.id}`;
}

/** Convert one line into home-currency minor units. */
export function lineTotalInHome(line: ExpenseLine, event: ExpenseEvent): MinorUnits {
  const homeDigits = minorDigitsFor(event.homeCurrency, event.currencyDigits);
  if (line.currency === event.homeCurrency) return line.amountMinor;
  const fromDigits = minorDigitsFor(line.currency, event.currencyDigits);
  return convertMinor(line.amountMinor, line.rateToHome, fromDigits, homeDigits);
}

/**
 * Per-participant shares for one line, already converted to home currency and
 * guaranteed to sum exactly to the line's home-currency total.
 */
export function sharesForLine(
  line: ExpenseLine,
  event: ExpenseEvent,
): Record<Id, MinorUnits> {
  const total = lineTotalInHome(line, event);
  switch (line.split.mode) {
    case 'shares':
      return splitByShares(total, line.split.shares);
    case 'exact': {
      // Exact amounts are authored in the line's own currency, so convert each
      // one and hand any rounding drift to the largest share.
      if (line.currency === event.homeCurrency) {
        return splitExact(total, line.split.amounts);
      }
      const fromDigits = minorDigitsFor(line.currency, event.currencyDigits);
      const homeDigits = minorDigitsFor(event.homeCurrency, event.currencyDigits);
      const converted: Record<Id, MinorUnits> = {};
      for (const [id, amount] of Object.entries(line.split.amounts)) {
        converted[id] = convertMinor(amount, line.rateToHome, fromDigits, homeDigits);
      }
      const drift = total - Object.values(converted).reduce((a, b) => a + b, 0);
      if (drift !== 0) {
        const biggest = Object.keys(converted).sort(
          (a, b) => Math.abs(converted[b]) - Math.abs(converted[a]) || (a < b ? -1 : 1),
        )[0];
        converted[biggest] += drift;
      }
      return converted;
    }
    case 'equal':
    default:
      return splitEqual(total, line.participantIds);
  }
}

export interface BalanceOptions {
  /**
   * Minor units of slack allowed when deciding whether a group is square.
   * Default 0 — integer maths means an untouched event balances exactly.
   * Raise it if you want to let the user write off a paisa or two.
   */
  tolerance?: number;
}

export function computeBalances(
  event: ExpenseEvent,
  options: BalanceOptions = {},
): Balances {
  const tolerance = Math.abs(options.tolerance ?? 0);
  const homeDigits = minorDigitsFor(event.homeCurrency, event.currencyDigits);

  const memberById = new Map(event.members.map((m) => [m.id, m]));
  const familyIds = new Set(event.families.map((f) => f.id));
  const familyById = new Map(event.families.map((f) => [f.id, f]));

  const acc = new Map<Id, MemberBalance>();
  for (const member of event.members) {
    acc.set(member.id, {
      memberId: member.id,
      name: member.name,
      groupId: groupIdOf(member, familyIds),
      paidMinor: 0,
      shareMinor: 0,
      settledOutMinor: 0,
      settledInMinor: 0,
      netMinor: 0,
    });
  }

  const skippedLineIds: Id[] = [];
  const totalsByCategoryMinor: Record<Id, MinorUnits> = {};
  let totalSpentMinor = 0;

  for (const line of event.lines) {
    if (!memberById.has(line.payerId)) {
      skippedLineIds.push(line.id);
      continue;
    }
    let shares: Record<Id, MinorUnits>;
    try {
      shares = sharesForLine(line, event);
    } catch {
      skippedLineIds.push(line.id);
      continue;
    }
    if (Object.keys(shares).some((id) => !memberById.has(id))) {
      skippedLineIds.push(line.id);
      continue;
    }

    const total = lineTotalInHome(line, event);
    totalSpentMinor += total;
    const categoryKey = line.categoryId ?? 'uncategorised';
    totalsByCategoryMinor[categoryKey] =
      (totalsByCategoryMinor[categoryKey] ?? 0) + total;

    acc.get(line.payerId)!.paidMinor += total;
    for (const [memberId, share] of Object.entries(shares)) {
      acc.get(memberId)!.shareMinor += share;
    }
  }

  for (const s of event.settlements) {
    const from = acc.get(s.fromMemberId);
    const to = acc.get(s.toMemberId);
    if (!from || !to || s.fromMemberId === s.toMemberId) continue;
    from.settledOutMinor += s.amountMinor;
    to.settledInMinor += s.amountMinor;
  }

  for (const b of acc.values()) {
    b.netMinor = b.paidMinor - b.shareMinor + b.settledOutMinor - b.settledInMinor;
  }

  const byMember = event.members.map((m) => acc.get(m.id)!);

  const groups = new Map<Id, GroupBalance>();
  for (const b of byMember) {
    let group = groups.get(b.groupId);
    if (!group) {
      const isFamily = b.groupId.startsWith('family:');
      const familyId = b.groupId.slice('family:'.length);
      group = {
        groupId: b.groupId,
        label: isFamily
          ? (familyById.get(familyId)?.name ?? 'Family')
          : b.name,
        isFamily,
        memberIds: [],
        netMinor: 0,
      };
      groups.set(b.groupId, group);
    }
    group.memberIds.push(b.memberId);
    group.netMinor += b.netMinor;
  }

  const byGroup = [...groups.values()];
  const isBalanced =
    skippedLineIds.length === 0 &&
    byGroup.every((g) => Math.abs(g.netMinor) <= tolerance);

  return {
    homeCurrency: event.homeCurrency,
    homeDigits,
    byMember,
    byGroup,
    totalSpentMinor,
    totalsByCategoryMinor,
    isBalanced,
    skippedLineIds,
  };
}

/**
 * Suggest who should pay whom to close the event out.
 *
 * Greedy largest-debtor to largest-creditor. For a handful of groups this
 * produces at most (groups - 1) transfers, which is the theoretical minimum in
 * all but contrived cases, and runs instantly.
 *
 * Returns group-level transfers. A family can nominate any of its members to
 * actually hand over the cash — that is what Settlement.fromMemberId records.
 */
export function suggestTransfers(
  balances: Balances,
  options: BalanceOptions = {},
): Transfer[] {
  const tolerance = Math.abs(options.tolerance ?? 0);

  const debtors = balances.byGroup
    .filter((g) => g.netMinor < -tolerance)
    .map((g) => ({ ...g, remaining: -g.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || (a.groupId < b.groupId ? -1 : 1));

  const creditors = balances.byGroup
    .filter((g) => g.netMinor > tolerance)
    .map((g) => ({ ...g, remaining: g.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || (a.groupId < b.groupId ? -1 : 1));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) {
      transfers.push({
        fromGroupId: debtor.groupId,
        toGroupId: creditor.groupId,
        fromLabel: debtor.label,
        toLabel: creditor.label,
        amountMinor: amount,
      });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
    }
    if (debtor.remaining <= 0) i += 1;
    if (creditor.remaining <= 0) j += 1;
  }

  return transfers;
}

/** Can the user press "Close event"? */
export function canClose(event: ExpenseEvent, options: BalanceOptions = {}): boolean {
  return event.status === 'open' && computeBalances(event, options).isBalanced;
}
