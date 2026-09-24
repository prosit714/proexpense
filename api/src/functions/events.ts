import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  createEvent,
  deleteEvent,
  listEvents,
  readEvent,
  replaceEvent,
} from '../lib/cosmos.js';
import { json, loadConfig, problem, readJson } from '../lib/http.js';
import { authenticate } from '../lib/session.js';
import {
  canClose,
  computeBalances,
  hasErrors,
  validateEvent,
  type ExpenseEvent,
} from '../domain/index.js';

function summarise(event: ExpenseEvent) {
  const balances = computeBalances(event);
  return {
    id: event.id,
    name: event.name,
    status: event.status,
    homeCurrency: event.homeCurrency,
    homeDigits: balances.homeDigits,
    lineCount: event.lines.length,
    memberCount: event.members.length,
    totalSpentMinor: balances.totalSpentMinor,
    isBalanced: balances.isBalanced,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** Strip anything a client should not be able to set. */
function sanitise(input: ExpenseEvent, id: string, createdAt?: string): ExpenseEvent {
  return {
    ...input,
    id,
    createdAt: createdAt ?? input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _etag: undefined,
  };
}

app.http('eventsCollection', {
  route: 'events',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    if (!(await authenticate(request, config))) return problem(401, 'Sign in first');

    if (request.method === 'GET') {
      const all = await listEvents(config.cosmosConnectionString);
      return json(200, { events: all.map(summarise) });
    }

    const body = await readJson<Partial<ExpenseEvent>>(request);
    if (!body?.name?.trim()) return problem(400, 'Give the event a name');

    const now = new Date().toISOString();
    const event: ExpenseEvent = {
      id: randomUUID(),
      name: body.name.trim(),
      status: 'open',
      homeCurrency: body.homeCurrency?.trim() || 'INR',
      rates: body.rates ?? {},
      currencyDigits: body.currencyDigits,
      families: body.families ?? [],
      members: body.members ?? [],
      categories: body.categories ?? [],
      lines: [],
      settlements: [],
      createdAt: now,
      updatedAt: now,
    };

    const created = await createEvent(config.cosmosConnectionString, event);
    return json(201, { event: created });
  },
});

app.http('eventItem', {
  route: 'events/{id}',
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    if (!(await authenticate(request, config))) return problem(401, 'Sign in first');

    const id = request.params.id;
    if (!id) return problem(400, 'Missing event id');

    if (request.method === 'GET') {
      const event = await readEvent(config.cosmosConnectionString, id);
      if (!event) return problem(404, 'No event with that id');
      return json(200, {
        event,
        balances: computeBalances(event),
        issues: validateEvent(event),
        canClose: canClose(event),
      });
    }

    if (request.method === 'DELETE') {
      await deleteEvent(config.cosmosConnectionString, id);
      return json(200, { deleted: true });
    }

    const body = await readJson<{ event?: ExpenseEvent; etag?: string }>(request);
    if (!body?.event) return problem(400, 'Send the whole event document');

    const existing = await readEvent(config.cosmosConnectionString, id);
    if (!existing) return problem(404, 'No event with that id');

    const next = sanitise(body.event, id, existing.createdAt);

    // The client validates too, but the client is the thing an attacker
    // controls, so the server is where it counts.
    const issues = validateEvent(next);
    if (hasErrors(issues)) {
      return problem(422, 'That event has problems that need fixing', { issues });
    }
    if (next.status === 'closed' && existing.status === 'open' && !canClose(next)) {
      return problem(422, 'An event can only be closed once every balance is settled');
    }

    try {
      const saved = await replaceEvent(
        config.cosmosConnectionString,
        next,
        body.etag ?? existing._etag,
      );
      return json(200, {
        event: saved,
        balances: computeBalances(saved),
        issues: validateEvent(saved),
        canClose: canClose(saved),
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return problem(409, error.message, { current: existing });
      }
      throw error;
    }
  },
});
