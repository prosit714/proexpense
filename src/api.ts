import type { Balances, ExpenseEvent, Issue } from './domain/index.js';

export interface EventSummary {
  id: string;
  name: string;
  status: 'open' | 'closed';
  homeCurrency: string;
  homeDigits: number;
  lineCount: number;
  memberCount: number;
  totalSpentMinor: number;
  isBalanced: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventPayload {
  event: ExpenseEvent;
  balances: Balances;
  issues: Issue[];
  canClose: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Someone else (your other device) saved over this. */
  get isConflict() {
    return this.status === 409;
  }
  get isUnauthorised() {
    return this.status === 401;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.error === 'string' ? body.error : 'Something went wrong',
      body,
    );
  }
  return body as T;
}

export const api = {
  session: () => call<{ signedIn: boolean; mustChangePin?: boolean }>('/auth/session'),

  login: (pin: string) =>
    call<{ mustChangePin: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  changePin: (currentPin: string, newPin: string) =>
    call<{ changed: boolean }>('/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPin }),
    }),

  logout: () => call<{ signedOut: boolean }>('/auth/logout', { method: 'POST' }),

  listEvents: () => call<{ events: EventSummary[] }>('/events'),

  createEvent: (name: string, homeCurrency: string) =>
    call<{ event: ExpenseEvent }>('/events', {
      method: 'POST',
      body: JSON.stringify({ name, homeCurrency }),
    }),

  getEvent: (id: string) => call<EventPayload>(`/events/${id}`),

  saveEvent: (event: ExpenseEvent) =>
    call<EventPayload>(`/events/${event.id}`, {
      method: 'PUT',
      body: JSON.stringify({ event, etag: event._etag }),
    }),

  deleteEvent: (id: string) => call<{ deleted: boolean }>(`/events/${id}`, { method: 'DELETE' }),
};
