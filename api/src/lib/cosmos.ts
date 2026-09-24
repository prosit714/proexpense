/**
 * Cosmos DB access.
 *
 * Two containers in one shared-throughput database, both partitioned by /id:
 *   events  — one document per ExpenseEvent
 *   system  — a single 'auth' document holding the PIN hash and lockout state
 *
 * Shared throughput keeps the whole database inside the 1000 RU/s free tier
 * allowance rather than reserving throughput per container.
 *
 * Authentication is a connection string rather than a managed identity, because
 * Static Web Apps' managed Functions do not support managed identity. The
 * string lives in SWA application settings, which are encrypted at rest.
 */

import { Container, CosmosClient, type ItemDefinition } from '@azure/cosmos';
import type { ExpenseEvent } from '../domain/index.js';
import type { PinHash } from './pin.js';

export const DATABASE_ID = 'proexpense';
export const EVENTS_CONTAINER = 'events';
export const SYSTEM_CONTAINER = 'system';
export const AUTH_DOC_ID = 'auth';

export interface AuthDoc extends ItemDefinition {
  id: typeof AUTH_DOC_ID;
  pin: PinHash;
  /** True until the default PIN has been replaced. */
  mustChangePin: boolean;
  failedAttempts: number;
  /** ISO timestamp; login is refused until this passes. */
  lockedUntil?: string;
  /** Bumped on every PIN change to invalidate existing sessions. */
  pinEpoch: number;
  updatedAt: string;
  _etag?: string;
}

let client: CosmosClient | undefined;

function getClient(connectionString: string): CosmosClient {
  if (!client) {
    client = new CosmosClient(connectionString);
  }
  return client;
}

export function events(connectionString: string): Container {
  return getClient(connectionString).database(DATABASE_ID).container(EVENTS_CONTAINER);
}

export function system(connectionString: string): Container {
  return getClient(connectionString).database(DATABASE_ID).container(SYSTEM_CONTAINER);
}

/** Thrown when a write loses an optimistic concurrency race. */
export class ConflictError extends Error {
  constructor(message = 'This event was changed somewhere else') {
    super(message);
    this.name = 'ConflictError';
  }
}

function isPreconditionFailed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 412;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 404;
}

export async function readEvent(
  connectionString: string,
  id: string,
): Promise<ExpenseEvent | null> {
  try {
    const { resource } = await events(connectionString).item(id, id).read<ExpenseEvent>();
    return resource ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listEvents(connectionString: string): Promise<ExpenseEvent[]> {
  const { resources } = await events(connectionString)
    .items.query<ExpenseEvent>({
      query: 'SELECT * FROM c ORDER BY c.createdAt DESC',
    })
    .fetchAll();
  return resources;
}

export async function createEvent(
  connectionString: string,
  event: ExpenseEvent,
): Promise<ExpenseEvent> {
  const { resource } = await events(connectionString).items.create<ExpenseEvent>(event);
  return resource as ExpenseEvent;
}

/**
 * Replace an event, refusing the write if it was modified since the client
 * loaded it. One user with a phone and a laptop is enough to lose data without
 * this.
 */
export async function replaceEvent(
  connectionString: string,
  event: ExpenseEvent,
  etag: string | undefined,
): Promise<ExpenseEvent> {
  try {
    const { resource } = await events(connectionString)
      .item(event.id, event.id)
      .replace<ExpenseEvent>(event, {
        accessCondition: etag ? { type: 'IfMatch', condition: etag } : undefined,
      });
    return resource as ExpenseEvent;
  } catch (error) {
    if (isPreconditionFailed(error)) throw new ConflictError();
    throw error;
  }
}

export async function deleteEvent(connectionString: string, id: string): Promise<void> {
  try {
    await events(connectionString).item(id, id).delete();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function readAuth(connectionString: string): Promise<AuthDoc | null> {
  try {
    const { resource } = await system(connectionString)
      .item(AUTH_DOC_ID, AUTH_DOC_ID)
      .read<AuthDoc>();
    return resource ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function writeAuth(connectionString: string, doc: AuthDoc): Promise<AuthDoc> {
  const { resource } = await system(connectionString).items.upsert<AuthDoc>({
    ...doc,
    updatedAt: new Date().toISOString(),
  });
  return resource as unknown as AuthDoc;
}
