/**
 * HTTP plumbing shared by every function: JSON responses, the session cookie,
 * and typed access to app settings.
 */

import type { HttpRequest, HttpResponseInit } from '@azure/functions';

export const SESSION_COOKIE = 'pe_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface Config {
  cosmosConnectionString: string;
  sessionSecret: string;
  backupSecret: string;
  /** Set to 'false' only when running the local emulator over plain http. */
  secureCookies: boolean;
}

export function loadConfig(): Config {
  const cosmosConnectionString = process.env.COSMOS_CONNECTION_STRING;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!cosmosConnectionString) {
    throw new Error('COSMOS_CONNECTION_STRING is not set');
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  }
  return {
    cosmosConnectionString,
    sessionSecret,
    backupSecret: process.env.BACKUP_SECRET ?? '',
    secureCookies: process.env.SECURE_COOKIES !== 'false',
  };
}

export function json(status: number, body: unknown, extra: HttpResponseInit = {}): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    ...extra,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extra.headers as Record<string, string> | undefined),
    },
  };
}

export function problem(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json(status, { error: message, ...extra });
}

export function sessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedCookie(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function readCookie(request: HttpRequest, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

export async function readJson<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
