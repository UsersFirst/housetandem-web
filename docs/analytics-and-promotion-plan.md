# House Tandem — Analytics & Promotion Plan

Draft, 2026-10-25 — decisions confirmed by Pete 2026-10-25. Covers housetandem.com, Tandemonium (web + Steam), Timber Tandem, the Discord Activities (roulette, dice, coins), and SandHands.
No dates. Each phase is a gate, and tracks marked ∥ run in parallel.

## 0. Where we are today (surveyed)

| Property | Analytics today |
|---|---|
| housetandem.com (GitHub Pages, static) | **None.** No GA, no Cloudflare beacon, nothing. |
| Tandemonium web + Steam (Electron) | Custom first-party pipeline: `js/analytics.js` → `tandemonium-api` worker → D1 (`sessions`, `events`, `rides`, `ride_events`, `rooms`, `conversions`), ~80 event names, persistent `device_id`, a Google-sign-in dashboard at `/dashboard/`, and Cloudflare Analytics Engine metrics. **No UTM capture**, only `document.referrer`. |
| Timber Tandem, roulette, dice, coins, SandHands | **None.** The Activity privacy pages promise "no analytics". |
| Steam store | Steamworks UTM traffic report is available. No inbound link uses UTMs yet. |

Nothing ever had Google Analytics. Each game was built on its own, and Tandemonium got its own D1 pipeline instead.

Problems that the "6 reels a day" idea makes urgent:
1. A visit can't be followed from site → game. They are on different domains (`housetandem.com` → `tandemonium.jimandi.love`) with different ID schemes.
2. There's no source attribution: no UTMs, no bio short-links, and Steam links have no tags.
3. Five of six games are blind.
4. `privacy.html` is out of date. It says "random session ID… no tracking", but the game stores a persistent `device_id` (0008) and the raw IP address (0007).

## 1. Decisions (recommended — Pete may override)

**D1. PostHog Cloud (US) as the single event pipeline for all House Tandem properties.** One project, "House Tandem", plus a `game` property on every event. This is what makes the site → game → wishlist funnel and cross-game comparisons possible. The free tier (1M events/mo, verify current allowances at sign-up) covers this scale. Set a billing limit of $0 so it can never bill.

**D2. Don't add Google Analytics 4.** PostHog Web Analytics already gives the GA-style dashboard (visitors, referrers, UTMs, top pages). GA4 would add a second tool, a cookie-consent problem, and heavy ad-blocker loss, and it's weak for in-game funnels. Revisit only if we run **Google Ads**, which need the Google tag for conversion import.

**D3. Keep D1 for game *state*; move *telemetry* to PostHog gradually.** Leaderboards, scores, daily results, pairs, ghosts and achievements stay in D1, because the game reads them. The analytics tables keep receiving events alongside PostHog until the PostHog dashboards cover what `/dashboard/` shows today. Then the D1 analytics writes stop and the tables are archived. The custom dashboard is not deleted on day one.

**D4. Proxy PostHog through our own subdomain** (`e.housetandem.com`, a small Cloudflare Worker, the setup PostHog documents). Why:
- it recovers the ~20–40% of browser traffic that ad blockers drop
- **Discord Activities require it**: they can only reach external hosts through Discord's URL-mapping proxy
- one endpoint for every game.

**D5. Privacy posture:**
- **housetandem.com** uses `cookieless_mode: "always"`. It needs no banner, and site stats don't need returning-user identity.
- **Games** use the existing `device_id` as the PostHog `distinct_id` (localStorage), which keeps D1/D7 retention working.
- Stop storing raw IPs. PostHog "discard client IP" is on. D1 `ip_address` is dropped once the dev-exclusion moves to an `internal` flag.
- Rewrite `privacy.html` to match what we actually collect, and link it from every game.
- **EU (decided):** consent prompt with opt-out for EU players in the games. localStorage IDs count as cookies under ePrivacy rules, so PostHog starts in `cookieless_mode: "on_reject"` for EU visitors and only stores `device_id` after Accept; everyone else gets a one-line notice plus an opt-out toggle in Options.

**D6. Move the game to `tandemonium.housetandem.com` (decided).** A shared root domain makes the site → game hand-off trivial and matches the rebrand. Keep `tandemonium.jimandi.love` as a path-preserving redirect (like `lab.usersfirst.games`). Also update the worker CORS origin and Google sign-in origins. Note: localStorage is per-origin, so existing players get a new `device_id` on the new domain; accept that small retention break rather than migrate.

