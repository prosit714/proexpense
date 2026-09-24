#!/usr/bin/env node
/**
 * Copies shared/domain into src/domain (web) and api/src/domain (functions).
 *
 * Why not a workspace package or a path alias: Azure Static Web Apps builds the
 * api/ folder in its own isolated Oryx container, so anything imported from
 * outside api/ simply is not there at build time. Copying is boring, has no
 * moving parts, and fails loudly. Runs automatically from both prebuild steps.
 *
 * The copies are gitignored. shared/domain is the only place to edit.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'shared', 'domain');

const targets = [join(root, 'src', 'domain'), join(root, 'api', 'src', 'domain')];

const banner = `// GENERATED FILE — do not edit.
// Copied from shared/domain by scripts/sync-domain.mjs. Edit the original.
`;

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (src) => !src.endsWith('.test.ts'),
  });
  writeFileSync(join(target, 'GENERATED.md'), banner);
  console.log(`synced domain -> ${target.replace(root + '/', '')}`);
}
