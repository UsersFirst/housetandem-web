// account.html: sign in with Discord, then the account's pictures, linked
// sign-ins and Tandemonium record. Needs js/ht-account.js first.
(function () {
  var A = window.HTAccount;
  var $ = function (id) { return document.getElementById(id); };

  function fmtTime(ms) {
    if (!ms) return '–';
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
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
      li.textContent = pair[1] + (linked ? ' · ' + (ids[pair[0]].name || 'linked') : ' · not linked');
      return li;
    });
    $('account-identities').replaceChildren.apply($('account-identities'), rows);
    $('account-steam-note').hidden = !!ids.steam;

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
    if (A.signedIn) A.refresh().then(render);

    $('account-discord-btn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      $('account-error').hidden = true;
      A.signInWithDiscord().catch(function (e) {
        btn.disabled = false;
        $('account-error').textContent = e.message;
        $('account-error').hidden = false;
      });
    });
    $('account-signout').addEventListener('click', function () {
      A.signOut();
      render(null);
    });
  });
})();
