// Vite plugin: after a build, move files in dist/assets that this build did not
// produce (older hashed bundles, since emptyOutDir stays false) into the
// workspace archive instead of deleting them. Files copied from public/assets
// are kept. Runs only when dist is inside this project.
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = resolve(APP, '..');
const ARCHIVE = resolve(PROJECT, '..', '..', '归档', 'openmaus-assistant', 'app-builds');

export function archiveStaleAssets() {
  let outDir, produced = new Set();
  return {
    name: 'archive-stale-assets',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle(_options, bundle) { produced = new Set(Object.keys(bundle).map(file => file.replaceAll('\\', '/'))); },
    closeBundle() {
      const assets = join(outDir, 'assets');
      const inside = !relative(PROJECT, outDir).startsWith('..');
      if (!inside || !existsSync(assets) || !produced.size) return;
      const fromPublic = new Set(existsSync(join(APP, 'public', 'assets')) ? readdirSync(join(APP, 'public', 'assets')) : []);
      const stale = readdirSync(assets).filter(name => !produced.has('assets/' + name) && !fromPublic.has(name));
      if (!stale.length) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = join(ARCHIVE, 'stale-assets-' + stamp);
      mkdirSync(target, { recursive: true });
      for (const name of stale) renameSync(join(assets, name), join(target, name));
      console.log(`archive-stale-assets: moved ${stale.length} old file(s) to ${relative(PROJECT, target)}`);
    },
  };
}
