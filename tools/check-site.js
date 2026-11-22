// After a deploy: the main pages answer, the security headers are there, and private files are not.
//   node tools/check-site.js https://housetandem.com
const base = (process.argv[2] || '').replace(/\/$/, '');
const OK = ['/', '/about', '/account', '/privacy', '/tos', '/support', '/press', '/tandemonium/', '/tt/', '/js/ht-account.js', '/css/style.css'];
const GONE = ['/package.json', '/README.md', '/tools/links.json', '/docs/analytics-and-promotion-plan.md', '/wrangler.jsonc'];
const HEADERS = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security'];

(async () => {
  if (!/^https:\/\//.test(base)) throw new Error('Usage: node tools/check-site.js <https address>');
  const bad = [];
  const get = async (p) => {
    for (let i = 0; ; i++) {
      try { return await fetch(base + p, { redirect: 'follow', signal: AbortSignal.timeout(10000) }); }
      catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 3000)); }
    }
  };
  for (const p of OK) { const r = await get(p); if (r.status !== 200) bad.push(`${p}: ${r.status}`); }
  for (const p of GONE) { const r = await get(p); if (r.status !== 404) bad.push(`${p} should be 404: ${r.status}`); }
  const home = await get('/');
  for (const h of HEADERS) if (!home.headers.get(h)) bad.push(`missing header: ${h}`);
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`${base}: ${OK.length} pages, ${GONE.length} private paths and ${HEADERS.length} headers OK`);
})().catch((e) => { console.error(e); process.exit(1); });
