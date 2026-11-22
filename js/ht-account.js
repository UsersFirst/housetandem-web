// House Tandem account: the session for this site, and the account link in the nav.
//
// The sign-in itself is @usersfirst/identity (lib/identity, vendored from the lab: the same
// client Tandemonium runs on). This file is the site's side of it: which Discord permissions
// to ask for, the prepared Discord link for phones, the nav, and opening the other House
// Tandem sites signed in. Pages use it through window.HTAccount.
//
// A module: it runs before DOMContentLoaded, after the page's classic scripts. Anything that
// depends on coming back from Discord or Steam waits for HTAccount.ready.
import { IdentityClient, loginPictures } from '../lib/identity/client.js';
import { askInPage } from '../lib/identity/elements/ask-switch.js';

// House Tandem's own address for the API (its workers.dev address looked like phishing on Discord's consent screen).
const API = window.HT_API || 'https://api.housetandem.com';
const NAMES = { discord: 'Discord', steam: 'Steam' };

// The page's first script already took any ht_* values off the address (so nothing else on
// the page can read them) and left the fragment here for the client to finish.
const captured = window.__htBack || null;
delete window.__htBack;
const pageLoc = captured ? {
  origin: location.origin, pathname: location.pathname, search: location.search, hash: captured.hash,
  assign: (u) => location.assign(u),
} : null;
const pageHist = captured ? {
  replaceState(_s, _t, url) { const u = new URL(url, location.href); pageLoc.search = u.search; pageLoc.hash = u.hash; },
} : null;
const client = new IdentityClient({ apiBase: API, confirmSwitch: askInPage, ...(captured ? { location: pageLoc, history: pageHist } : {}) });
// A stored session past its date is no session.
if (client.token && client.tokenExpired()) client.signOut();

/** The pictures to show, left to right: Discord, then Steam. */
const pictures = (user) => loginPictures(user);

/** Re-read the account (name, pictures, linked sign-ins) and the Tandemonium record. → the /me answer, or null */
async function refresh() {
  if (!client.token) return null;
  const user = await client.refresh();
  // A token the server no longer takes: signed out, here too.
  if (!user && (client.meStatus === 401 || !client.token)) { client.signOut(); return null; }
  return user ? client.me : null;
}

// What a Discord sign-in asks for beyond name and picture (the Permissions switches on account.html):
// join the House Tandem server, email for new game news, linked accounts for Steam achievements.
let discordScopes = ['guilds.join', 'email', 'connections'];
const optsFor = (provider) => (provider === 'discord' ? { scopes: discordScopes.slice() } : {});
function setDiscordScopes(list) {
  discordScopes = (list || []).slice();
  discordLink = { url: null, at: 0, key: '' };   // the prepared link asked for the old set
}

/**
 * Go to Discord or Steam and come back to this page: signed in, or (already signed in)
 * with that sign-in linked to this account. Linking needs a sign-in to this account from
 * the last 10 minutes; an older session gets an error with `fresh: true` (the page offers
 * "Sign in again"). Only this tab can finish a link it began (Tandemonium #612).
 */
async function goSignIn(provider, { signIn = false } = {}) {
  const linking = !!client.token && !signIn;
  try {
    await (linking ? client.linkRedirect(provider, optsFor(provider)) : client.signInRedirect(provider, optsFor(provider)));
    return true;
  } catch (e) {
    if (e && e.fresh) { e.provider = provider; throw e; }
    throw new Error((e && e.status && e.message) || NAMES[provider] + ' sign-in is unavailable right now');
  }
}

/**
 * "Confirm it's you": sign in again with one of this account's own sign-ins, then carry
 * on with `then` ('link:steam' / 'link:discord') if it came back as the same account.
 */
const signInAgain = (provider, then) => client.confirmRedirect(provider, then, optsFor(provider));

/** The combine screen's answer. ok: true combines the two accounts. → { status: 'combined' | 'cancelled' } */
async function combine(id, ok) {
  const out = await client.combine(id, ok === true);
  if (out.error) throw new Error('That link has expired. Start it again from your profile.');
  return out;
}

/** Remove a linked sign-in / separate a combined account. signed_out: this session ended with it. */
async function undoNotice(id) {
  const out = await client.undo(id);
  if (out.error || !out.undone) throw Object.assign(new Error(out.error || 'That could not be undone.'), { fresh: !!out.fresh });
  if (out.signed_out) client.signOut();
  return out;
}

/**
 * Gameplay analytics: the account's one answer, used by every House Tandem game.
 * → { consent: { choice, version, at } | null, required, version } or null (not reachable).
 */
async function analyticsConsent() {
  if (!client.token) return null;
  const r = await client.api('/me/consent').catch(() => null);
  return r && r.ok ? r.data : null;
}

