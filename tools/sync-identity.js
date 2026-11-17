#!/usr/bin/env node
// ============================================================
// sync-identity.js — vendor House Tandem sign-in (@usersfirst/identity) from the lab
// ============================================================
//
// lib/identity/ is a VENDORED copy of packages/identity/src in the
// tandemonium-controller-lab repo: the sign-in client js/ht-account.js is built on, its
// wording, and the account elements (uf-signin, uf-profile-card, uf-account-notice,
// uf-combine-accounts). Tandemonium vendors the same package into shared/identity/.
// Files are copied byte-for-byte and stamped with the lab version and commit in
// lib/identity/IDENTITY_VERSION.json. Check the lab out at the tag you want
// (identity-vX.Y.Z), then:
//
//   npm run sync-identity       # copy + stamp
//   npm run check:identity      # fail if lib/identity differs from the lab checkout
//
// Lab location: $CONTROLLER_LAB_DIR, else the sibling ../tandemonium-controller-lab.
// The whole of src/ is vendored (it is small, and index.js names every file).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LAB = process.env.CONTROLLER_LAB_DIR || path.join(ROOT, '..', 'tandemonium-controller-lab');
const PKG = path.join(LAB, 'packages', 'identity');
const SRC = path.join(PKG, 'src');
const DEST = path.join(ROOT, 'lib', 'identity');
const STAMP = 'IDENTITY_VERSION.json';

const norm = (b) => b.toString('utf8').replace(/\r\n/g, '\n');
const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const rel = prefix ? prefix + '/' + e.name : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), rel) : (e.name === STAMP ? [] : [rel]);
}).sort();

if (!fs.existsSync(SRC)) {
  console.error(`@usersfirst/identity source not found at ${SRC}. Set CONTROLLER_LAB_DIR or check out tandemonium-controller-lab next to this repo.`);
  process.exit(1);
}
const FILES = walk(SRC);

if (process.argv.includes('--check')) {
  const problems = FILES.filter((f) => {
    const dest = path.join(DEST, f);
    return !fs.existsSync(dest) || norm(fs.readFileSync(dest)) !== norm(fs.readFileSync(path.join(SRC, f)));
  }).map((f) => 'differs: ' + f);
  if (fs.existsSync(DEST)) for (const f of walk(DEST)) if (!FILES.includes(f)) problems.push('not in the lab: ' + f);
  if (problems.length) {
    console.error(`lib/identity differs from the lab:\n  ${problems.join('\n  ')}\n(run npm run sync-identity)`);
    process.exit(1);
  }
  console.log(`lib/identity matches the lab checkout (${FILES.length} files)`);
  process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(DEST, f)), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
const git = (cmd) => { try { return execSync(`git -C "${LAB}" ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return null; } };
const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(DEST, STAMP), JSON.stringify({
  package: '@usersfirst/identity',
  version,
  sourceCommit: git('rev-parse HEAD'),
  sourceRef: git('describe --tags --always'),
  syncedAt: new Date().toISOString().slice(0, 10),
}, null, 2) + '\n');
console.log(`Synced @usersfirst/identity@${version} → lib/identity/ (${FILES.length} files)`);
