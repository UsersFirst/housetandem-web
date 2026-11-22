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

const notice = { id: 5, kind: 'link', provider: 'steam', login_name: 'Goose on Steam', from_name: null,
  created_at: Math.floor(Date.now() / 1000) - 3600, undo_until: Math.floor(Date.now() / 1000) + 6 * 86400, seen: false };
const combineAnswer = { status: 'combine', provider: 'steam',
  into: { name: 'Test Goose', avatar: null, logins: [{ provider: 'discord' }], rides: 12, badges: 4 },
  other: { name: 'Old Steam Goose', avatar: null, logins: [{ provider: 'steam' }], rides: 40, badges: 9, games: [{ game: 'dice', title: '7, 11, Doubles', badges: 1 }] } };

/** A page with the fixtures answering, and a log of the API calls it made. */
async function open(viewport, { signedIn = true, discordOnly = false, hash = '', pendingLink = false, pendingSignIn = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const who = discordOnly ? { ...user, identities: { discord: user.identities.discord } } : user;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin === origin) return req.continue();
    const json = (body, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (u.hostname === 'api.housetandem.com') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* none */ }
      calls.push({ path: u.pathname, body, authed: !!req.headers().authorization });
      if (u.pathname === '/me') return json({ ...FIX.me, user: { ...who, display_name: who.name, avatar_url: null } });
      if (u.pathname === '/me/games') return json(FIX.games);
      if (u.pathname === '/me/notices') return json({ notices: discordOnly ? [] : [notice] });
      if (u.pathname === '/me/notices/seen') return json({ ok: true });
      if (u.pathname === '/me/discord') return json({ linked: true, member: true });
      if (u.pathname === '/auth/discord/begin') return json({ id: 'req9', secret: 's9', url: 'https://api.housetandem.com/auth/discord/go?r=req9', authorize_url: 'https://discord.com/oauth2/authorize?client_id=1&state=req9', expires_in: 600 });
      if (u.pathname === '/auth/exchange') return body.nonce === 'tab-value' ? json({ token, user: who, server: 'added' }) : json({ code: 'signin_mismatch', error: 'gone' }, 403);
      if (u.pathname === '/auth/link/complete') return json(body.secret === 'tab-secret' ? combineAnswer : { error: 'gone' }, body.secret === 'tab-secret' ? 200 : 410);
      if (u.pathname === '/auth/link/combine') return json({ status: body.ok ? 'combined' : 'cancelled' });
      return json({});
    }
    if (u.hostname === 'tandemonium.housetandem.com' && u.pathname === '/achievements.json') return json(tandDefs);
    if (u.hostname === 'dice.housetandem.com') return json(FIX.dice);
    return req.abort();   // analytics, fonts, the other games: not this check
  });
  if (pendingSignIn) {
    await page.evaluateOnNewDocument(() => sessionStorage.setItem('ht_signin_pending', JSON.stringify({ req9: { n: 'tab-value', at: Date.now() } })));
  }
  await page.evaluateOnNewDocument((t, u, pending) => {
    // Every page here shares one browser profile: start each from a known state.
    if (t) { localStorage.setItem('ht_auth_token', t); localStorage.setItem('ht_auth_user', JSON.stringify(u)); }
    else if (!sessionStorage.getItem('check_started')) { localStorage.removeItem('ht_auth_token'); localStorage.removeItem('ht_auth_user'); }
    sessionStorage.setItem('check_started', '1');
    if (pending) sessionStorage.setItem('ht_link_pending', JSON.stringify({ id: 'req1', secret: 'tab-secret', at: Date.now() }));
  }, signedIn ? token : null, who, pendingLink);
  await page.goto(origin + '/account.html' + hash, { waitUntil: 'networkidle0' });
  return { page, errors, calls };
}

