// House Tandem account on the website (Tandemonium #612, housetandem-web #21).
//
// The same account as the games: sign in with Discord or Steam here, and link
// the other one so both pictures show. The account lives on the
// Tandemonium API for now (it moves to auth.housetandem.com later).
//
// Every page: a "Sign in" link in the nav, which becomes the account's pictures
// (Discord left, Steam right) once signed in. account.html uses window.HTAccount.
(function () {
  // House Tandem's own address for the API (its workers.dev address looked like phishing on Discord's consent screen).
  var API = window.HT_API || 'https://api.housetandem.com';
  var K_TOKEN = 'ht_auth_token';
  var K_USER = 'ht_auth_user';

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function claims(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; }
  }
  function tokenValid(token) {
    var c = token && claims(token);
    return !!(c && c.exp && c.exp > Date.now() / 1000 + 60);
  }

  var listeners = [];
  var state = { token: null, user: null };

  function load() {
    state.token = read(K_TOKEN);
    try { state.user = JSON.parse(read(K_USER) || 'null'); } catch (e) { state.user = null; }
    if (!tokenValid(state.token)) { state.token = null; state.user = null; }
  }
  function save() {
    store(K_TOKEN, state.token);
    store(K_USER, state.user ? JSON.stringify(state.user) : null);
    listeners.forEach(function (fn) { try { fn(state.user); } catch (e) {} });
  }

  /** The pictures to show, left to right: Discord, then Steam. */
  function pictures(user) {
    if (!user) return [];
    var ids = user.identities || {};
    var out = [];
    ['discord', 'steam'].forEach(function (p) { if (ids[p] && ids[p].avatar) out.push({ provider: p, avatar: ids[p].avatar, name: ids[p].name }); });
    if (!out.length && user.avatar) out.push({ provider: 'account', avatar: user.avatar, name: user.name });
    return out;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token && !opts.noAuth) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; }); });
  }

  /** Re-read the account (name, pictures, linked sign-ins) and the Tandemonium record. */
  function refresh() {
    if (!state.token) return Promise.resolve(null);
    return api('/me').then(function (me) {
      if (me.__status === 401) { signOut(); return null; }
      if (me.user) {
        state.user = { id: me.user.id, name: me.user.display_name, avatar: me.user.avatar_url, identities: me.user.identities || {} };
        save();
      }
      return me;
    });
  }

  var NAMES = { discord: 'Discord', steam: 'Steam' };

  /**
   * Go to Discord or Steam and come back to this page signed in. Already signed
   * in, it links that sign-in to this account instead (the API sees the session).
   */
  // What a Discord sign-in asks for beyond name and picture (the Permissions switches on account.html):
  // join the House Tandem server, email for new game news, linked accounts for Steam achievements.
  var discordScopes = ['guilds.join', 'email', 'connections'];
  function beginBody(provider) {
    var back = location.origin + location.pathname + location.search;
    return provider === 'discord' ? { mode: 'redirect', return_to: back, scopes: discordScopes.slice() } : { return_to: back };
  }
  function setDiscordScopes(list) {
    discordScopes = (list || []).slice();
    discordLink = { url: null, at: 0, key: '' };   // the prepared link asked for the old set
  }
  /**
   * Linking (signed in) needs a sign-in to this account from the last 10 minutes; an
   * older session gets an error with `fresh: true` (the page offers "Sign in again").
   * The link's secret stays in this browser: only it can finish the link (Tandemonium #612).
   */
  var K_LINK = 'ht_link_pending';
  function goSignIn(provider, opts) {
    opts = opts || {};
    var linking = !!state.token && !opts.signIn;
    return api('/auth/' + provider + '/begin', { method: 'POST', body: beginBody(provider), noAuth: !linking }).then(function (d) {
      if (d.__status === 401 && d.code === 'fresh_signin') {
        var e = new Error(d.error || 'For your safety, sign in again before linking another account.');
        e.fresh = true; e.provider = provider;
        throw e;
      }
      if (d.url) {
        if (linking && d.secret) store(K_LINK, JSON.stringify({ id: d.id, secret: d.secret, at: Date.now() }));
        location.assign(d.url);
        return true;
      }
      throw new Error(d.error || NAMES[provider] + ' sign-in is unavailable right now');
    });
  }

  /**
   * "Confirm it's you": sign in again with one of this account's own sign-ins, then carry
   * on with `then` ('link:steam' / 'link:discord') if it came back as the same account.
   */
  var K_AFTER = 'ht_after_signin';
  function signInAgain(provider, then) {
    var c = state.token && claims(state.token);
    store(K_AFTER, JSON.stringify({ sub: c ? c.sub : null, then: then || null, at: Date.now() }));
    return goSignIn(provider, { signIn: true });
  }

  function applySession(d) {
    if (!d || !d.token) return;
    state.token = d.token;
    var u = d.user || {};
    state.user = { id: u.id, name: u.name, avatar: u.avatar, identities: u.identities || {} };
    save();
  }
  function pendingSecret(id) {
    var p = null;
    try { p = JSON.parse(read(K_LINK) || 'null'); } catch (e) {}
    return p && p.id === id && Date.now() - p.at < 10 * 60 * 1000 ? p.secret : null;
  }

  /**
   * Back from Discord or Steam with #ht_link=<id>.<code>: finish the link this browser began.
   * → { status: 'linked' } | { status: 'combine', id, provider, login, into, other } | { status: 'error', error }
   */
  function completeLink(link) {
    var secret = pendingSecret(link.id);
    if (!secret || !state.token) {
      return Promise.resolve({ status: 'error', error: 'That link was started in another browser or tab. Start it again here, from your profile.' });
    }
    return api('/auth/link/complete', { method: 'POST', body: { id: link.id, code: link.code, secret: secret } }).then(function (d) {
      if (d.status === 'linked') { store(K_LINK, null); applySession(d); return { status: 'linked', steamHasAccount: !!d.steam_has_account }; }
      if (d.status === 'combine') return { status: 'combine', id: link.id, provider: d.provider, login: d.login, into: d.into, other: d.other };
      store(K_LINK, null);
      return { status: 'error', error: d.error || 'That link has expired. Start it again from your profile.' };
    }, function () { return { status: 'error', error: 'Offline. Start the link again from your profile.' }; });
  }

  /** The combine screen's answer. ok: true combines the two accounts. → { status: 'combined' | 'cancelled' } */
  function combine(id, ok) {
    var secret = pendingSecret(id);
    store(K_LINK, null);
    if (!secret) return Promise.reject(new Error('That link has expired. Start it again from your profile.'));
    return api('/auth/link/combine', { method: 'POST', body: { id: id, secret: secret, ok: ok === true } }).then(function (d) {
      if (d.status === 'combined') { applySession(d); return d; }
      if (d.status === 'cancelled') return d;
      throw new Error(d.error || 'That link has expired. Start it again from your profile.');
    });
  }

  /** What was linked to or combined into this account in the last 7 days (each can be undone). */
  function notices() {
    if (!state.token) return Promise.resolve([]);
    return api('/me/notices').then(function (d) { return d.notices || []; }, function () { return []; });
  }
  function noticeSeen(id) { return api('/me/notices/seen', { method: 'POST', body: { id: id } }); }
  /** Remove a linked sign-in / separate a combined account. signed_out: this session ended with it. */
  function undoNotice(id) {
    return api('/me/notices/undo', { method: 'POST', body: { id: id } }).then(function (d) {
      if (!d.undone) throw new Error(d.error || 'That could not be undone.');
      if (d.signed_out) signOut();
      return d;
    });
  }

  /**
   * Discord's own consent-screen address, made ahead of the tap so the button can
   * be a plain discord.com link: a tap on one can open the Discord app on a phone,
   * already signed in, where our redirect would land on Discord's web login.
   * Good for 8 minutes (the request lives 10). → Promise<string|null>
   */
  var discordLink = { url: null, at: 0, key: '' };
  function prepareDiscordLink() {
    var key = discordScopes.join(' ');
    return api('/auth/discord/begin', { method: 'POST', body: beginBody('discord') }).then(function (d) {
      if (key !== discordScopes.join(' ')) return null;   // switches changed while this was on its way
      discordLink = d.authorize_url ? { url: d.authorize_url, at: Date.now(), key: key } : { url: null, at: 0, key: '' };
      return discordLink.url;
    }, function () { discordLink = { url: null, at: 0, key: '' }; return null; });
  }
  function freshDiscordLink() {
    return discordLink.url && discordLink.key === discordScopes.join(' ') && Date.now() - discordLink.at < 8 * 60 * 1000 ? discordLink.url : null;
  }
  function signInWithDiscord() { return goSignIn('discord', { signIn: true }); }
  function signInWithSteam() { return goSignIn('steam', { signIn: true }); }

  /** Delete the account and everything on it; the server needs the typed word. */
  function deleteAccount(confirmWord) {
    return api('/me/delete', { method: 'POST', body: { confirm: confirmWord } }).then(function (d) {
      if (d.__status !== 200 || !d.deleted) throw new Error(d.error || 'The account could not be deleted. Nothing was changed.');
      signOut();
      return d;
    });
  }

  function signOut() {
    state.token = null; state.user = null;
    save();
  }

  // Back from Discord or Steam: #ht_auth=<token> (and from Discord, &ht_server=added|already|failed).
  // Take them off the URL straight away.
  // Back from a link: #ht_link=<id>.<code> (no session in the URL); js finishes it with the secret.
  // Back from a Discord sign-in whose verified Steam has its own account: &ht_steam=has_account.
  var serverJoin = null;
  var pendingLink = null;
  var steamHasAccount = false;
  var afterSignIn = null;
  function takeRedirect() {
    if (!location.hash || !/ht_(auth|link)=/.test(location.hash)) return false;
    var params = new URLSearchParams(location.hash.slice(1));
    var token = params.get('ht_auth');
    var link = params.get('ht_link');
    serverJoin = params.get('ht_server');
    steamHasAccount = params.get('ht_steam') === 'has_account';
    ['ht_auth', 'ht_link', 'ht_server', 'ht_steam'].forEach(function (k) { params.delete(k); });
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    if (link) {
      var dot = link.indexOf('.');
      if (dot > 0) pendingLink = { id: link.slice(0, dot), code: link.slice(dot + 1) };
      return false;
    }
    if (!tokenValid(token)) return false;
    state.token = token;
    var c = claims(token);
    state.user = { id: c.sub, name: c.name, avatar: c.picture, identities: {} };
    save();
    // "Confirm it's you" came back as the same account: carry on with what they were doing.
    var after = null;
    try { after = JSON.parse(read(K_AFTER) || 'null'); } catch (e) {}
    store(K_AFTER, null);
    if (after && after.then && after.sub != null && String(after.sub) === String(c.sub) && Date.now() - after.at < 15 * 60 * 1000) afterSignIn = after.then;
    return true;
  }

  // ── Nav: "Sign in", or the account's pictures ──
  function renderNav() {
    var list = document.querySelector('.nav-links');
    if (!list) return;
    var li = document.getElementById('nav-account');
    if (!li) {
      li = document.createElement('li');
      li.id = 'nav-account';
      list.appendChild(li);
    }
    var a = document.createElement('a');
    a.href = 'account.html';
    a.className = 'nav-account' + (/account\.html$/.test(location.pathname) ? ' active' : '');
    var pics = pictures(state.user);
    if (!state.user) {
      a.textContent = 'Sign in';
    } else {
      var discord = pics.filter(function (p) { return p.provider !== 'steam'; })[0];
      var steam = pics.filter(function (p) { return p.provider === 'steam'; })[0];
      var mk = function (p) {
        var img = document.createElement('img');
        img.src = p.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer';
        img.className = 'nav-avatar'; img.setAttribute('data-provider', p.provider);
        return img;
      };
      if (discord) a.appendChild(mk(discord));
      a.appendChild(document.createTextNode('Account'));
      if (steam) a.appendChild(mk(steam));
      a.title = 'Signed in as ' + (state.user.name || '');
    }
    li.replaceChildren(a);
  }

  load();
  var cameBack = takeRedirect();
  var linkResult = pendingLink ? completeLink(pendingLink) : null;
  // Signed in, a link to another House Tandem site opens it signed in too:
  // a one-time code rides along (the session itself never goes in a URL).
  var HANDOFF_HOSTS = ['dice.housetandem.com', 'coins.housetandem.com'];
  function handoffLinks(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !state.token || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var url;
    try { url = new URL(a.href); } catch (err) { return; }
    if (url.protocol !== 'https:' || HANDOFF_HOSTS.indexOf(url.host) < 0) return;
    e.preventDefault();
    var newTab = a.target === '_blank';
    var win = newTab ? window.open('', '_blank') : null;
    var go = function (href) { if (win) win.location.href = href; else location.assign(href); };
    api('/auth/handoff', { method: 'POST' }).then(function (d) {
      if (d.code) url.searchParams.set('ht_code', d.code);
      go(url.toString());
    }, function () { go(a.href); });
  }

  listeners.push(renderNav);
  document.addEventListener('click', handoffLinks);
  document.addEventListener('DOMContentLoaded', function () {
    renderNav();
    if (state.token) refresh();
  });

  window.HTAccount = {
    get user() { return state.user; },
    get signedIn() { return !!state.token; },
    cameBack: cameBack,
    /** 'added' | 'already' | 'failed' | null: what signing in with Discord did about the House Tandem server. */
    serverJoin: serverJoin,
    prepareDiscordLink: prepareDiscordLink,
    setDiscordScopes: setDiscordScopes,
    freshDiscordLink: freshDiscordLink,
    pictures: pictures,
    refresh: refresh,
    signInWithDiscord: signInWithDiscord,
    signInWithSteam: signInWithSteam,
    link: function (provider) { return goSignIn(provider); },
    /** Back from a link: a Promise of its result (see completeLink), or null. */
    linkResult: linkResult,
    combine: combine,
    signInAgain: signInAgain,
    /** 'link:steam' / 'link:discord' when "Confirm it's you" came back as the same account. */
    afterSignIn: afterSignIn,
    /** A Discord sign-in found a verified Steam that has its own account (Link Steam combines them). */
    steamHasAccount: steamHasAccount,
    notices: notices,
    noticeSeen: noticeSeen,
    undoNotice: undoNotice,
    signOut: signOut,
    deleteAccount: deleteAccount,
    /** Achievements and stats in the other House Tandem games: { dice: { earned: [{id, earnedAt}], stats } } */
    games: function () { return state.token ? api('/me/games').then(function (d) { return d.games || {}; }) : Promise.resolve({}); },
    /** Is the linked Discord in the House Tandem server? { linked, member: true|false|null, invite, server_url } */
    discordMembership: function () { return state.token ? api('/me/discord') : Promise.resolve(null); },
    onChange: function (fn) { listeners.push(fn); },
  };
})();
