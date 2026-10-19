# House Tandem website

The studio site for **House Tandem**, the game studio of Users First, LLC. It's going to live at **https://housetandem.com**.

It's a plain static site (HTML, CSS and a little JS), with no build step. It was seeded from [`games-usersfirst`](https://github.com/UsersFirst/games-usersfirst) (games.usersfirst.com) and rebranded.

## Pages

| Path | What it is |
|---|---|
| `/` | Studio home with all the games |
| `/about.html` | About the studio |
| `/tandemonium/` | Tandemonium playtest and Discord page |
| `/press.html` | Press kit |
| `/support.html` | Support and FAQ |
| `/privacy.html`, `/tos.html` | Privacy policy and terms |

The paths match the old games.usersfirst.com paths on purpose, so a path-preserving redirect from the old domain lands on the same page. The game links to `privacy.html` and `tos.html`. The old `/plan/` roadmap was dropped.

## Run locally

```sh
npx serve .
```

## Deploy

It's served by GitHub Pages from `main` at housetandem.com (`CNAME` file). DNS is on Cloudflare: four A records to GitHub's Pages IPs plus `www` → `usersfirst.github.io`.

## Logo files

`images/logos/` has the House Tandem logo as SVG (traced) and PNG. The SVGs were traced from Pete's raster logo with `tools/trace.js`, one colour mask per brand colour, with "TANDEM" filled by a gradient. `tools/build.js` then assembles the variants: full, light, dark, mark, square icon, favicon, wordmark and horizontal lockup. To re-run them, `npm i potrace@2.1.8` in a scratch folder and see the comments in the scripts.