/** Change the account's answer. A new answer takes the place of the earlier one. → the account's answer now */
async function setAnalyticsConsent(on, version) {
  if (!client.token) throw new Error('Sign in first');
  const id = (crypto.randomUUID && crypto.randomUUID()) || '';
  const r = await client.api('/consent', { method: 'POST', auth: false, body: { id, choice: on ? 'accept' : 'decline', version, account_token: client.token } }).catch(() => null);
  if (!r || !r.ok || !r.data.consent) throw new Error('That did not save. Try again in a moment.');
  return r.data.consent;
}

/** End every session of this account, on every device. */
async function signOutEverywhere() {
  const out = await client.signOutEverywhere();
  if (out.error) throw new Error(out.error);
  return out;
}

/**
 * Discord's own consent-screen address, made ahead of the tap so the button can
 * be a plain discord.com link: a tap on one can open the Discord app on a phone,
 * already signed in, where our redirect would land on Discord's web login.
 * Good for 8 minutes (the request lives 10). → Promise<string|null>
 */
let discordLink = { url: null, at: 0, key: '' };
async function prepareDiscordLink() {
  const key = discordScopes.join(' ');
  try {
    // anyTab: on a phone the Discord app can hand the answer back to a new tab of this browser.
    const d = await client.begin('discord', { mode: 'redirect', scopes: discordScopes.slice(), anyTab: true });
    if (key !== discordScopes.join(' ')) return null;   // switches changed while this was on its way
    discordLink = d.authorize_url ? { url: d.authorize_url, at: Date.now(), key } : { url: null, at: 0, key: '' };
  } catch (e) { discordLink = { url: null, at: 0, key: '' }; }
  return discordLink.url;
}
// A sign-in that came back to a browser that didn't begin it (an in-app browser, say): from
// here this tab uses the plain redirect, which stays in one browser from start to finish.
const NO_APP_LINK = 'ht_no_app_link';
const appLinkOff = () => { try { return sessionStorage.getItem(NO_APP_LINK) === '1'; } catch (e) { return false; } };
const freshDiscordLink = () => (!appLinkOff() && discordLink.url && discordLink.key === discordScopes.join(' ') && Date.now() - discordLink.at < 8 * 60 * 1000 ? discordLink.url : null);

/** Delete the account and everything on it; the server needs the typed word and a recent sign-in. */
async function deleteAccount(confirmWord) {
  const out = await client.deleteAccount(confirmWord);
  if (out.error) throw Object.assign(new Error(out.error), { fresh: !!out.fresh });
  return out;
}

// ── Nav: "Sign in and join us", or the account's pictures ──
function renderNav() {
  const list = document.querySelector('.nav-links');
  if (!list) return;
  let li = document.getElementById('nav-account');
  if (!li) {
    li = document.createElement('li');
    li.id = 'nav-account';
    list.appendChild(li);
  }
  const a = document.createElement('a');
  a.href = 'account.html';
  a.className = 'nav-account' + (/account\.html$/.test(location.pathname) ? ' active' : '');
  const user = client.user;
  if (!user || !client.token) {
    a.textContent = 'Sign in and join us';
  } else {
    const pics = pictures(user);
    const discord = pics.filter((p) => p.provider !== 'steam')[0];
    const steam = pics.filter((p) => p.provider === 'steam')[0];
    const mk = (p) => {
      const img = document.createElement('img');
      img.src = p.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.className = 'nav-avatar'; img.setAttribute('data-provider', p.provider);
      return img;
    };
    if (discord) a.appendChild(mk(discord));
    a.appendChild(document.createTextNode('Account'));
    if (steam) a.appendChild(mk(steam));
    a.title = 'Signed in as ' + (user.name || '');
  }
  li.replaceChildren(a);
}

/**
 * The sign-in here is too old to carry over to another site. A short note under the link:
 * sign in again (then the link carries it), or open the game as it is. → true when shown.
 */
function staleHandoff(a, href, win) {
  if (win) { try { win.close(); } catch (e) { /* the note is on this page */ } }
  const old = document.getElementById('ht-handoff-note');
  if (old) old.remove();
  const note = document.createElement('p');
  note.id = 'ht-handoff-note';
  note.className = 'account-ok';
  note.setAttribute('role', 'status');
  note.textContent = 'You signed in here over an hour ago, so the game would open signed out. ';
  const again = document.createElement('a');
  again.href = 'account.html';
  again.textContent = 'Sign in again';
  again.addEventListener('click', (e) => { e.preventDefault(); client.signOut(); location.assign('account.html'); });
  const open = document.createElement('a');
  open.href = href;
  if (a.target) open.target = a.target;
  open.rel = 'noopener';
  open.dataset.htPlain = '1';
  open.textContent = 'open it anyway';
  note.append(again, ' to carry your sign-in over, or ', open, '.');
  const host = a.closest('li, p, div') || a;
  host.insertAdjacentElement('afterend', note);
  return true;
}

