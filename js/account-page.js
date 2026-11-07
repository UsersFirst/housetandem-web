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
  var DICE_DEFS = 'https://dice.housetandem.com/api/achievements';

  /** The 7, 11, Doubles card: the game's own badge list, lit for the ones this account earned. */
  function renderDice() {
    var defsP = fetch(DICE_DEFS).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([defsP, A.games().catch(function () { return {}; })]).then(function (res) {
      var raw = res[0];
      var defs = Array.isArray(raw) ? raw : (raw && raw.achievements) || [];
      if (!defs.length) return;
      var dice = (res[1] && res[1].dice) || { earned: [], stats: {} };
      var have = {};
      (dice.earned || []).forEach(function (e) { have[e.id] = e.earnedAt || true; });
      var stats = dice.stats || {};
      $('dice-rolls').textContent = String(stats.rolls || 0);
      $('dice-wins').textContent = String(stats.wins || 0);
      $('dice-ach').textContent = defs.filter(function (d) { return have[d.id]; }).length + '/' + defs.length;
      $('dice-badges').replaceChildren.apply($('dice-badges'), defs.map(function (d) {
        var li = document.createElement('li');
        li.className = have[d.id] ? 'earned' : 'locked';
        li.title = d.name + ': ' + (d.description || '') + (have[d.id] ? '' : ' (not yet)');
        var icon = document.createElement('span');
        icon.className = 'badge-icon';
        icon.textContent = d.icon || '🎲';
        var name = document.createElement('span');
        name.className = 'badge-name';
        name.textContent = d.name;
        li.appendChild(icon);
        li.appendChild(name);
        return li;
      }));
      $('account-dice').hidden = false;
    });
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
    if (A.signedIn) A.refresh().then(function (me) { lastMe = me; render(me); checkServer(); renderDice(); });
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
