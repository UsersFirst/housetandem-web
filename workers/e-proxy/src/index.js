// e.housetandem.com: first-party proxy for PostHog (US cloud), shared by every House Tandem site and game.
// Requests to our own domain get past ad blockers, and Discord Activities can reach it through their URL mapping.
//   /static/*  → PostHog's asset CDN (the SDK's extra scripts), cached at the edge
//   /geo       → { country, eu } for the games' EU consent prompt (no cookies, nothing stored)
//   the SDK's own ingestion paths → PostHog's ingestion API
// Nothing else is forwarded: it carries what the analytics SDK sends, and is not a way to reach
// the rest of PostHog through our domain.

const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

// EU + EEA, plus the UK and Switzerland, which have equivalent consent rules.
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

// What the SDK calls: events, batches, flags and remote config, session data, surveys.
const INGEST_PATHS = /^\/(e|i|s|batch|capture|decide|flags|engage|track|array|config|surveys)(\/|$)/;
const INGEST_METHODS = new Set(['GET', 'POST', 'OPTIONS']);
// The request headers the SDK's calls need. Credentials of any kind are never passed on.
const FORWARD_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'content-type', 'content-encoding', 'origin', 'referer', 'user-agent',
  'access-control-request-method', 'access-control-request-headers'];
const MAX_BODY_BYTES = 1024 * 1024;

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

/** May this request go on to PostHog's ingestion API? */
export function forwardable(method, pathname) {
  return INGEST_METHODS.has(method) && INGEST_PATHS.test(pathname);
}

/** The headers passed on: a fixed list, so no cookie, Authorization or other credential travels. */
export function forwardHeaders(headers, ip) {
  const out = new Headers();
  for (const name of FORWARD_HEADERS) {
    const v = headers.get(name);
    if (v) out.set(name, v);
  }
  // Lets PostHog resolve the country; the project discards the IP itself.
  if (ip) out.set('x-forwarded-for', ip);
  return out;
}

async function fromAssets(request, path, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const cache = caches.default;
  let res = await cache.match(request);
  if (!res) {
    res = await fetch(`https://${ASSET_HOST}${path}`);
    if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
  }
  return res;
}

function toApi(request, path) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
  const hasBody = request.method === 'POST';
  return fetch(`https://${API_HOST}${path}`, {
    method: request.method,
    headers: forwardHeaders(request.headers, request.headers.get('cf-connecting-ip')),
    body: hasBody ? request.body : undefined,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    if (url.pathname === '/geo') return geoResponse(request.cf && request.cf.country);
    if (url.pathname.startsWith('/static/')) return fromAssets(request, path, ctx);
    if (!forwardable(request.method, url.pathname)) return new Response('Not found', { status: 404 });
    return toApi(request, path);
  },
};
