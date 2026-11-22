// Builds what the site publishes into public/: only the pages and their assets, plus the
// response headers (_headers). Docs, tools, tests, Workers and package files are never published.
//   node tools/build-site.js                    production
//   node tools/build-site.js --env staging      staging: its own API, no analytics, not indexed
//   node tools/build-site.js --out <dir>        build somewhere else (tests)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSET_DIRS = ['css', 'js', 'images', 'lib'];
const NEVER_PUBLISHED = /\.(md|map|test\.[cm]?js)$/i;
const API = {
  production: 'https://api.housetandem.com',
  staging: 'https://api-staging.housetandem.com',
};

/** Top-level folders that are pages: each short link, plus any folder with its own index.html. */
function pageDirs() {
  const skip = new Set([...ASSET_DIRS, 'docs', 'test', 'tools', 'workers', 'public', 'node_modules']);
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !skip.has(e.name))
    .map((e) => e.name)
    .filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')));
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else if (e.isFile() && !NEVER_PUBLISHED.test(e.name)) fs.copyFileSync(a, b);
  }
}

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** The sha256 source of every inline script, so the policy allows exactly those and no others. */
function inlineScriptHashes(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1]) || !m[2]) continue;
    // Browsers hash the script after turning CRLF into LF, so a Windows checkout must too.
    const text = m[2].replace(/\r\n?/g, '\n');
    hashes.push(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

function contentSecurityPolicy(hashes, api) {
  return [
    "default-src 'self'",
    `script-src 'self' https://e.housetandem.com ${hashes.join(' ')}`.trim(),
    `connect-src 'self' ${api} https://e.housetandem.com https://tandemonium.housetandem.com https://dice.housetandem.com https://coins.housetandem.com`,
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function headersFile(csp, env) {
  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
  ];
  if (env !== 'production') lines.push('  X-Robots-Tag: noindex, nofollow');
  return lines.join('\n') + '\n';
}

function build({ env = 'production', out = path.join(ROOT, 'public') } = {}) {
  if (!API[env]) throw new Error(`Unknown environment: ${env}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.html')) fs.copyFileSync(path.join(ROOT, e.name), path.join(out, e.name));
  }
  for (const d of ASSET_DIRS) copyTree(path.join(ROOT, d), path.join(out, d));
  for (const d of pageDirs()) copyTree(path.join(ROOT, d), path.join(out, d));

  if (env !== 'production') {
    // Not the real API, and nothing reaches the real analytics project.
    fs.appendFileSync(path.join(out, 'js', 'ht-config.js'),
      `\nwindow.HT_ANALYTICS.key = '';\nwindow.HT_API = ${JSON.stringify(API[env])};\n`);
  }

  const hashes = new Set();
  for (const f of htmlFiles(out)) for (const h of inlineScriptHashes(fs.readFileSync(f, 'utf8'))) hashes.add(h);
  const csp = contentSecurityPolicy([...hashes].sort(), API[env]);
  fs.writeFileSync(path.join(out, '_headers'), headersFile(csp, env));
  return { out, csp, pages: htmlFiles(out).length };
}

if (require.main === module) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const r = build({ env: arg('--env') || 'production', out: arg('--out') ? path.resolve(arg('--out')) : undefined });
  console.log(`Built ${r.pages} pages into ${path.relative(ROOT, r.out) || r.out}`);
}

module.exports = { build, inlineScriptHashes };
