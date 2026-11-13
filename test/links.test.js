const test = require('node:test');
const assert = require('node:assert');
const { targetUrl, page, PASS_THROUGH } = require('../tools/build-links.js');
const { links } = require('../tools/links.json');

test('bio links carry source, medium and the slug as campaign', () => {
  assert.strictEqual(targetUrl('tt', links.tt), '/account.html?utm_source=tiktok&utm_medium=bio&utm_campaign=tt');
  assert.strictEqual(targetUrl('yt', links.yt), '/account.html?utm_source=youtube&utm_medium=shorts&utm_campaign=yt');
});

test('an explicit campaign wins over the slug', () => {
  assert.match(targetUrl('crash', { to: '/', utm_source: 'tiktok', utm_campaign: 'goose_down' }), /utm_campaign=goose_down/);
});

test('redirect page works without JS and is not indexed', () => {
  const html = page('ig', links.ig);
  assert.match(html, /http-equiv="refresh" content="0; url=\/account\.html\?utm_source=instagram/);
  assert.match(html, /name="robots" content="noindex"/);
});

test('/discord forwards to the invite as it is, so it can be swapped in one place', () => {
  assert.strictEqual(targetUrl('discord', links.discord), links.discord.to);
  assert.match(links.discord.to, /^https:\/\/discord\.gg\/[A-Za-z0-9]+$/);
  const html = page('discord', links.discord);
  assert.ok(html.includes('content="0; url=' + links.discord.to + '"'));
  assert.ok(html.includes('location.replace("' + links.discord.to + '");'));
  assert.match(html, /name="robots" content="noindex"/);
});

// Runs a short link's redirect script against a landing URL and returns where it sends you.
function redirectFrom(slug, landing) {
  const html = page(slug, links[slug]);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const loc = new URL(landing);
  let went = null;
  const location = { search: loc.search, hash: loc.hash, href: loc.href, replace: (u) => { went = u; } };
  new Function('location', 'URL', 'URLSearchParams', script)(location, URL, URLSearchParams);
  return went;
}

test('?server= on a short link becomes utm_content, so a share can name its Discord server', () => {
  assert.strictEqual(redirectFrom('dc', 'https://housetandem.com/dc?server=cogg'), '/?utm_source=discord&utm_medium=server&utm_campaign=dc&utm_content=cogg');
  assert.strictEqual(redirectFrom('dc', 'https://housetandem.com/dc/'), '/?utm_source=discord&utm_medium=server&utm_campaign=dc');
});

test('a short link keeps its own tags and passes on only utm_* (no other parameters)', () => {
  assert.strictEqual(redirectFrom('dc', 'https://housetandem.com/dc?utm_source=evil&utm_term=x&foo=1#play'), '/?utm_source=discord&utm_medium=server&utm_campaign=dc&utm_term=x#play');
});
