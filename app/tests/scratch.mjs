// Per-run scratch folders for tests. They live in the OS temp folder, not in
// evidence/, and are removed when the test process exits (set
// COMPANION_TEST_KEEP=1 to keep them for inspection). Keep evidence you want to
// cite by copying it into a dated evidence/<topic>-<date>/ folder on purpose.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = [];
let hooked = false;

export function scratch(label) {
  const dir = mkdtempSync(join(tmpdir(), `oa-${label}-`));
  created.push(dir);
  if (!hooked && process.env.COMPANION_TEST_KEEP !== '1') {
    hooked = true;
    process.once('exit', () => {
      for (const path of created) {
        try { rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
      }
    });
  }
  return dir;
}
