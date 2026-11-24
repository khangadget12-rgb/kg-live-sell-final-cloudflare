import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('node_modules');
let found = 0;
let changed = 0;

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const child = path.join(directory, entry.name);

    if (entry.name === 'iconv-lite') {
      const manifestPath = path.join(child, 'package.json');
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        found += 1;
        if (manifest.browser && typeof manifest.browser === 'object') {
          // iconv-lite maps its Node-only stream helpers to `false` for browser
          // bundles. Wrangler's Node compatibility runtime exposes process.versions.node,
          // so that browser mapping can make iconv-lite choose a missing stream module
          // and crash at Worker startup. The backend uses Node APIs, not browser aliases.
          delete manifest.browser;
          await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
          changed += 1;
          console.log(`[cloudflare-build] Removed iconv-lite browser mapping (${manifest.version ?? 'unknown version'}).`);
        }
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error;
      }
    }

    await walk(child);
  }
}

await walk(root);
if (found === 0) {
  throw new Error('Cloudflare preparation failed: no installed iconv-lite package was found.');
}
console.log(`[cloudflare-build] Checked ${found} iconv-lite package(s); adjusted ${changed}.`);