**D7. No session replay for now.** The site runs cookieless (no client session ID, so no replay), and replay of a WebGL canvas is mostly blank frames. Revisit only for a specific UX question.

## 2. Shared event schema (all games)

These **super-properties** go on every event: `game` (`site|tandemonium|timber|roulette|dice|coins|sandhands`), `platform` (`web|steam|discord|phone|quest`), `build` (the sha from `version.json`), `is_demo`, `internal` (dev traffic).

**Core funnel** (same name in every game, so one funnel template works for all):

| Event | Meaning | Tandemonium today |
|---|---|---|
| `$pageview` (site) | landed on housetandem.com | — |
| `play_click` | clicked a game card / Play | — (new, site) |
| `wishlist_click` | outbound to Steam | `conversions.wishlist_click` |
| `game_session_start` | game booted | `initSession` |
| `input_ready` | controller connected / gyro granted / phone paired | `controller_connect`, `first_input` |
| `room_create` / `room_join` | multiplayer room | same |
| `coop_paired` | ≥2 players actually active | `stoker_joined` (+ time-to-pair) |
| `run_start` / `run_complete` | one round/ride | `startRide` / `endRide` |
| `invite_click` | shared a room link (viral loop) | same |

Game-specific events keep their current names (Tandemonium's ~80), prefixed only when ambiguous. The setup-friction funnel (`game_session_start → input_ready → coop_paired → run_complete`) is the most important one for motion/co-op games. It answers "do social visitors get past setup?"

Viral coefficient = `room_join` per `room_create`, broken down by `$initial_utm_source`.

## 3. Attribution plumbing

**Bio short-links.** housetandem.com is static GitHub Pages and DNS-only, so there are no server redirects. Use tiny static redirect pages, generated from one `links.json` by `tools/build-links.js`:

```
/tt  → /?utm_source=tiktok&utm_medium=bio
/ig  → /?utm_source=instagram&utm_medium=bio
/yt  → /?utm_source=youtube&utm_medium=shorts
/x   → /?utm_source=x&utm_medium=bio
/dc  → /?utm_source=discord&utm_medium=server
/qr  → /?utm_source=qr&utm_medium=event      (stickers, GDEX, COGG)
/crash, /goosedown, …  → per-video vanity slugs (utm_campaign=<slug>)
```
Each page fires a PostHog pageview and then does `location.replace`. If clicks show up there but not on `/`, the redirect is losing visitors.

**Site → game hand-off.** Every game link on housetandem.com appends the PostHog distinct/session IDs plus the UTMs (posthog-js cross-domain bootstrap). The game reads them on boot, so the funnel joins across domains. If D6 is done, this is just for safety.

**Steam links tagged everywhere:** `?utm_source=<site|tandemonium_web|tandemonium_demo|discord>&utm_medium=<placement>&utm_campaign=<incoming utm_source or 'direct'>`. Passing the *incoming* source through means Steamworks' UTM report shows "TikTok → site → Steam wishlist".

**Codes in videos** (optional test): a code shown on screen ("type CRASH in the lobby") → `promo_code_entered`. Only build this if bio-link attribution turns out too coarse.

## 4. Phases

### Phase 1 — Foundation (small) ∥ can start now
1. Create the PostHog org/project, set the $0 billing limit, turn on IP discard, add an `internal` filter.
2. Deploy the `e.housetandem.com` proxy worker.
3. Shared snippet `js/ht-analytics.js` (copy-in, tiny): init + super-props + `internal` flag via `?internal=1` (stored).
4. housetandem.com: snippet (cookieless), `play_click` / `wishlist_click`, UTM-tagged Steam links, and the `/tt /ig /yt /x /dc /qr` pages.
5. Rewrite `privacy.html`.

**Gate:** your own phone visit via `/tt` shows in PostHog with `utm_source=tiktok` and an ad-blocker-on visit still records.

### Phase 2 — Tandemonium dual-write (small–medium) ∥ with Phase 1 step 4
0. Move the game to `tandemonium.housetandem.com` (DNS + Pages CNAME, jimandi.love redirect, worker CORS, Google sign-in origins, Steam/Electron build URL if it loads remotely). Smoke test on the new domain.
1. `analytics.js` gains a PostHog sink. The `beacon()` path is unchanged, so D1 keeps filling.
2. Map the existing calls onto the core names (§2) and pass everything else through as-is.
3. Read UTMs and site-handoff IDs on boot and store them on the session (also send `utm_*` to D1 so the old dashboard sees them).
4. Steam/Electron: `platform=steam`, `is_demo` from `edition.js`.
5. Build the PostHog dashboard to match `/dashboard/`: funnel, retention D1/D7, rides, crashes, conversions, devices, pairs.
6. Tests: unit test that every `trackEvent` reaches both sinks, and a smoke check that the PostHog request fires (mocked endpoint).

**Gate:** a week of numbers where PostHog and D1 agree within a few % on sessions/rides. Then stop the D1 analytics writes, drop `ip_address`, and freeze `/dashboard/` as read-only history.

### Phase 3 — Other games (small each, all ∥)
- Timber Tandem, SandHands: snippet plus core events.
- Discord Activities: core events via the Discord URL mapping (`/e` → `e.housetandem.com`), `platform=discord`, no Discord user ID sent. **Update their privacy pages first**, because they currently promise no analytics.

**Gate:** one cross-game "setup funnel" dashboard with a `game` breakdown.

### Phase 4 — Promotion pipeline (∥ with everything above)
The pipeline already exists in parts: the achievement-reel plan (one reel per achievement, end card + Steam link), the trailer tools in `tandemonium-trailers`, and the bot-driven capture in `scripts/reel`.

1. **Buckets, not bespoke edits.** Daily slots come from repeatable templates:
   - chaos/crash clips (hidden Chaos achievements are the best ones)
   - split-screen hands + gameplay (explains the motion controls in 2 s)
   - achievement reels ("N of 100")
   - (no devlogs here — devlogs belong to Users First, if/when that happens)
   - hook test: same clip, different first-1.5 s text
2. **Cadence: start at 1–2/day and earn the way to 6.** Six a day is 180 a month. That volume only makes sense once a batch render (one command → N vertical clips with captions + end card) exists and the data shows which bucket wins. The blocker was "what to post" and "posting into silence", so a steady 1–2 with measured results beats 6 with no signal.
3. **Scheduler (decided): Buffer to start.** Hosted, no server. Re-evaluate Postiz (self-hosted, API) once the batch render exists and uploading by API would save real time.
4. **Weekly review** (one PostHog dashboard + the scheduler's stats):
   - views → 3-s hold → bio-link clicks (`/tt` etc.)
   - site → `play_click` / `wishlist_click`
   - game setup funnel
   - Steamworks UTM wishlists

   Kill buckets that don't move clicks, and double the ones that do.

**Gate to scale cadence:** the batch render produces a week of clips in one sitting, and at least one bucket shows bio-link clicks above the baseline.

## 5. Not doing (and why)
- **RB2B / Snitcher / reverse-IP:** B2B tools. Consumer traffic is residential/mobile, so they would identify nothing.
- **GA4:** see D2.
- **Umami/Plausible:** fine tools, but they cover website analytics only. We'd still need PostHog for games, so they add a second system.
- **Frame-level telemetry:** stays out. The existing `ride_perf` summary is enough.

## 6. Decisions (Pete, 2026-10-25)
1. **Domain:** move the game to `tandemonium.housetandem.com` (D6). Do this in Phase 2, before Tandemonium starts sending to PostHog, so the new domain is the one in the data.
2. **EU:** consent prompt with opt-out for EU players; a notice plus an opt-out for everyone else (D5).
3. **Scheduler:** Buffer first; Postiz later if uploading by API pays off.
4. **Handles — recommended:** one studio account, **`@housetandem`**, on TikTok, Instagram, YouTube and X. All bio links go to `housetandem.com/<platform>`, and each video's end card names the game ("Tandemonium — wishlist on Steam").
   - *Why one account:* six games and 1–6 posts a day would split into tiny audiences across six accounts, and you can't keep six alive. One account collects every follower, and the bio-link UTMs plus `utm_campaign` per video still say which game converted.
   - *Reserve, don't post:* register `@tandemonium` (or `@tandemoniumgame`) on each platform so nobody takes it. Revisit a game-only account if Tandemonium clips clearly out-perform everything else once there's data.
   - The existing unused X account and r/Tandemonium stay. Point the X bio at `housetandem.com/x`, or rename it to `@housetandem` if it's empty.
