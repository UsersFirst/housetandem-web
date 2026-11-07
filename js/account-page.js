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
      g.stats.forEach(function (s) { $(g.game + '-' + s[0]).textContent = String(stats[s[0]] || 0); });
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

  function renderGames() {
    var gamesP = A.games().catch(function () { return {}; });
    GAMES.forEach(function (g) { renderGame(g, gamesP); });
  }
  var serverState = null;

  /** The House Tandem Discord: a member tick, or the invite. Hidden without Discord linked. */
  function checkServer() {
    A.discordMembership().then(function (d) {
      var box = $('account-server');
      if (!d || d.__status !== 200 || !d.linked) { box.hidden = true; return; }
      serverState = d.member;
      if (d.invite) $('account-server-join').href = d.invite;
      $('account-server-member').hidden = d.member !== true;
      $('account-server-not').hidden = d.member !== false;
      $('account-server-join').hidden = d.member === true;
      box.hidden = false;
    }).catch(function () {});
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

    if (me) {
      var best = (me.bestScores || []);
      var rides = best.reduce(function (n, b) { return n + (b.rides || 0); }, 0);
      var grandma = best.filter(function (b) { return b.level_id === 'grandma'; })[0];
      $('stat-rides').textContent = String(rides);
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

    $('account-discord-btn').addEventListener('click', function () { go(this, A.signInWithDiscord); });
    $('account-steam-btn').addEventListener('click', function () { go(this, A.signInWithSteam); });
    $('account-signout').addEventListener('click', function () {
      A.signOut();
      render(null);
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
