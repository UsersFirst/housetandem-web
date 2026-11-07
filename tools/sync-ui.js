#!/usr/bin/env node
// ============================================================
// sync-ui.js — vendor the House Tandem UI kit (@usersfirst/ui) from the lab
// ============================================================
//
// lib/ui/ is a VENDORED copy of the elements this site uses from
// packages/ui/src in the tandemonium-controller-lab repo (the same kit
// Tandemonium vendors into shared/ui/ with its own sync-ui.js). Files are
// copied byte-for-byte and stamped with the lab version and commit in
// lib/ui/UI_VERSION.json. Check the lab out at the tag you want (ui-vX.Y.Z),
// then:
//
//   npm run sync-ui          # copy + stamp
//   npm run check:ui         # fail if lib/ui differs from the lab checkout
//
// Lab location: $CONTROLLER_LAB_DIR, else the sibling ../tandemonium-controller-lab.
// Only the files below are vendored: add one here when a page needs another element.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LAB = process.env.CONTROLLER_LAB_DIR || path.join(ROOT, '..', 'tandemonium-controller-lab');
const SRC = path.join(LAB, 'packages', 'ui', 'src');
const DEST = path.join(ROOT, 'lib', 'ui');
const STAMP = 'UI_VERSION.json';

const FILES = [
  'tokens.css',
  'uf-element.js',
  'elements/uf-sheet.js',
  'elements/uf-controller-glyph.js',
  'elements/uf-achievement-grid.js',
  'elements/uf-achievement-detail.js',
  'elements/uf-achievement-sheet.js',
];

const norm = (b) => b.toString('utf8').replace(/\r\n/g, '\n');

if (!fs.existsSync(SRC)) {
  console.error(`@usersfirst/ui source not found at ${SRC}. Set CONTROLLER_LAB_DIR or check out tandemonium-controller-lab next to this repo.`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const drift = FILES.filter((f) => {
    const dest = path.join(DEST, f);
    return !fs.existsSync(dest) || norm(fs.readFileSync(dest)) !== norm(fs.readFileSync(path.join(SRC, f)));
  });
  if (drift.length) {
    console.error(`lib/ui differs from the lab: ${drift.join(', ')} (run npm run sync-ui)`);
    process.exit(1);
  }
  console.log('lib/ui matches the lab checkout');
  process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(DEST, f)), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
const git = (cmd) => { try { return execSync(`git -C "${LAB}" ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return null; } };
const version = JSON.parse(fs.readFileSync(path.join(LAB, 'packages', 'ui', 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(DEST, STAMP), JSON.stringify({
  package: '@usersfirst/ui',
  version,
  sourceCommit: git('rev-parse HEAD'),
  sourceRef: git('describe --tags --always'),
  files: FILES,
  syncedAt: new Date().toISOString().slice(0, 10),
}, null, 2) + '\n');
console.log(`Synced @usersfirst/ui@${version} → lib/ui/ (${FILES.length} files)`);
