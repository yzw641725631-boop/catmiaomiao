import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { CompanionRuntime, PROJECT, SETTINGS_FILE } from '../adapters/runtime.mjs';
import { createCompanionServer } from '../adapters/server.mjs';

const rootDir = resolve(process.argv[2] || '');
assert(rootDir.startsWith(resolve(PROJECT, 'runtime') + sep + 'isolated-team-')||rootDir.startsWith(resolve(PROJECT,'runtime')+sep+'isolated-native-'));
assert(existsSync(join(rootDir, 'live-harness')));
const runtime = new CompanionRuntime({ rootDir });
runtime.settingsFile = SETTINGS_FILE;
let app;
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  app = await createCompanionServer({ port: 5240, runtime });
  console.log(JSON.stringify({ url: app.url, helpers: (await runtime.info()).helperIds.length, isolated: true }));
  console.log('UI_READY; enter quit to close this isolated preview');
  await new Promise(resolve => { input.on('line', line => { if (line.trim() === 'quit') resolve(); }); input.on('close', resolve); });
} finally { input.close(); if (app) await app.close(); }
