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


## Analytics

Plan: [`docs/analytics-and-promotion-plan.md`](docs/analytics-and-promotion-plan.md).

- `js/ht-analytics.js` is the shared PostHog loader for every House Tandem site and game (copy it as-is). `js/ht-config.js` holds the project key. While the key is empty, nothing loads.
- The site runs PostHog in cookieless mode: no cookies or local storage. The PostHog project must have **cookieless server hash mode** enabled, or these events are dropped.
- Tag outbound links with `data-ht="wishlist:<placement>"` or `data-ht="play:<game>"`. They get UTM tags (`utm_source=housetandem`, `utm_medium=<placement>`, `utm_campaign=<the visitor's own utm_source>`) and send `wishlist_click` / `play_click`.
- Add `?internal=1` to any URL once to mark your browser as test traffic (`?internal=0` clears it). Global Privacy Control and the opt-out button on `privacy.html` turn analytics off.
- `workers/e-proxy` is the first-party PostHog proxy at **e.housetandem.com** (`npm run deploy:proxy`). It also serves `/geo` → `{country, eu}` for the games' EU consent prompt.

## Short links

`housetandem.com/tt`, `/ig`, `/yt`, `/x`, `/dc`, `/qr` redirect to the home page with UTM tags, for social bios and QR codes. Add one in `tools/links.json`, then run `npm run links` and commit the generated `<slug>/index.html`. CI fails if they're out of date (`npm run check:links`).

`npm test` runs the unit tests.

## Logo files

`images/logos/` has the House Tandem logo as SVG (traced) and PNG. The SVGs were traced from Pete's raster logo with `tools/trace.js`, one colour mask per brand colour, with "TANDEM" filled by a gradient. `tools/build.js` then assembles the variants: full, light, dark, mark, square icon, favicon, wordmark and horizontal lockup. To re-run them, `npm i potrace@2.1.8` in a scratch folder and see the comments in the scripts.
