// housetandem.com/account-delete: delete your data after Steam or Discord confirms it's yours
// (Tandemonium worker/accounts/data-delete.js). An account with both Steam and Discord confirms both.
//
// The delete's id and secret stay in this tab (sessionStorage) while the player signs in on Steam's or
// Discord's own page. They come back with a one-time ticket in the address (#ht_erase=...), which only
// this tab can use: a sign-in link someone else sent can't attach your account to their delete.
(function () {
  'use strict';
  var API = window.HT_API || 'https://api.housetandem.com';
  var KEY = 'ht_erase';
  var NAMES = { steam: 'Steam', discord: 'Discord' };
  var $ = function (id) { return document.getElementById(id); };
  var flow = null;
  var last = null;        // the last status from the API
  var timer = null;

  function readFlow() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function saveFlow(f) {
    flow = f;
    try { if (f) sessionStorage.setItem(KEY, JSON.stringify(f)); else sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function api(path, body) {
    return fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status, code: data.code, data: data });
        return data;
      });
    }, function () { throw new Error("Couldn't reach House Tandem. Check your connection and try again."); });
  }

  // ── what's on screen ──
  var STAGES = ['erase-start', 'erase-review', 'erase-final', 'erase-done', 'erase-stopped'];
  function show(stage) {
    STAGES.forEach(function (s) { $(s).hidden = s !== stage; });
    document.querySelector('.erase-card').classList.toggle('finished', stage === 'erase-done');
    var step = stage === 'erase-start' ? 1 : stage === 'erase-review' ? 2 : stage === 'erase-stopped' ? 0 : 3;
    [1, 2, 3].forEach(function (n) {
      var li = $('erase-p' + n);
      li.classList.toggle('done', n < step || stage === 'erase-done');
      if (n === step && stage !== 'erase-done' && stage !== 'erase-stopped') li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $('erase-page-error').hidden = true;
    var h = $(stage).querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }
  function pageError(msg) {
    var p = $('erase-page-error');
    p.textContent = msg;
    p.hidden = !msg;
  }
  function stopped(title, text) {
    stopTimer();
    saveFlow(null);
    $('erase-stopped-title').textContent = title;
    $('erase-stopped-text').textContent = text;
    show('erase-stopped');
  }
  function gone(e) {
    if (e && (e.code === 'erase_gone' || e.status === 410 && !e.code)) {
      stopped('This delete has expired', 'For your safety a delete stays open for 15 minutes, in the tab that started it. Nothing was deleted.');
      return true;
    }
    return false;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function who(item, extra) {
    var chip = el('span', 'erase-who');
    if (item.avatar && /^https:\/\//.test(item.avatar)) {
      var img = el('img');
      img.src = item.avatar; img.alt = ''; img.width = 28; img.height = 28; img.referrerPolicy = 'no-referrer';
      chip.appendChild(img);
    }
    chip.appendChild(el('span', null, (item.name || 'Unknown') + ' · ' + (NAMES[item.provider] || item.provider)));
    if (extra) chip.appendChild(extra);
    return chip;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function signinButton(provider, label) {
    var b = el('button', 'btn js-erase-signin ' + (provider === 'steam' ? 'account-steam-signin' : 'account-discord'), label);
    b.type = 'button';
    b.dataset.provider = provider;
    return b;
  }

  function render(st) {
    last = st;
    // Confirmed so far
    var conf = $('erase-confirmed');
    conf.textContent = '';
    st.confirmed.forEach(function (c) { conf.appendChild(who(c, el('span', 'erase-tick', '✓ confirmed'))); });

    // What we have
    var found = $('erase-found');
    found.textContent = '';
    st.accounts.forEach(function (a) {
      var card = el('div', 'erase-account');
      card.appendChild(el('p', 'erase-account-name', 'House Tandem account: ' + (a.name || 'Player')));
      var facts = [plural(a.rides, 'Tandemonium ride', 'Tandemonium rides'), plural(a.badges, 'achievement', 'achievements')];
      (a.games || []).forEach(function (g) { facts.push(g.title + (g.badges ? ' (' + plural(g.badges, 'achievement', 'achievements') + ')' : '')); });
      card.appendChild(el('p', 'account-note', facts.join(' · ')));
      var list = el('ul', 'erase-logins');
      a.logins.forEach(function (l) {
        var li = el('li', l.confirmed ? 'ok' : 'todo');
        li.appendChild(el('span', 'erase-mark', l.confirmed ? '✓' : '!'));
        li.appendChild(el('span', null, (NAMES[l.provider] || l.provider) + ': ' + (l.name || '') + (l.confirmed ? ' (confirmed)' : ' (not confirmed yet)')));
        list.appendChild(li);
      });
      card.appendChild(list);
      found.appendChild(card);
    });
    if (st.sessions) {
      var s = el('div', 'erase-account');
      s.appendChild(el('p', 'erase-account-name', plural(st.sessions, 'game session', 'game sessions') + ' recorded with your Steam account'));
      s.appendChild(el('p', 'account-note', 'Their Steam ID, IP address and device ID are removed. They stay only in anonymous totals.'));
      found.appendChild(s);
    }

    // Still to confirm
    var need = st.needed || [];
    $('erase-needed').hidden = !need.length;
    if (need.length) {
      $('erase-needed-list').textContent = need.map(function (l) { return (NAMES[l.provider] || l.provider) + ' (' + (l.name || 'linked account') + ')'; }).join(' and ');
      var btns = $('erase-needed-buttons');
      btns.textContent = '';
      var seen = {};
      need.forEach(function (l) {
        if (seen[l.provider]) return;
        seen[l.provider] = true;
        btns.appendChild(signinButton(l.provider, 'Confirm with ' + NAMES[l.provider]));
      });
    }
    $('erase-nothing').hidden = !st.nothing;
    if (st.nothing) $('erase-nothing-who').textContent = st.confirmed.map(function (c) { return (c.name || 'that account') + ' on ' + (NAMES[c.provider] || c.provider); }).join(' or ');
    var cont = $('erase-continue');
    cont.disabled = !st.ready;
    cont.hidden = !!st.nothing;
    cont.textContent = st.ready ? 'Continue' : need.length ? 'Confirm every sign-in to continue' : 'Continue';
    startTimer(st.expires_in);
  }

  function startTimer(seconds) {
    stopTimer();
    var ends = Date.now() + Math.max(0, seconds || 0) * 1000;
    var tick = function () {
      var left = Math.round((ends - Date.now()) / 1000);
      if (left <= 0) { stopped('This delete has expired', 'For your safety a delete stays open for 15 minutes. Nothing was deleted.'); return; }
      var m = Math.ceil(left / 60);
      $('erase-timer').textContent = 'For your safety this delete stays open for ' + plural(m, 'more minute', 'more minutes') + '.';
    };
    tick();
    timer = setInterval(tick, 15000);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; $('erase-timer').textContent = ''; }

  // ── actions ──
  function signIn(provider, button) {
    if (button) button.disabled = true;
    pageError('');
    var ready = flow ? Promise.resolve(flow) : api('/erase/start', { return_to: location.origin + location.pathname }).then(function (f) {
      saveFlow({ id: f.id, secret: f.secret });
      return flow;
    });
    ready.then(function (f) {
      return api('/erase/signin', { id: f.id, secret: f.secret, provider: provider });
    }).then(function (r) {
      location.assign(r.url);
    }).catch(function (e) {
      if (button) button.disabled = false;
      if (gone(e)) return;
      pageError(e.message);
    });
  }

  function attach(ticket) {
    $('erase-mismatch').hidden = true;
    return api('/erase/attach', { id: flow.id, secret: flow.secret, ticket: ticket }).then(function (st) {
      render(st);
      if (st.matched === false && st.added) {
        var m = $('erase-mismatch');
        var wanted = (st.needed || []).filter(function (l) { return l.provider === st.added.provider; })[0];
        m.textContent = 'You signed in to ' + NAMES[st.added.provider] + ' as ' + (st.added.name || 'another account') +
          (wanted ? ', which isn’t the one on this account. Sign in as ' + (wanted.name || 'the linked account') + ' instead.' : '. That account adds nothing here.');
        m.hidden = false;
      }
      show('erase-review');
    });
  }

  function finalList() {
    var ul = $('erase-final-list');
    ul.textContent = '';
    (last.accounts || []).forEach(function (a) {
      ul.appendChild(el('li', null, 'The House Tandem account ' + (a.name || '') + ' and its sign-ins (' + a.logins.map(function (l) { return NAMES[l.provider] || l.provider; }).join(' and ') + ')'));
      ul.appendChild(el('li', null, plural(a.rides, 'Tandemonium ride', 'Tandemonium rides') + ' and leaderboard times, ' + plural(a.badges, 'achievement', 'achievements') + ', Daily Ride results, stats and time played in every game'));
      ul.appendChild(el('li', null, 'Your records with riding partners and friends'));
    });
    if (last.sessions) ul.appendChild(el('li', null, 'Your Steam ID, IP address and device ID on ' + plural(last.sessions, 'game session', 'game sessions')));
    if (last.guest_records) ul.appendChild(el('li', null, 'Guest records from a computer only your Steam account played on'));
  }

  function wire() {
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.js-erase-signin');
      if (b) { signIn(b.dataset.provider, b); return; }
      if (ev.target.closest && ev.target.closest('.js-erase-cancel')) {
        var f = flow;
        if (f) api('/erase/cancel', { id: f.id, secret: f.secret }).catch(function () {});
        stopped('Nothing was deleted', 'Your data is just as it was.');
        return;
      }
      if (ev.target.closest && ev.target.closest('.js-erase-restart')) { saveFlow(null); show('erase-start'); }
    });
    $('erase-continue').addEventListener('click', function () {
      if (!last || !last.ready) return;
      finalList();
      $('erase-understood').checked = false;
      $('erase-word').value = '';
      $('erase-delete').disabled = true;
      $('erase-error').hidden = true;
      show('erase-final');
    });
    $('erase-back').addEventListener('click', function () { show('erase-review'); });
    var check = function () {
      $('erase-delete').disabled = !($('erase-understood').checked && $('erase-word').value.trim() === 'DELETE');
    };
    $('erase-understood').addEventListener('change', check);
    $('erase-word').addEventListener('input', check);
    $('erase-delete').addEventListener('click', function () {
      var btn = this;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      api('/erase/confirm', { id: flow.id, secret: flow.secret, confirm: 'DELETE', understood: true }).then(function (out) {
        stopTimer();
        saveFlow(null);
        var bits = [];
        if (out.accounts) bits.push(plural(out.accounts, 'account', 'accounts'));
        if (out.rides) bits.push(plural(out.rides, 'ride', 'rides'));
        if (out.achievements) bits.push(plural(out.achievements, 'achievement', 'achievements'));
        if (out.sessions) bits.push('the Steam ID on ' + plural(out.sessions, 'game session', 'game sessions'));
        $('erase-done-text').textContent = (bits.length ? 'Deleted: ' + bits.join(', ') + '. ' : 'Everything we had is gone. ') + 'Thanks for riding with us.';
        show('erase-done');
      }).catch(function (e) {
        btn.textContent = 'Permanently delete';
        if (gone(e)) return;
        if (e.code === 'not_ready' && e.data && e.data.confirmed) {
          // A sign-in was added since: back to review, which shows what's left to confirm.
          render(e.data);
          show('erase-review');
          pageError(e.message);
          return;
        }
        btn.disabled = false;
        $('erase-error').textContent = e.message;
        $('erase-error').hidden = false;
      });
    });
  }

  function boot() {
    wire();
    flow = readFlow();
    // The inline script at the top took #ht_erase=... out of the address before anything else ran.
    var back = window.__htBack && window.__htBack.hash ? new URLSearchParams(window.__htBack.hash.slice(1)) : null;
    var ticket = back && back.get('ht_erase');
    if (ticket) {
      if (!flow) {
        stopped('This sign-in was started somewhere else', 'It came back to a browser or tab that didn’t start this delete, so it was ignored. Nothing was deleted. If you meant to delete your data, start here.');
        return;
      }
      attach(ticket).catch(function (e) {
        if (gone(e)) return;
        // The ticket is used up or old: show where the delete stands.
        return api('/erase/status', flow).then(function (st) {
          render(st); show(st.confirmed.length ? 'erase-review' : 'erase-start'); pageError(e.message);
        }).catch(function (e2) { if (!gone(e2)) { show('erase-start'); pageError(e2.message); } });
      });
      return;
    }
    if (flow) {
      // Back on the page (a reload, or cancelled at Steam or Discord): pick up where it was.
      api('/erase/status', flow).then(function (st) {
        if (st.confirmed.length) { render(st); show('erase-review'); } else show('erase-start');
      }).catch(function (e) { if (!gone(e)) { show('erase-start'); pageError(e.message); } });
      return;
    }
    show('erase-start');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
