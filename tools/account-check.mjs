#!/usr/bin/env node
// ============================================================
// account-check.mjs — the account page in a real browser, signed in, against fixtures
// ============================================================
//
//   node tools/account-check.mjs [screenshot dir]
//
// Serves this folder, answers the API and the games' achievement lists from fixtures
// (nothing leaves the machine), opens account.html signed in, and checks what a player
// sees. Puppeteer is not a dependency of this site: it is borrowed from a sibling
// Tandemonium checkout ($TANDEMONIUM_DIR, else ../tandemonium), or `npm i --no-save puppeteer`.
// Tandemonium's list is read from that checkout's achievements.json.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = process.env.TANDEMONIUM_DIR || path.join(ROOT, '..', 'tandemonium');
const shots = process.argv[2] || null;

function resolvePuppeteer() {
  for (const base of [ROOT, GAME]) {
    try { return createRequire(path.join(base, 'package.json'))('puppeteer'); } catch { /* next */ }
  }
  throw new Error('puppeteer not found: npm i --no-save puppeteer, or set TANDEMONIUM_DIR to a checkout that has it');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// A session token only this page reads (the API is a fixture): not signed.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'none' })}.${b64({ sub: 1, lid: 1, name: 'Test Goose', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const user = { id: 1, name: 'Test Goose', avatar: null, identities: { discord: { name: 'Test Goose', avatar: null }, steam: { name: 'Goose on Steam', avatar: null } } };

const tandDefs = JSON.parse(fs.readFileSync(path.join(GAME, 'achievements.json'), 'utf8'));
const hidden = tandDefs.achievements.filter((a) => a.hidden);
const shown = tandDefs.achievements.filter((a) => !a.hidden);
const FIX = {
  me: { user: { ...user, display_name: user.name, avatar_url: null }, achievements: [], bestScores: [{ level_id: 'grandma', best_time: 83000, max_distance: 250, rides: 12 }] },
  games: { games: {
    tandemonium: {
      // Two plain ones, one hidden one, and one held under an id the game has since renamed.
      earned: [
        { id: shown[0].id, earnedAt: '2026-11-01 10:00:00' }, { id: shown[1].id, earnedAt: '2026-11-02 10:00:00' },
        { id: hidden[0].id, earnedAt: '2026-11-03 10:00:00' }, { id: Object.keys(tandDefs.renamed)[0], earnedAt: '2026-11-04 10:00:00' },
      ],
      stats: { rides: 12, cumulativeDistance: 3400, days: 3 }, playtime: { seconds: 5400, sessions: 4, lastPlayed: '2026-11-16 20:00:00' }, steamPlayed: true,
    },
    dice: { earned: [{ id: 'first_roll', earnedAt: '2026-11-05 10:00:00' }], stats: { rolls: 40, wins: 6 }, playtime: { seconds: 600, sessions: 2, lastPlayed: '2026-11-10 20:00:00' } },
  } },
  dice: { achievements: [{ id: 'first_roll', name: 'First Roll', description: 'Roll the dice', icon: '🎲', group: 'basics' }, { id: 'snake_eyes', name: 'Snake Eyes', description: 'Roll two ones', icon: '🐍', group: 'basics' }] },
};

const puppeteer = resolvePuppeteer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const failures = [];
const ok = (cond, what) => { console.log((cond ? '  ok  ' : '  FAIL ') + what); if (!cond) failures.push(what); };

async function run(label, viewport, { tandemoniumList = true } = {}) {
  console.log(label);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin === origin) return req.continue();
    const json = (body, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (u.hostname === 'api.housetandem.com') {
      if (u.pathname === '/me') return json(FIX.me);
      if (u.pathname === '/me/games') return json(FIX.games);
      if (u.pathname === '/me/notices') return json({ notices: [] });
      if (u.pathname === '/me/discord') return json({ member: true });
      return json({});
    }
    if (u.hostname === 'tandemonium.housetandem.com' && u.pathname === '/achievements.json') return tandemoniumList ? json(tandDefs) : json({}, 404);
    if (u.hostname === 'dice.housetandem.com') return json(FIX.dice);
    return req.abort();   // analytics, fonts, the other games: not this check
  });
  await page.evaluateOnNewDocument((t, u) => { localStorage.setItem('ht_auth_token', t); localStorage.setItem('ht_auth_user', JSON.stringify(u)); }, token, user);
  await page.goto(origin + '/account.html', { waitUntil: 'networkidle0' });

  const card = await page.evaluate(() => {
    const b = document.getElementById('tandemonium-ach-open');
    return { count: document.getElementById('stat-ach').textContent, disabled: b.disabled, isStatic: b.classList.contains('account-ach-static'),
      see: !document.getElementById('tandemonium-ach-see').hidden, dice: document.getElementById('dice-ach') && document.getElementById('dice-ach').textContent };
  });
  if (!tandemoniumList) {
    ok(card.disabled && card.isStatic && !card.see, 'no list: the count stays a plain tile');
    ok(/^\d+\/100$/.test(card.count), `no list: the count still shows (${card.count})`);
  } else {
    ok(card.count === '4/100', `Tandemonium count is 4/100, the renamed badge included (${card.count})`);
    ok(!card.disabled && !card.isStatic && card.see, 'the count is a button that says See all');
    ok(card.dice === '1/2', `the other games still work (${card.dice})`);
    if (shots) await page.screenshot({ path: path.join(shots, `account-${label}.png`), fullPage: true });
    await page.click('#tandemonium-ach-open');
    await page.waitForFunction(() => document.querySelectorAll('#tandemonium-ach-sheet .uag-item').length > 0, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 500));
    const sheet = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#tandemonium-ach-sheet .uag-item')];
      const text = document.getElementById('tandemonium-ach-sheet').textContent;
      return { n: items.length, text, mysteries: (text.match(/\?\?\?/g) || []).length };
    });
    ok(sheet.n === 100, `the sheet lists all 100 (${sheet.n})`);
    ok(sheet.text.includes('First rides') && sheet.text.includes("Grandma's in every colour"), 'sections carry the game\'s titles');
    ok(sheet.text.includes(hidden[0].name), 'a hidden one the player earned shows its name');
    ok(hidden.slice(1).every((h) => !sheet.text.includes(h.name)) && sheet.mysteries >= hidden.length - 1, `hidden ones not earned show as ??? (${sheet.mysteries})`);
    if (shots) await page.screenshot({ path: path.join(shots, `sheet-${label}.png`) });
    await page.evaluate((id) => document.getElementById('tandemonium-ach-sheet').showDetail(id), shown[0].id);
    await new Promise((r) => setTimeout(r, 900));
    const detail = await page.evaluate(() => document.getElementById('tandemonium-ach-sheet').textContent);
    ok(detail.includes(shown[0].description), 'a badge opens its card, with the description');
    if (shots) await page.screenshot({ path: path.join(shots, `detail-${label}.png`) });
  }
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();
}

try {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  await run('desktop', { width: 1280, height: 900 });
  await run('phone', { width: 390, height: 844, isMobile: true, hasTouch: true });
  await run('no-list', { width: 1280, height: 900 }, { tandemoniumList: false });
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `${failures.length} failed` : 'all passed');
process.exit(failures.length ? 1 : 0);
