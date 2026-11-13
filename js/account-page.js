// account.html: sign in with Discord or Steam, then the account's pictures,
// linked sign-ins (with a Link button for the missing one) and Tandemonium record. Needs js/ht-account.js first.
(function () {
  var A = window.HTAccount;
  var $ = function (id) { return document.getElementById(id); };

  function fmtTime(ms) {
    if (!ms) return '–';
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /** Seconds played → "3 h 12 m", "45 m", "under a minute"; null when never reported. */
  function fmtPlayed(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    if (!sec) return null;
    if (sec < 60) return 'under a minute';
    var m = Math.floor(sec / 60), h = Math.floor(m / 60);
    if (!h) return m + ' m';
    return m % 60 && h < 100 ? h + ' h ' + (m % 60) + ' m' : h + ' h';
  }

  /** An ISO time → "today", "yesterday", "5 days ago", or a date (local calendar days). */
  function fmtAgo(iso, now) {
    var t = iso ? new Date(iso) : null;
    if (!t || isNaN(t)) return null;
    now = now || new Date();
    var day = function (d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; };
    var n = day(now) - day(t);
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 7) return n + ' days ago';
    var opts = { month: 'short', day: 'numeric' };
    if (t.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return t.toLocaleDateString(undefined, opts);
  }

  /** Metres → "850 m" or "12.3 km". */
  function fmtDistance(m) {
    m = Number(m) || 0;
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  }

  /** A card's "Time played · Last played" row (ids <game>-play, -time, -last); hidden when the API has no playtime. */
  function renderPlay(game, playtime) {
    var row = $(game + '-play');
    if (!row) return;
    var played = playtime && fmtPlayed(playtime.seconds);
    var last = playtime && fmtAgo(playtime.lastPlayed);
    $(game + '-time').parentNode.hidden = !played;
    $(game + '-last').parentNode.hidden = !last;
    $(game + '-time').textContent = played || '';
    $(game + '-last').textContent = last || '';
    if (last && playtime.lastPlayed) $(game + '-last').title = new Date(playtime.lastPlayed).toLocaleString();
    row.hidden = !played && !last;
  }


  /** Start a sign-in or link from a button; show what went wrong if it can't start. */
  function go(btn, start) {
    var err = A.signedIn ? $('account-link-error') : $('account-error');
    btn.disabled = true;
    err.hidden = true;
    start().catch(function (e) {
      btn.disabled = false;
      err.textContent = e.message;
      err.hidden = false;
    });
  }

  var lastMe = null;

  /**
   * The House Tandem games with achievements. Each publishes its own list at
   * `defs` ({ achievements: [{ id, name, description, icon, group }] }); the
   * account's progress comes from /me/games under `game`. A card stays hidden
   * until its list loads.
   */
  var GAMES = [
    { game: 'dice', title: '7, 11, Doubles', img: 'images/games/dice.jpg', url: 'https://dice.housetandem.com',
      defs: 'https://dice.housetandem.com/api/achievements', icon: '🎲', stats: [['rolls', 'rolls'], ['wins', 'wins']] },
    { game: 'coins', title: 'Carnival Dozer', img: 'images/games/coinpusher.jpg', url: 'https://coins.housetandem.com',
      defs: 'https://coins.housetandem.com/api/achievements', icon: '🪙', stats: [['games', 'games'], ['coinsWon', 'coins won']] },
  ];

  /** "streaks" → "Streaks" (a game's group id as a section title). */
  function titleOf(group) { return String(group).replace(/[_-]+/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** A game's card (hidden until filled) and its sheet. Ids: account-<game>, <game>-ach, <game>-ach-open, <game>-ach-sheet, <game>-<stat>. */
  function buildCard(g) {
    var card = el('div', 'account-game');
    card.id = 'account-' + g.game;
    card.hidden = true;
    var head = el('div', 'account-game-head');
    var img = el('img');
    img.src = g.img; img.alt = ''; img.width = 96; img.height = 54;
    var titles = el('div');
    var play = el('a', null, 'Play in browser \u2192');
    play.href = g.url;
    play.setAttribute('data-ht', 'play:' + g.game + '_account');
    titles.appendChild(el('h2', null, g.title));
    titles.appendChild(play);
    head.appendChild(img);
    head.appendChild(titles);
    var playRow = el('dl', 'account-play');
    playRow.id = g.game + '-play';
    playRow.hidden = true;
    [['time', 'Time played'], ['last', 'Last played']].forEach(function (p) {
      var row = el('div');
      var dd = el('dd');
      dd.id = g.game + '-' + p[0];
      row.appendChild(el('dt', null, p[1]));
      row.appendChild(dd);
      playRow.appendChild(row);
    });
    var open = el('button', 'account-ach-open');
    open.type = 'button';
    open.id = g.game + '-ach-open';
    open.setAttribute('aria-haspopup', 'dialog');
    var count = el('b', null, '0/0');
    count.id = g.game + '-ach';
    open.appendChild(count);
    open.appendChild(el('span', null, 'achievements'));
    open.appendChild(el('span', 'account-ach-see', 'See all \u203a'));
    var stats = el('div', 'account-stats account-stats-small');
    g.stats.forEach(function (s) {
      var cell = el('div');
      var b = el('b', null, '0');
      b.id = g.game + '-' + s[0];
      cell.appendChild(b);
      cell.appendChild(el('span', null, s[1]));
      stats.appendChild(cell);
    });
    card.appendChild(head);
    card.appendChild(playRow);
    card.appendChild(open);
    card.appendChild(stats);
    $('account-games').appendChild(card);
    var sheet = document.createElement('uf-achievement-sheet');
    sheet.id = g.game + '-ach-sheet';
    sheet.setAttribute('heading', g.title);
    $('account-sheets').appendChild(sheet);
    open.addEventListener('click', function () { sheet.show(); });
  }

  /**
   * A game's card: "2/22" achievements and its stats. Tapping the count opens
   * the full list (uf-achievement-sheet), and each badge its card.
   */
  function renderGame(g, gamesP) {
    var defsP = fetch(g.defs).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([defsP, gamesP]).then(function (res) {
      var raw = res[0];
      var defs = Array.isArray(raw) ? raw : (raw && raw.achievements) || [];
      if (!defs.length) return;
      var mine = (res[1] && res[1][g.game]) || { earned: [], stats: {} };
      var have = {};
      (mine.earned || []).forEach(function (e) { have[e.id] = e.earnedAt || true; });
      var stats = mine.stats || {};
      g.stats.forEach(function (s) { $(g.game + '-' + s[0]).textContent = (Number(stats[s[0]]) || 0).toLocaleString(); });
      renderPlay(g.game, mine.playtime);
      var count = $(g.game + '-ach');
      count.textContent = defs.filter(function (d) { return have[d.id]; }).length + '/' + defs.length;
      var groups = [];
      defs.forEach(function (d) { if (d.group && groups.indexOf(d.group) < 0) groups.push(d.group); });
      var sheet = $(g.game + '-ach-sheet');
      sheet.sections = groups.map(function (gr) { return { id: gr, title: titleOf(gr) }; });
      sheet.achievements = defs.map(function (d) {
        var at = have[d.id];
        return { id: d.id, name: d.name, description: d.description || '', icon: d.icon || g.icon, section: d.group || undefined,
          earned: !!at, earnedAt: typeof at === 'string' ? at : null };
      });
      $(g.game + '-ach-open').setAttribute('aria-label', count.textContent + ' achievements. See all');
      $('account-' + g.game).hidden = false;
    });
  }

  /**
   * Tandemonium's card from /me/games: time played, distance, rides and days
   * ridden from the game's lifetime stats. An older API has no `tandemonium`
   * key; then the card keeps the /me numbers (rides, best, achievements).
   */
  function renderTandemonium(games) {
    var t = games && games.tandemonium;
    renderPlay('tandemonium', t && t.playtime);
    var stats = (t && t.stats) || {};
    var dist = Number(stats.cumulativeDistance) || 0;
    $('stat-distance').textContent = fmtDistance(dist);
    $('stat-distance-cell').hidden = !dist;
    var days = Number(stats.days) || 0;
    $('stat-days').textContent = days.toLocaleString();
    $('stat-days-cell').hidden = !days;
    var rides = Number(stats.rides) || 0;
    if (rides > (Number($('stat-rides').getAttribute('data-n')) || 0)) {
      $('stat-rides').textContent = rides.toLocaleString();
      $('stat-rides').setAttribute('data-n', rides);
    }
  }

  /** "4 h 10 m played across 3 games": all the account's time, once any game reports it. */
  function renderSummary(games) {
    var total = 0, n = 0;
    Object.keys(games || {}).forEach(function (k) {
      var s = Number(games[k] && games[k].playtime && games[k].playtime.seconds) || 0;
      if (s > 0) { total += s; n++; }
    });
    var line = $('account-summary');
    line.hidden = !total;
    line.textContent = total ? fmtPlayed(total) + ' played' + (n > 1 ? ' across ' + n + ' games' : '') : '';
  }

  function renderGames() {
    var gamesP = A.games().catch(function () { return {}; });
    gamesP.then(function (games) { renderTandemonium(games); renderSummary(games); });
    GAMES.forEach(function (g) { renderGame(g, gamesP); });
  }
  var serverState = null;

  /** Step 2, the House Tandem Discord: a member tick (+ Open Discord), or the invite. Hidden without Discord linked. */
  function checkServer() {
    A.discordMembership().then(function (d) {
      var step = $('step-server');
      if (!d || d.__status !== 200 || !d.linked) { step.hidden = true; return; }
      serverState = d.member;
      if (d.invite) $('account-server-join').href = d.invite;
      if (d.server_url) $('account-server-open').href = d.server_url;
      $('account-server-member').hidden = d.member !== true;
      $('account-server-open').hidden = d.member !== true;
      $('account-server-not').hidden = d.member !== false;
      $('account-server-join').hidden = d.member === true;
      step.classList.toggle('done', d.member === true);
      step.hidden = false;
    }).catch(function () {});
  }

  // ── Step 3: the Tandemonium playtest on Steam ──
  // The Steam link carries this visit's UTM tags (housetandem.com/tt → ?utm_source=tiktok…) so
  // Steamworks' UTM report still credits the post. Steam can't tell us the request was made,
  // so the step only remembers that the page was opened.
  var STEAM_APP = 'https://store.steampowered.com/app/4482940/';
  var K_PLAYTEST = 'ht_playtest_opened';
  function playtestUrl() {
    var here = new URLSearchParams(location.search);
    var u = new URL(STEAM_APP);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
      var v = here.get(k);
      if (v) u.searchParams.set(k, v.slice(0, 40));
    });
    if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'housetandem');
    if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'account');
    if (!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', 'playtest');
    return u.toString();
  }
  function playtestOpened() { try { return localStorage.getItem(K_PLAYTEST) === '1'; } catch (e) { return false; } }
  function renderPlaytest() {
    var opened = playtestOpened();
    var hint = $('playtest-hint');
    if (hint) hint.innerHTML = opened
      ? '&#10003; Steam page opened. If you haven’t yet, choose <b>Request Access</b> there.'
      : 'On the Steam page, choose <b>Request Access</b>.';
  }
  function wirePlaytest() {
    var href = playtestUrl();
    Array.prototype.forEach.call(document.querySelectorAll('.js-playtest'), function (a) {
      a.href = href;
      a.addEventListener('click', function () {
        try { localStorage.setItem(K_PLAYTEST, '1'); } catch (e) {}
        renderPlaytest();
      });
    });
    renderPlaytest();
  }

  // ── Step 1: Sign in with Discord as a plain discord.com link ──
  // Made ahead of the tap: a tap on a discord.com link can open the Discord app on a phone
  // (already signed in there). Without a fresh link, the tap falls back to the usual redirect.
  function wireDiscordButton() {
    var btn = $('account-discord-btn');
    var ready = function () { if (!A.signedIn) A.prepareDiscordLink().then(function (url) { if (url) btn.href = url; }); };
    ready();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !A.signedIn && !A.freshDiscordLink()) ready();
    });
    // Permissions switches: ask Discord for exactly what's ticked; step 2 offers the invite when the join is off.
    var boxes = document.querySelectorAll('.js-scope');
    var onScopes = function () {
      var picked = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).map(function (b) { return b.value; });
      A.setDiscordScopes(picked);
      var join = picked.indexOf('guilds.join') >= 0;
      $('step2-auto').hidden = !join;
      $('step2-invite').hidden = join;
      btn.href = 'account.html';
      ready();
    };
    Array.prototype.forEach.call(boxes, function (b) { b.addEventListener('change', onScopes); });
    btn.addEventListener('click', function (e) {
      var url = A.freshDiscordLink();
      if (url) { btn.href = url; return; }   // let the tap follow Discord's own link
      e.preventDefault();
      go(btn, A.signInWithDiscord);
    });
  }

  function render(me) {
    var user = A.user;
    $('account-signin').hidden = !!user;
    $('account-profile').hidden = !user;
    if (!user) return;

    $('account-name').textContent = user.name || 'House Tandem player';
    $('account-avatars').replaceChildren.apply($('account-avatars'), A.pictures(user).map(function (p) {
      var img = document.createElement('img');
      img.src = p.avatar; img.alt = p.provider; img.referrerPolicy = 'no-referrer';
      img.setAttribute('data-provider', p.provider);
      img.title = p.provider === 'discord' ? 'Discord' : p.provider === 'steam' ? 'Steam' : '';
      return img;
    }));

    var ids = user.identities || {};
    var rows = [['discord', 'Discord'], ['steam', 'Steam']].map(function (pair) {
      var li = document.createElement('li');
      var linked = !!ids[pair[0]];
      li.className = linked ? 'linked' : 'unlinked';
      li.setAttribute('data-provider', pair[0]);
      if (linked) {
        li.textContent = pair[1] + ' · ' + (ids[pair[0]].name || 'linked');
      } else {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'account-link';
        b.id = 'account-link-' + pair[0];
        b.textContent = 'Link ' + pair[1];
        b.addEventListener('click', function () { go(b, function () { return A.link(pair[0]); }); });
        li.appendChild(b);
      }
      return li;
    });
    $('account-identities').replaceChildren.apply($('account-identities'), rows);
    $('account-link-note').hidden = !!(ids.steam && ids.discord);
    $('step-signin-done').hidden = !ids.discord;
    $('step-signin-link').hidden = !!ids.discord;
    $('step-signin').classList.toggle('done', !!ids.discord);

    if (me) {
      var best = (me.bestScores || []);
      var rides = best.reduce(function (n, b) { return n + (b.rides || 0); }, 0);
      var grandma = best.filter(function (b) { return b.level_id === 'grandma'; })[0];
      $('stat-rides').textContent = rides.toLocaleString();
      $('stat-rides').setAttribute('data-n', rides);
      $('stat-ach').textContent = (me.achievements || []).length + '/100';
      $('stat-best').textContent = grandma ? fmtTime(grandma.best_time) : '–';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    render(null);
    GAMES.forEach(buildCard);
    if (A.signedIn) A.refresh().then(function (me) { lastMe = me; render(me); checkServer(); renderGames(); });
    // Back from joining in another tab: check again.
    window.addEventListener('focus', function () { if (A.signedIn && serverState === false) checkServer(); });

    wireDiscordButton();
    wirePlaytest();
    $('step-signin-link').addEventListener('click', function () { go(this, function () { return A.link('discord'); }); });
    $('account-steam-btn').addEventListener('click', function () { go(this, A.signInWithSteam); });
    $('account-signout').addEventListener('click', function () {
      A.signOut();
      render(null);
      A.prepareDiscordLink().then(function (url) { if (url) $('account-discord-btn').href = url; });
    });

    // Delete: a strict warning in a dialog, and the word DELETE typed out.
    var dlg = $('account-delete-dialog');
    var input = $('delete-confirm');
    var final = $('delete-final');
    $('account-delete').addEventListener('click', function () {
      var ids = (A.user && A.user.identities) || {};
      var names = ['discord', 'steam'].filter(function (p) { return ids[p]; }).map(function (p) { return p === 'discord' ? 'Discord' : 'Steam'; });
      $('delete-signins').textContent = names.length ? names.join(' and ') : 'all of them';
      $('delete-rides').textContent = lastMe ? $('stat-rides').textContent + ' rides' : 'all';
      $('delete-ach').textContent = lastMe ? $('stat-ach').textContent : 'all';
      input.value = '';
      final.disabled = true;
      $('delete-error').hidden = true;
      dlg.showModal();
    });
    input.addEventListener('input', function () { final.disabled = input.value.trim() !== 'DELETE'; });
    final.addEventListener('click', function () {
      if (input.value.trim() !== 'DELETE') return;
      final.disabled = true;
      final.textContent = 'Deleting…';
      A.deleteAccount('DELETE').then(function () {
        dlg.close();
        $('account-profile').hidden = true;
        $('account-signin').hidden = true;
        $('account-deleted').hidden = false;
      }).catch(function (e) {
        final.textContent = 'Delete everything';
        final.disabled = false;
        $('delete-error').textContent = e.message;
        $('delete-error').hidden = false;
      });
    });
  });
})();
