// e.housetandem.com: first-party proxy for PostHog (US cloud), shared by every House Tandem site and game.
// Requests to our own domain get past ad blockers, and Discord Activities can reach it through their URL mapping.
//   /static/*  → PostHog's asset CDN (the SDK script), cached at the edge
//   /geo       → { country, eu } for the games' EU consent prompt (no cookies, nothing stored)
//   everything else → PostHog's ingestion API

const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

// EU + EEA, plus the UK and Switzerland, which have equivalent consent rules.
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

export function geoResponse(country) {
  const c = (country || '').toUpperCase();
  return new Response(JSON.stringify({ country: c || null, eu: CONSENT_COUNTRIES.has(c) }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

async function fromAssets(request, path, ctx) {
  const cache = caches.default;
  let res = await cache.match(request);
  if (!res) {
    res = await fetch(`https://${ASSET_HOST}${path}`);
    if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
  }
  return res;
}

function toApi(request, path) {
  const fwd = new Request(`https://${API_HOST}${path}`, request);
  fwd.headers.delete('cookie');
  // Lets PostHog resolve the country; the project discards the IP itself.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) fwd.headers.set('x-forwarded-for', ip);
  return fetch(fwd);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    if (url.pathname === '/geo') return geoResponse(request.cf && request.cf.country);
    if (url.pathname.startsWith('/static/')) return fromAssets(request, path, ctx);
    return toApi(request, path);
  },
};
