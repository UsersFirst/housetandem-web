// Trace the House Tandem logo into SVG: one mask per colour, potrace each,
// "TANDEM" gets a gradient sampled from the original.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Potrace } = require('potrace');

const W = 2130, H = 988;            // 2x crop of the logo (crop 1065x494 @ 98,402)
const rgb = fs.readFileSync(path.join(__dirname, 'logo.rgb'));
const TEXT_Y0 = 560, TEXT_Y1 = 840; // HOUSE TANDEM band; above = icon, below = tagline

function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function classify(x, y, r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 110) return null;                       // background / outer anti-alias
  const white = mn / mx > 0.72;
  const h = hue(r, g, b);
  if (y >= TEXT_Y0 && y < TEXT_Y1) return white ? 'house' : 'tandem';
  if (white) return null;
  if (h >= 90 && h < 170) return 'green';
  if (h >= 170 && h < 203) return 'cyan';
  if (h >= 203 && h < 245) return 'blue';
  if (h >= 245 && h < 320) return 'purple';
  return null;
}

const classes = ['green', 'cyan', 'blue', 'purple', 'house', 'tandem'];
const masks = {}, sums = {};
for (const c of classes) { masks[c] = Buffer.alloc(W * H, 255); sums[c] = [0, 0, 0, 0]; }
let tminX = W, tmaxX = 0;
const cols = new Map();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
  const c = classify(x, y, r, g, b);
  if (!c) continue;
  masks[c][y * W + x] = 0;
  if (Math.max(r, g, b) > 190) { const s = sums[c]; s[0] += r; s[1] += g; s[2] += b; s[3]++; }
  if (c === 'tandem') {
    tminX = Math.min(tminX, x); tmaxX = Math.max(tmaxX, x);
    const k = Math.floor(x / 16); const a = cols.get(k) || [0, 0, 0, 0];
    a[0] += r; a[1] += g; a[2] += b; a[3]++; cols.set(k, a);
  }
}
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const fills = {};
for (const c of classes) { const s = sums[c]; fills[c] = s[3] ? hex(s[0] / s[3], s[1] / s[3], s[2] / s[3]) : '#fff'; }

// Gradient stops across TANDEM: 6 evenly spaced samples
const stops = [];
for (let i = 0; i <= 5; i++) {
  const x = tminX + (tmaxX - tminX) * i / 5;
  let best = null, bd = 1e9;
  for (const [k, a] of cols) { const d = Math.abs(k * 16 + 8 - x); if (d < bd && a[3] > 20) { bd = d; best = a; } }
  stops.push({ off: i / 5, col: hex(best[0] / best[3], best[1] / best[3], best[2] / best[3]) });
}

async function trace(c) {
  const img = new Jimp(W, H, 0xffffffff);
  for (let i = 0; i < W * H; i++) { const v = masks[c][i]; const o = i * 4; img.bitmap.data[o] = v; img.bitmap.data[o + 1] = v; img.bitmap.data[o + 2] = v; img.bitmap.data[o + 3] = 255; }
  const p = new Potrace({ turdSize: 20, optTolerance: 0.4, alphaMax: 1.0, threshold: 128, blackOnWhite: true });
  await new Promise((res, rej) => p.loadImage(img, e => (e ? rej(e) : res())));
  return p.getPathTag(c === 'tandem' ? 'url(#ht-tandem)' : fills[c]);
}

(async () => {
  const paths = {};
  for (const c of classes) paths[c] = await trace(c);
  fs.writeFileSync(path.join(__dirname, 'parts.json'), JSON.stringify({ W, H, fills, stops, tminX, tmaxX, paths, TEXT_Y0, TEXT_Y1 }));
  console.log('fills', fills);
  console.log('stops', stops.map(s => s.col).join(' '), 'x', tminX, tmaxX);
  for (const c of classes) console.log(c, paths[c].length, 'chars');
})();
