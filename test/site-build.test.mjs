// What the site publishes: pages and assets only, every local link resolves, and the policy
// allows exactly the inline scripts the pages contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build, inlineScriptHashes } = require('../tools/build-site.js');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ht-site-'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('only pages and their assets are published', () => {
  const out = temp();
  build({ out });
  for (const name of ['docs', 'tools', 'test', 'workers', 'package.json', 'README.md', 'CNAME', 'wrangler.jsonc', '.nojekyll', '.github']) {
    assert.equal(fs.existsSync(path.join(out, name)), false, name);
  }
  for (const name of ['index.html', 'account.html', 'privacy.html', 'tos.html', 'js/ht-account.js', 'lib/identity/client.js', 'tt/index.html', 'tandemonium/index.html', '_headers']) {
    assert.equal(fs.existsSync(path.join(out, name)), true, name);
  }
  assert.equal(walk(out).filter((f) => f.endsWith('.md')).length, 0);
});

test('every local script, style and image a page names is published', () => {
  const out = temp();
  build({ out });
  const missing = [];
  for (const f of walk(out).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<(?:script|img|link)\b[^>]*?\b(?:src|href)="([^"#?]+)/gi)) {
      const ref = m[1];
      if (/^(https?:|data:|\/\/)/.test(ref)) continue;
      const target = ref.startsWith('/') ? path.join(out, ref) : path.resolve(path.dirname(f), ref);
      if (!fs.existsSync(target)) missing.push(path.relative(out, f) + ' -> ' + ref);
    }
  }
  assert.deepEqual(missing, []);
});

test('the policy allows each inline script and blocks framing', () => {
  const out = temp();
  const { csp } = build({ out });
  for (const f of walk(out).filter((x) => x.endsWith('.html'))) {
    for (const h of inlineScriptHashes(fs.readFileSync(f, 'utf8'))) assert.ok(csp.includes(h), f);
  }
  const script = csp.split('; ').find((d) => d.startsWith('script-src'));
  assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'));
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
});

test('staging has its own API, no analytics, and is not indexed', () => {
  const out = temp();
  const { csp } = build({ env: 'staging', out });
  const config = fs.readFileSync(path.join(out, 'js', 'ht-config.js'), 'utf8');
  assert.ok(config.includes("window.HT_ANALYTICS.key = ''"));
  assert.ok(config.includes('tandemonium-api-staging'));
  assert.ok(!csp.includes('api.housetandem.com'));
  assert.ok(fs.readFileSync(path.join(out, '_headers'), 'utf8').includes('X-Robots-Tag: noindex'));

  const prod = temp();
  build({ out: prod });
  assert.ok(!fs.readFileSync(path.join(prod, '_headers'), 'utf8').includes('X-Robots-Tag'));
  assert.ok(!fs.readFileSync(path.join(prod, 'js', 'ht-config.js'), 'utf8').includes('HT_API'));
});
