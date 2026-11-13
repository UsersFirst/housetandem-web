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
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
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
  function goSignIn(provider) {
    return api('/auth/' + provider + '/begin', { method: 'POST', body: beginBody(provider) }).then(function (d) {
      if (d.url) { location.assign(d.url); return true; }
      throw new Error(d.error || NAMES[provider] + ' sign-in is unavailable right now');
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
  function signInWithDiscord() { return goSignIn('discord'); }
  function signInWithSteam() { return goSignIn('steam'); }

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
  var serverJoin = null;
  function takeRedirect() {
    if (!location.hash || location.hash.indexOf('ht_auth=') < 0) return false;
    var params = new URLSearchParams(location.hash.slice(1));
    var token = params.get('ht_auth');
    serverJoin = params.get('ht_server');
    params.delete('ht_auth');
    params.delete('ht_server');
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    if (!tokenValid(token)) return false;
    state.token = token;
    var c = claims(token);
    state.user = { id: c.sub, name: c.name, avatar: c.picture, identities: {} };
    save();
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
    link: goSignIn,
    signOut: signOut,
    deleteAccount: deleteAccount,
    /** Achievements and stats in the other House Tandem games: { dice: { earned: [{id, earnedAt}], stats } } */
    games: function () { return state.token ? api('/me/games').then(function (d) { return d.games || {}; }) : Promise.resolve({}); },
    /** Is the linked Discord in the House Tandem server? { linked, member: true|false|null, invite, server_url } */
    discordMembership: function () { return state.token ? api('/me/discord') : Promise.resolve(null); },
    onChange: function (fn) { listeners.push(fn); },
  };
})();
