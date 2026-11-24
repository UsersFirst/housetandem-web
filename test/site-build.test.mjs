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
  const connect = csp.split('; ').find((d) => d.startsWith('connect-src'));
  for (const h of ['tandemonium', 'dice', 'coins']) assert.ok(connect.includes('https://' + h + '.housetandem.com'), h + ' achievements');
});

test('Cloudflare Web Analytics: its two hosts on production pages only, never on the account page or on staging', () => {
  const prod = build({ out: temp() });
  const dir = (csp, name) => csp.split('; ').find((d) => d.startsWith(name));
  assert.ok(dir(prod.csp, 'script-src').includes('https://static.cloudflareinsights.com'));
  assert.ok(dir(prod.csp, 'connect-src').split(' ').includes('https://cloudflareinsights.com'));
  assert.ok(!prod.accountCsp.includes('cloudflareinsights'));
  const headers = fs.readFileSync(path.join(prod.out, '_headers'), 'utf8');
  const account = headers.split('/account*')[1];
  assert.ok(account && account.includes('Content-Security-Policy: default-src') && !account.includes('cloudflareinsights'));
  assert.ok(account.includes("frame-ancestors 'none'"), 'a whole policy, so it stands alone if it replaces the first');
  const staging = build({ env: 'staging', out: temp() });
  assert.ok(!staging.csp.includes('cloudflareinsights'));
  assert.ok(!fs.readFileSync(path.join(staging.out, '_headers'), 'utf8').includes('/account*'));
});

test('sign-in values leave the address before analytics, and the account page loads none', () => {
  const out = temp();
  build({ out });
  for (const f of walk(out).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    const analytics = html.indexOf('ht-analytics.js');
    if (analytics < 0) continue;
    const strip = html.indexOf('window.__htBack');
    assert.ok(strip >= 0 && strip < analytics, path.relative(out, f));
    assert.ok(strip < html.indexOf('</head>'), path.relative(out, f));
  }
  const account = fs.readFileSync(path.join(out, 'account.html'), 'utf8');
  assert.ok(!account.includes('ht-analytics.js'));
  assert.ok(account.includes('window.__htBack'));
});

test('/join, where the bio links land, counts visits and has no sign-in code', () => {
  const out = temp();
  build({ out });
  const join = fs.readFileSync(path.join(out, 'join.html'), 'utf8');
  assert.ok(join.includes('js/ht-analytics.js'));
  assert.ok(!/src="[^"]*(ht-account|account-page|lib\/identity)/.test(join));
  assert.match(join, /href="\/discord"[^>]*data-ht="discord:join"/);
  assert.match(join, /href="https:\/\/store\.steampowered\.com\/app\/4482940\/"[^>]*data-ht="playtest:join"/);
});

function runStrip(href) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = html.match(/<script>(\(function\(\)\{try\{var l=location[\s\S]*?)<\/script>/)[1];
  const u = new URL(href);
  const win = {};
  let replaced = null;
  new Function('location', 'history', 'window', code)(
    { pathname: u.pathname, search: u.search, hash: u.hash },
    { replaceState(_s, _t, url) { replaced = url; } },
    win,
  );
  return { replaced, back: win.__htBack };
}

test('the head script takes ht_ values off the address and keeps everything else', () => {
  const a = runStrip('https://housetandem.com/account.html?utm_source=x&ht_code=a.b#ht_result=id.code&keep=1');
  assert.equal(a.replaced, '/account.html?utm_source=x#keep=1');
  assert.equal(a.back.hash, '#ht_result=id.code&keep=1');
  const b = runStrip('https://housetandem.com/?ht_code=a.b#section');
  assert.equal(b.replaced, '/#section');
  assert.equal(b.back, undefined);
  assert.equal(runStrip('https://housetandem.com/about.html?x=1#games').replaced, null);
});

test('analytics events carry no ht_ values in their addresses', () => {
  const code = fs.readFileSync(new URL('../js/ht-analytics.js', import.meta.url), 'utf8');
  const noop = () => {};
  const win = { HT_ANALYTICS: { key: 'k' }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop } };
  const doc = { readyState: 'complete', querySelectorAll: () => [], addEventListener: noop, createElement: () => ({}), head: { appendChild: noop } };
  new Function('window', 'document', 'location', 'navigator', code)(win, doc, { search: '', origin: 'https://housetandem.com' }, {});
  const out = win.HT.cleanEvent({
    properties: { $current_url: 'https://housetandem.com/a?x=1&ht_code=s3cret#ht_auth=t0ken', $referrer: 'https://housetandem.com/', other: 'ht_kept' },
    $set: { $initial_current_url: 'https://housetandem.com/?ht_code=s3cret' },
  });
  assert.ok(!JSON.stringify(out).includes('s3cret') && !JSON.stringify(out).includes('t0ken'));
  assert.equal(out.properties.$current_url, 'https://housetandem.com/a?x=1');
  assert.equal(out.properties.other, 'ht_kept');
});

test('staging has its own API, no analytics, and is not indexed', () => {
  const out = temp();
  const { csp } = build({ env: 'staging', out });
  const config = fs.readFileSync(path.join(out, 'js', 'ht-config.js'), 'utf8');
  assert.ok(config.includes("window.HT_ANALYTICS.key = ''"));
  assert.ok(config.includes('https://api-staging.housetandem.com'));
  assert.ok(!csp.includes('https://api.housetandem.com'));
  assert.ok(fs.readFileSync(path.join(out, '_headers'), 'utf8').includes('X-Robots-Tag: noindex'));

  const prod = temp();
  build({ out: prod });
  assert.ok(!fs.readFileSync(path.join(prod, '_headers'), 'utf8').includes('X-Robots-Tag'));
  assert.ok(!fs.readFileSync(path.join(prod, 'js', 'ht-config.js'), 'utf8').includes('HT_API'));
});