/** Sign-in, the logins, a notice, and the combine question: the shared account elements on this page. */
async function runAccount() {
  console.log('account');
  const clean = (o) => ok(o.errors.length === 0, 'no page errors' + (o.errors.length ? ': ' + o.errors.join(' | ') : ''));

  // Signed out: the Join card, and the Discord button becomes Discord's own link.
  let o = await open({ width: 1280, height: 900 }, { signedIn: false });
  let v = await o.page.evaluate(() => ({ join: !document.getElementById('account-signin').hidden, profile: !document.getElementById('account-profile').hidden,
    href: document.getElementById('account-discord-btn').href, nav: document.getElementById('nav-account').textContent.trim() }));
  ok(v.join && !v.profile && v.nav === 'Sign in and join us', 'signed out: the Join card, and the nav says Sign in and join us');
  ok(v.href.startsWith('https://discord.com/oauth2/authorize'), 'the Discord button is Discord\'s own link once one is ready');
  ok(o.calls.some((c) => c.path === '/auth/discord/begin' && !c.authed && c.body.mode === 'redirect' && c.body.scopes.join() === 'guilds.join,email,connections' && c.body.return_to.endsWith('account.html')),
    'the sign-in asks for the three permissions and comes back here');
  clean(o);
  await o.page.close();

  // A result this browser did not begin: refused, nobody signed in, the address cleaned.
  o = await open({ width: 1280, height: 900 }, { signedIn: false, hash: '#ht_result=elsewhere.c0de' });
  v = await o.page.evaluate(() => ({ profile: !document.getElementById('account-profile').hidden, hash: location.hash,
    stored: !!localStorage.getItem('ht_auth_token'), err: document.getElementById('account-error').textContent }));
  ok(!v.profile && !v.stored && v.hash === '' && /another browser/.test(v.err), 'a sign-in begun elsewhere is refused, with a message');
  ok(!o.calls.some((c) => c.path === '/auth/exchange'), 'it never reaches the server');
  clean(o);
  await o.page.close();

  // Back from Discord with a code this tab began: signed in, the address cleaned.
  o = await open({ width: 1280, height: 900 }, { signedIn: false, pendingSignIn: true, hash: '#ht_result=req9.c0de' });
  v = await o.page.evaluate(() => ({ profile: !document.getElementById('account-profile').hidden, hash: location.hash, nav: document.getElementById('nav-account').textContent.trim(),
    stored: !!localStorage.getItem('ht_auth_token') }));
  ok(v.profile && v.stored && v.nav === 'Account', 'back from Discord: signed in, the profile shows, the nav says Account');
  ok(v.hash === '', 'the session is taken off the address');
  clean(o);
  await o.page.close();

  // Signed in with both logins: one line each, and the recent link as a notice.
  o = await open({ width: 390, height: 844, isMobile: true, hasTouch: true });
  v = await o.page.evaluate(() => ({
    rows: [...document.querySelectorAll('#account-identities li')].map((li) => li.dataset.provider + ':' + li.dataset.linked + ':' + li.textContent.trim()),
    notice: (document.querySelector('#account-notice-list uf-account-notice .uf-id-text') || {}).textContent || '',
    buttons: [...document.querySelectorAll('#account-notice-list uf-account-notice button')].map((b) => b.textContent),
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  ok(v.rows.join('|') === 'discord:true:Test Goose|steam:true:Goose on Steam', 'the logins: one line each, by name (' + v.rows.join('|') + ')');
  ok(v.notice.startsWith('The Steam account “Goose on Steam” was linked to this account on ') && v.buttons.join('|') === 'Not me, remove it|OK, that was me', 'a recent link shows as a notice, undo first');
  ok(!v.wide, 'phone: nothing wider than the screen');
  if (shots) await o.page.screenshot({ path: path.join(shots, 'profile-phone.png'), fullPage: true });
  await o.page.click('#account-notice-list uf-account-notice button[data-act="ok"]');
  await new Promise((r) => setTimeout(r, 300));
  ok(o.calls.some((c) => c.path === '/me/notices/seen' && c.body.id === 5), '"OK, that was me" tells the server');
  clean(o);
  await o.page.close();

  // Back from linking a Steam that has its own account: both accounts, and nothing moves on Cancel.
  o = await open({ width: 1280, height: 900 }, { discordOnly: true, hash: '#ht_link=req1.c0de', pendingLink: true });
  await o.page.waitForFunction(() => document.getElementById('account-combine-dialog').open, { timeout: 5000 }).catch(() => {});
  v = await o.page.evaluate(() => ({
    link: [...document.querySelectorAll('#account-identities li')].map((li) => li.dataset.provider + ':' + li.textContent.trim()),
    title: (document.querySelector('#combine-question h2') || {}).textContent || '',
    cards: [...document.querySelectorAll('#combine-question .uf-id-acct')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    buttons: [...document.querySelectorAll('#combine-question button')].map((b) => b.textContent),
  }));
  ok(v.link.join('|') === 'discord:Test Goose|steam:Link Steam', 'a missing login is a Link button (' + v.link.join('|') + ')');
  ok(v.title.includes('This Steam account already has its own House Tandem account') && v.cards.length === 2
    && v.cards[0].includes('Old Steam Goose') && v.cards[0].includes('40 rides · 9 badges in Tandemonium') && v.cards[0].includes('7, 11, Doubles (1 badge)'),
    'the combine question shows both accounts, with the other games');
  ok(v.buttons.join('|') === 'Cancel|Combine', 'Cancel first, then Combine');
  ok(o.calls.some((c) => c.path === '/auth/link/complete' && c.authed && c.body.id === 'req1' && c.body.code === 'c0de' && c.body.secret === 'tab-secret'), 'the link is finished with this tab\'s secret');
  if (shots) await o.page.screenshot({ path: path.join(shots, 'combine-desktop.png') });
  await o.page.click('#combine-question button[data-act="no"]');
  await o.page.waitForFunction(() => !document.getElementById('account-combine-dialog').open, { timeout: 5000 }).catch(() => {});
  v = await o.page.evaluate(() => document.getElementById('account-link-ok').textContent);
  ok(o.calls.some((c) => c.path === '/auth/link/combine' && c.body.ok === false) && v === 'Nothing was changed.', 'Cancel: the server is told no, and the page says nothing was changed');
  clean(o);
  await o.page.close();

  // A link this tab did not begin can't be finished here.
  o = await open({ width: 1280, height: 900 }, { discordOnly: true, hash: '#ht_link=req1.c0de' });
  v = await o.page.evaluate(() => ({ err: document.getElementById('account-link-error').textContent, open: document.getElementById('account-combine-dialog').open }));
  ok(v.err.includes('started in another browser or tab') && !v.open && !o.calls.some((c) => c.path === '/auth/link/complete'), 'a link begun elsewhere is refused here, without asking the server');
  clean(o);
  await o.page.close();
}

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
  await runAccount();
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `${failures.length} failed` : 'all passed');
process.exit(failures.length ? 1 : 0);
