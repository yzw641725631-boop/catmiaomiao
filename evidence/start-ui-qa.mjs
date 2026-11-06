import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCompanionServer } from '../adapters/server.mjs';
import { CompanionRuntime, PROJECT } from '../adapters/runtime.mjs';
import { fakeReachai } from '../app/tests/fixtures/reachai.mjs';

const provider = await fakeReachai();
const rootDir = join(PROJECT, 'evidence', 'ui-reachai-' + randomUUID());
const app = await createCompanionServer({ port: 5231, runtime: new CompanionRuntime({ rootDir, forceFixture: true }) });
console.log(JSON.stringify({ url: app.url, providerUrl: provider.url, scope: 'synthetic local UI verification only', rootDir }));
let stopping = false;
const close = async () => { if (stopping) return; stopping = true; await app.close(); await provider.close(); process.exit(0); };
process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { if (value.trim() === 'quit') void close(); });
process.once('SIGINT', close); process.once('SIGTERM', close);
