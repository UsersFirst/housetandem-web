// Assemble House Tandem SVG logo files from traced parts (parts.json).
const fs = require('fs');
const path = require('path');
const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'parts.json'), 'utf8'));
const out = process.argv[2];

// Clean, hand-picked brand colours (sampled from the artwork, brightest pixels).
const C = { green: '#2ef33c', cyan: '#02c8f9', blue: '#118ae9', purple: '#934ef1', white: '#f7f7f7', ink: '#1b2232' };
const grad = (id, x0, x1) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">
    <stop offset="0" stop-color="#35e04f"/><stop offset="0.42" stop-color="#2fbaeb"/><stop offset="0.68" stop-color="#3b8ee5"/><stop offset="1" stop-color="#8f50ef"/>
  </linearGradient>`;
const pathOf = (k, fill) => P.paths[k].replace(/fill="[^"]*"/, `fill="${fill}"`).replace(/stroke="[^"]*"/, 'stroke="none"');

// Regions in the 2130x988 trace space (2x of the cropped logo).
const R = {
  all:   [0, 0, 2130, 988],
  icon:  [370, 36, 1378, 476],   // x, y, w, h  (382..1736 x 48..500, + pad)
  word:  [36, 648, 2056, 148],   // 48..2080 x 658..786
};

const body = (houseFill, gid) => [
  pathOf('green', C.green), pathOf('cyan', C.cyan), pathOf('blue', C.blue),
  pathOf('purple', C.purple), pathOf('house', houseFill), pathOf('tandem', `url(#${gid})`),
].join('\n  ');

function svg(view, inner, { title, bg, size } = {}) {
  const [x, y, w, h] = view;
  const dims = size ? ` width="${size[0]}" height="${size[1]}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${dims} role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
  ${grad('ht-tandem', P.tminX, P.tmaxX)}
  </defs>
  ${bg ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` : ''}
  ${inner}
</svg>
`;
}

const files = {};
const pad = 30;
const full = [P.tminX > 0 ? 36 : 0, 36, 2058, 916];
files['housetandem-logo.svg'] = svg(full, body(C.white, 'ht-tandem'), { title: 'House Tandem: Move together. Play together.' });
files['housetandem-logo-light.svg'] = svg(full, body(C.ink, 'ht-tandem'), { title: 'House Tandem: Move together. Play together.' });
files['housetandem-logo-dark.svg'] = svg([full[0] - pad, full[1] - pad, full[2] + 2 * pad, full[3] + 2 * pad], body(C.white, 'ht-tandem'), { title: 'House Tandem: Move together. Play together.', bg: '#020209' });

// Mark only: draw just the icon area (clip off text/tagline).
const iconBody = `<g clip-path="url(#ht-icon-clip)">\n  ${[pathOf('green', C.green), pathOf('cyan', C.cyan), pathOf('blue', C.blue), pathOf('purple', C.purple)].join('\n  ')}\n  </g>`;
const iconClip = `<clipPath id="ht-icon-clip"><rect x="${R.icon[0]}" y="${R.icon[1]}" width="${R.icon[2]}" height="${R.icon[3]}"/></clipPath>`;
const withClip = (s) => s.replace('</defs>', `${iconClip}\n  </defs>`);
files['housetandem-mark.svg'] = withClip(svg(R.icon, iconBody, { title: 'House Tandem' }));

// Square icon (dark tile) and favicon (transparent square).
const sq = R.icon[2] * 1.16, cx = R.icon[0] + R.icon[2] / 2, cy = R.icon[1] + R.icon[3] / 2;
const sqView = [cx - sq / 2, cy - sq / 2, sq, sq];
files['housetandem-icon.svg'] = withClip(svg(sqView, iconBody, { title: 'House Tandem', bg: '#0a0a0f' }));
const fav = R.icon[2] * 1.02;
files['favicon.svg'] = withClip(svg([cx - fav / 2, cy - fav / 2, fav, fav], iconBody, { title: 'House Tandem' }));

// Wordmark only (HOUSE TANDEM), light-on-dark and dark-on-light.
const wordBody = (houseFill) => `${pathOf('house', houseFill)}\n  ${pathOf('tandem', 'url(#ht-tandem)')}`;
files['housetandem-wordmark.svg'] = svg(R.word, wordBody(C.white), { title: 'House Tandem' });
files['housetandem-wordmark-light.svg'] = svg(R.word, wordBody(C.ink), { title: 'House Tandem' });

// Horizontal lockup: mark left, wordmark right (for headers).
const markH = 300, markW = R.icon[2] * markH / R.icon[3];
const wordH = 92, wordW = R.word[2] * wordH / R.word[3];
const gap = 70, lockW = markW + gap + wordW;
const nested = (view, inner, x, y, w, h, extraDefs = '') => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${view.join(' ')}">${extraDefs}\n  ${inner}\n  </svg>`;
const lock = (houseFill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockW.toFixed(0)} ${markH}" role="img" aria-label="House Tandem">
  <title>House Tandem</title>
  <defs>
  ${grad('ht-tandem', P.tminX, P.tmaxX)}
  ${iconClip}
  </defs>
  ${nested(R.icon, iconBody, 0, 0, markW.toFixed(1), markH)}
  ${nested(R.word, wordBody(houseFill), (markW + gap).toFixed(1), ((markH - wordH) / 2).toFixed(1), wordW.toFixed(1), wordH)}
</svg>
`;
files['housetandem-lockup.svg'] = lock(C.white);
files['housetandem-lockup-light.svg'] = lock(C.ink);

for (const [n, s] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, n), s);
  console.log(n, (s.length / 1024).toFixed(1) + ' KB');
}
