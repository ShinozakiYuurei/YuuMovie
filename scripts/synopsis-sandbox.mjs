// Build a minimal tree so the Node synopsis scraper runs against a sandbox
// instead of the live data directory.
//
// scrapers/synopsis.js resolves its data directory from its own location, so
// pointing it at a sandbox means giving it its own copy of the files it reads plus
// the modules it imports.
import fs from 'node:fs';
import path from 'node:path';

const lab = 'C:/Users/Yuurei/hkmovie-lab';
const root = path.join(lab, 'tmp/syn-node-sandbox');

fs.mkdirSync(path.join(root, 'scrapers'), { recursive: true });
fs.mkdirSync(path.join(root, 'lib'), { recursive: true });

for (const name of ['synopsis.js']) {
  fs.copyFileSync(path.join(lab, 'scrapers', name), path.join(root, 'scrapers', name));
}
for (const name of ['synopsis-key.js', 'enrich-key.js']) {
  fs.copyFileSync(path.join(lab, 'lib', name), path.join(root, 'lib', name));
}
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
// Both runs start from an empty cache so they look up the same films.
fs.writeFileSync(
  path.join(root, 'data/synopsis.json'),
  JSON.stringify({ updatedAt: null, entries: {} }),
);

console.log('sandbox at ' + root);