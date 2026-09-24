import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';
import { timingSafeEqual } from 'node:crypto';

import { listEvents } from '../lib/cosmos.js';
import { json, loadConfig, problem } from '../lib/http.js';

/**
 * Snapshot every event to Blob Storage as one JSON file.
 *
 * This is an HTTP endpoint rather than a timer trigger because Static Web Apps'
 * managed Functions only support HTTP triggers. A scheduled GitHub Action calls
 * it weekly with the shared secret — see .github/workflows/backup.yml. Moving
 * to a real timer trigger means a separate Function App, which means leaving
 * the free tier, and a cron in CI does the same job for nothing.
 */

function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.http('backup', {
  route: 'backup',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const config = loadConfig();
    if (!secretMatches(request.headers.get('x-backup-secret'), config.backupSecret)) {
      return problem(401, 'Not authorised');
    }

    const storageConnection = process.env.BACKUP_STORAGE_CONNECTION_STRING;
    if (!storageConnection) return problem(500, 'BACKUP_STORAGE_CONNECTION_STRING is not set');

    const all = await listEvents(config.cosmosConnectionString);
    const payload = JSON.stringify(
      { takenAt: new Date().toISOString(), eventCount: all.length, events: all },
      null,
      2,
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const container = BlobServiceClient.fromConnectionString(storageConnection)
      .getContainerClient('backups');
    await container.createIfNotExists();
    await container
      .getBlockBlobClient(`proexpense-${stamp}.json`)
      .upload(payload, Buffer.byteLength(payload), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });

    return json(200, { backedUp: all.length, blob: `proexpense-${stamp}.json` });
  },
});