// Signed in, a link to another House Tandem site opens it signed in too:
// a one-time code rides along (the session itself never goes in a URL).
const HANDOFF_HOSTS = ['dice.housetandem.com', 'coins.housetandem.com'];
function handoffLinks(e) {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || a.dataset.htPlain || !client.token || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  let url;
  try { url = new URL(a.href); } catch (err) { return; }
  if (url.protocol !== 'https:' || HANDOFF_HOSTS.indexOf(url.host) < 0) return;
  e.preventDefault();
  const win = a.target === '_blank' ? window.open('', '_blank') : null;
  const go = (href) => { if (win) win.location.href = href; else location.assign(href); };
  client.handoff().then((code) => {
    if (code) url.searchParams.set('ht_code', code);
    // No code because this sign-in is over an hour old: say so, and let the player choose.
    else if (client.handoffStale && staleHandoff(a, url.toString(), win)) return;
    go(url.toString());
  }, () => go(a.href));
}

// Back from Discord or Steam? #ht_result=<id>.<code> is swapped for a session, with the value
// this browser kept; what happened (the server join, a Steam with its own account) comes from
// that answer. #ht_link=<id>.<code> is a link to finish, which only this tab can.
const back = { cameBack: false, serverJoin: null, steamHasAccount: false, afterSignIn: null, linkResult: null, signInError: null };
const ready = client.resume().then((res) => {
  if (!res) return back;
  if (res.signedIn) {
    back.cameBack = true;
    back.serverJoin = res.server || null;
    back.steamHasAccount = res.steam === 'has_account';
    back.afterSignIn = res.after || null;
  } else if (res.link === 'linked') {
    back.linkResult = { status: 'linked', steamHasAccount: res.steam === 'has_account' };
  } else if (res.link === 'combine') {
    back.linkResult = { status: 'combine', id: res.id, provider: res.provider, login: res.login, into: res.into, other: res.other };
  } else if (res.signedIn === false) {
    // Nothing changed here. Declining a switch of account needs no message.
    if (res.mismatch) { try { sessionStorage.setItem(NO_APP_LINK, '1'); } catch (e) { /* blocked */ } }
    if (!res.declined) back.signInError = res.error === 'offline' ? 'You seem to be offline. Try signing in again.' : (res.error || 'That sign-in has expired. Start it again.');
  } else {
    // A link this tab did not begin, or one that ran out.
    back.linkResult = { status: 'error', error: client.token ? 'That link has expired or was started in another browser or tab. Start it again here, from your profile.' : 'Sign in, then start the link again from your profile.' };
  }
  return back;
}, () => back);

client.onChange(renderNav);
document.addEventListener('click', handoffLinks);
document.addEventListener('DOMContentLoaded', () => {
  renderNav();
  ready.then(() => { if (client.token && !back.cameBack) refresh(); });
});

window.HTAccount = {
  /** The IdentityClient itself, for the shared account elements. */
  client,
  get user() { return client.token ? client.user : null; },
  get signedIn() { return !!client.token; },
  /**
   * Resolves once a return from Discord or Steam has been dealt with (at once when there
   * was none). The fields below it are filled in by then.
   */
  ready,
  /** Came back from a sign-in on this page load. */
  get cameBack() { return back.cameBack; },
  /** 'added' | 'already' | 'failed' | null: what signing in with Discord did about the House Tandem server. */
  get serverJoin() { return back.serverJoin; },
  /** Back from a link: { status: 'linked' } | { status: 'combine', id, provider, into, other } | { status: 'error', error }, or null. */
  get linkResult() { return back.linkResult; },
  /** A sign-in that came back and was not accepted: what to tell the player, or null. */
  get signInError() { return back.signInError; },
  /** 'link:steam' / 'link:discord' when "Confirm it's you" came back as the same account. */
  get afterSignIn() { return back.afterSignIn; },
  /** A Discord sign-in found a verified Steam that has its own account (Link Steam combines them). */
  get steamHasAccount() { return back.steamHasAccount; },
  prepareDiscordLink,
  setDiscordScopes,
  freshDiscordLink,
  pictures,
  refresh,
  signInWithDiscord: () => goSignIn('discord', { signIn: true }),
  signInWithSteam: () => goSignIn('steam', { signIn: true }),
  link: (provider) => goSignIn(provider),
  combine,
  signInAgain,
  notices: () => client.notices(),
  noticeSeen: (id) => client.seen(id),
  undoNotice,
  signOut: () => client.signOut(),
  signOutEverywhere,
  analyticsConsent,
  setAnalyticsConsent,
  deleteAccount,
  /** Achievements, stats and time played in every House Tandem game: { dice: { earned: [{id, earnedAt}], stats } } */
  games: () => client.games(),
  /** Is the linked Discord in the House Tandem server? { linked, member: true|false|null, invite, server_url } */
  discordMembership: () => client.membership(),
  onChange: (fn) => client.onChange((user) => fn(client.token ? user : null)),
};
