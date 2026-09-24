/**
 * ProExpense domain types.
 *
 * One ExpenseEvent is one Cosmos DB document. Everything the app needs to
 * render, calculate and export an event lives inside it.
 *
 * Money is ALWAYS stored as an integer count of minor units (paise, cents).
 * There are no floating point amounts anywhere in this model.
 */

/** An integer count of minor units, e.g. 12345 === 123.45 in a 2-digit currency. */
export type MinorUnits = number;

export type Id = string;

/** ISO-8601 date, date-only portion: "2026-09-22". */
export type IsoDate = string;

export interface Family {
  id: Id;
  name: string;
}

export interface Member {
  id: Id;
  name: string;
  /** When set, this member settles as part of a family rather than individually. */
  familyId?: Id;
}

export interface Category {
  id: Id;
  name: string;
}

export type SplitMode =
  /** Divide equally between participantIds. The default. */
  | { mode: 'equal' }
  /** Weighted split, e.g. { m1: 2, m2: 1 } gives m1 two thirds. */
  | { mode: 'shares'; shares: Record<Id, number> }
  /** Caller supplies exact minor-unit amounts that must sum to the line total. */
  | { mode: 'exact'; amounts: Record<Id, MinorUnits> };

export interface ExpenseLine {
  id: Id;
  name: string;
  date: IsoDate;

  /** Amount in `currency`, in that currency's minor units. */
  amountMinor: MinorUnits;

  /** ISO-4217 code. Equal to event.homeCurrency for ordinary lines. */
  currency: string;

  /**
   * Units of home currency per 1 unit of `currency`, snapshotted when the line
   * was saved. 1 when currency === homeCurrency. Editing event.rates later does
   * NOT retroactively change this — the app re-applies rates explicitly.
   */
  rateToHome: number;

  payerId: Id;
  categoryId?: Id;

  /** Who this line is split between. Must be non-empty. */
  participantIds: Id[];

  split: SplitMode;

  notes?: string;
}

/** A real-world cash transfer that reduces someone's outstanding balance. */
export interface Settlement {
  id: Id;
  date: IsoDate;
  fromMemberId: Id;
  toMemberId: Id;
  /** Always in home currency minor units. */
  amountMinor: MinorUnits;
  note?: string;
}

export type EventStatus = 'open' | 'closed';

export interface ExpenseEvent {
  id: Id;
  name: string;
  status: EventStatus;

  /** ISO-4217 code, e.g. "INR". All balances are expressed in this. */
  homeCurrency: string;

  /**
   * Manually maintained exchange rates for this event, keyed by currency code.
   * Used to prefill ExpenseLine.rateToHome; never read during calculation.
   */
  rates: Record<string, number>;

  /**
   * Minor-unit digits per currency, for the handful that are not 2
   * (JPY: 0, KWD: 3). Anything absent defaults to 2.
   */
  currencyDigits?: Record<string, number>;

  families: Family[];
  members: Member[];
  categories: Category[];
  lines: ExpenseLine[];
  settlements: Settlement[];

  createdAt?: string;
  updatedAt?: string;

  /** Cosmos optimistic concurrency token. Never set by hand. */
  _etag?: string;
}
