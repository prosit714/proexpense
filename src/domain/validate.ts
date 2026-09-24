/**
 * Validation. Runs on the API before every write, and on the client to drive
 * inline field errors. Returns issues rather than throwing so the UI can show
 * all of them at once.
 */

import type { ExpenseEvent, Id } from './types.js';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** 'line:<id>' | 'settlement:<id>' | 'member:<id>' | 'event' */
  target: string;
  message: string;
}

export function validateEvent(event: ExpenseEvent): Issue[] {
  const issues: Issue[] = [];
  const memberIds = new Set(event.members.map((m) => m.id));
  const familyIds = new Set(event.families.map((f) => f.id));
  const categoryIds = new Set(event.categories.map((c) => c.id));

  const add = (severity: Severity, target: string, message: string) =>
    issues.push({ severity, target, message });

  if (!event.homeCurrency) add('error', 'event', 'The event needs a home currency');
  if (event.members.length === 0) add('error', 'event', 'Add at least one member');

  for (const [code, rate] of Object.entries(event.rates ?? {})) {
    if (!Number.isFinite(rate) || rate <= 0) {
      add('error', 'event', `Exchange rate for ${code} must be greater than zero`);
    }
  }

  for (const member of event.members) {
    if (member.familyId && !familyIds.has(member.familyId)) {
      add(
        'warning',
        `member:${member.id}`,
        `${member.name} points at a family that no longer exists and will settle individually`,
      );
    }
  }

  for (const line of event.lines) {
    const t = `line:${line.id}`;
    if (!line.name?.trim()) add('error', t, 'Line needs a name');
    if (!Number.isInteger(line.amountMinor)) {
      add('error', t, 'Amount must be a whole number of minor units');
    }
    if (line.amountMinor === 0) add('warning', t, 'Amount is zero');
    if (!memberIds.has(line.payerId)) add('error', t, 'Payer is not a member of this event');
    if (line.categoryId && !categoryIds.has(line.categoryId)) {
      add('warning', t, 'Category no longer exists');
    }
    if (line.participantIds.length === 0) {
      add('error', t, 'Select at least one participant');
    }
    const unknown = line.participantIds.filter((id: Id) => !memberIds.has(id));
    if (unknown.length > 0) {
      add('error', t, `${unknown.length} participant(s) are not members of this event`);
    }
    if (line.currency !== event.homeCurrency) {
      if (!Number.isFinite(line.rateToHome) || line.rateToHome <= 0) {
        add('error', t, `Set an exchange rate for ${line.currency}`);
      }
    } else if (line.rateToHome !== 1) {
      add('warning', t, 'Home-currency line has a rate other than 1');
    }
    if (line.split.mode === 'exact') {
      const sum = Object.values(line.split.amounts).reduce((a, b) => a + b, 0);
      if (sum !== line.amountMinor) {
        add('error', t, 'Exact split does not add up to the line total');
      }
    }
    if (line.split.mode === 'shares') {
      const total = Object.values(line.split.shares).reduce((a, b) => a + b, 0);
      if (!(total > 0)) add('error', t, 'Share weights must add up to more than zero');
    }
  }

  for (const s of event.settlements) {
    const t = `settlement:${s.id}`;
    if (!memberIds.has(s.fromMemberId) || !memberIds.has(s.toMemberId)) {
      add('error', t, 'Settlement references someone who is not a member');
    }
    if (s.fromMemberId === s.toMemberId) {
      add('error', t, 'A settlement cannot go from someone to themselves');
    }
    if (!Number.isInteger(s.amountMinor) || s.amountMinor <= 0) {
      add('error', t, 'Settlement amount must be a positive whole number');
    }
  }

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
