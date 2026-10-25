// House Tandem analytics: a tiny PostHog loader shared by every House Tandem site and game.
// Copy this file as-is. Configure it per property with window.HT_ANALYTICS (see js/ht-config.js).
//
//   window.HT_ANALYTICS = { key, game, platform?, build?, host?, cookieless? }
//   HT.track(name, props)    send an event (queued until PostHog loads; dropped if opted out)
//   HT.optOut() / HT.optIn() / HT.isOptedOut()
//
// Links: <a data-ht="wishlist:hero"> or <a data-ht="play:dice">. On load, the link gets UTM tags
// (so Steam's UTM report sees them), and clicking it sends wishlist_click / play_click.
(function () {
  'use strict';
  var cfg = window.HT_ANALYTICS || {};
  var HOST = cfg.host || 'https://e.housetandem.com';
  var STEAM = /(^|\.)steampowered\.com$/;
  var queue = [];
  var ph = null;

  function ls(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: treat as unset */ }
    return null;
  }

  var params = new URLSearchParams(location.search);
  // ?internal=1 marks this browser as dev/test traffic (filtered out in PostHog); ?internal=0 clears it.
  if (params.get('internal') === '1') ls('ht_internal', '1');
  if (params.get('internal') === '0') ls('ht_internal', null);
  var internal = ls('ht_internal') === '1';

  // Where this visit came from, for tagging outbound links. Read from the landing URL only; not stored.
  var incoming = params.get('utm_source') || 'direct';

  function isOptedOut() {
    return ls('ht_optout') === '1' || navigator.globalPrivacyControl === true;
  }

  function track(name, props) {
    if (!cfg.key || isOptedOut()) return;
    if (ph) ph.capture(name, props || {});
    else queue.push([name, props || {}]);
  }

  function tagLink(a, kind, placement) {
    var url;
    try { url = new URL(a.href); } catch (e) { return; }
    if (url.origin === location.origin) return;
    url.searchParams.set('utm_source', 'housetandem');
    url.searchParams.set('utm_medium', placement || kind);
    url.searchParams.set('utm_campaign', incoming);
    a.href = url.toString();
  }

  function wireLinks() {
    var links = document.querySelectorAll('a[data-ht]');
    for (var i = 0; i < links.length; i++) {
      var parts = links[i].getAttribute('data-ht').split(':');
      tagLink(links[i], parts[0], parts[1]);
    }
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[data-ht]');
      if (!a) return;
      var parts = a.getAttribute('data-ht').split(':');
      var host = '';
      try { host = new URL(a.href).hostname; } catch (e) { /* ignore */ }
      track(parts[0] + '_click', {
        placement: parts[1] || null,
        target: STEAM.test(host) ? 'steam' : host,
        incoming_source: incoming,
      });
    }, true);
  }

  window.HT = {
    track: track,
    isOptedOut: isOptedOut,
    // track() checks the flag on every call, so opting out takes effect immediately.
    optOut: function () { ls('ht_optout', '1'); },
    optIn: function () { ls('ht_optout', null); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireLinks);
  else wireLinks();

  if (!cfg.key || isOptedOut()) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = HOST + '/static/array.js';
  s.onload = function () {
    if (!window.posthog || !window.posthog.init) return;
    window.posthog.init(cfg.key, Object.assign({
      api_host: HOST,
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      cookieless_mode: cfg.cookieless || 'always',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      loaded: function (p) {
        ph = p;
        p.register({
          game: cfg.game || 'site',
          platform: cfg.platform || 'web',
          build: cfg.build || null,
          internal: internal,
        });
        p.capture('$pageview');
        for (var i = 0; i < queue.length; i++) p.capture(queue[i][0], queue[i][1]);
        queue = [];
      },
    }, cfg.options)); // cfg.options: extra PostHog settings for one property (e.g. { debug: true })
  };
  document.head.appendChild(s);
})();
