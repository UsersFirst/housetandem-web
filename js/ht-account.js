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

// House Tandem's own address for the API (its workers.dev address looked like phishing on Discord's consent screen).
const API = window.HT_API || 'https://api.housetandem.com';
const NAMES = { discord: 'Discord', steam: 'Steam' };

const client = new IdentityClient({ apiBase: API });
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
  if (out.error || !out.undone) throw new Error(out.error || 'That could not be undone.');
  if (out.signed_out) client.signOut();
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
    const d = await client.begin('discord', { mode: 'redirect', scopes: discordScopes.slice() });
    if (key !== discordScopes.join(' ')) return null;   // switches changed while this was on its way
    discordLink = d.authorize_url ? { url: d.authorize_url, at: Date.now(), key } : { url: null, at: 0, key: '' };
  } catch (e) { discordLink = { url: null, at: 0, key: '' }; }
  return discordLink.url;
}
const freshDiscordLink = () => (discordLink.url && discordLink.key === discordScopes.join(' ') && Date.now() - discordLink.at < 8 * 60 * 1000 ? discordLink.url : null);

/** Delete the account and everything on it; the server needs the typed word. */
async function deleteAccount(confirmWord) {
  const out = await client.deleteAccount(confirmWord);
  if (out.error) throw new Error(out.error);
  return out;
}

// ── Nav: "Sign in", or the account's pictures ──
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
    a.textContent = 'Sign in';
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

// Signed in, a link to another House Tandem site opens it signed in too:
// a one-time code rides along (the session itself never goes in a URL).
const HANDOFF_HOSTS = ['dice.housetandem.com', 'coins.housetandem.com'];
function handoffLinks(e) {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || !client.token || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  let url;
  try { url = new URL(a.href); } catch (err) { return; }
  if (url.protocol !== 'https:' || HANDOFF_HOSTS.indexOf(url.host) < 0) return;
  e.preventDefault();
  const win = a.target === '_blank' ? window.open('', '_blank') : null;
  const go = (href) => { if (win) win.location.href = href; else location.assign(href); };
  client.handoff().then((code) => {
    if (code) url.searchParams.set('ht_code', code);
    go(url.toString());
  }, () => go(a.href));
}

// Back from Discord or Steam? #ht_auth=<token> signs in (from Discord, &ht_server=added|already|failed;
// &ht_steam=has_account when its verified Steam has its own account). #ht_link=<id>.<code> is a link
// to finish, which only this tab can. Both come off the URL straight away.
const back = { cameBack: false, serverJoin: null, steamHasAccount: false, afterSignIn: null, linkResult: null };
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
  deleteAccount,
  /** Achievements, stats and time played in every House Tandem game: { dice: { earned: [{id, earnedAt}], stats } } */
  games: () => client.games(),
  /** Is the linked Discord in the House Tandem server? { linked, member: true|false|null, invite, server_url } */
  discordMembership: () => client.membership(),
  onChange: (fn) => client.onChange((user) => fn(client.token ? user : null)),
};
