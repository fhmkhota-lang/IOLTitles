# IOL Titles — Social Card Studio

A standalone social-card studio for Independent Media's 15 print titles, in the
Cape Argus newspaper-card style. Separate from the IOL Cards tool — new repo,
new GitHub Pages site, new Cloudflare Worker. Same tech pattern as IOLCards.

## Files
| File | Purpose |
|------|---------|
| `index.html` | App shell: header, publication picker, search, From-URL, designer overlay |
| `app.js` | Feed, designer, Cape Argus card renderer, carousel/infographic, ticks, share |
| `style.css` | Dark studio chrome + publication-pill picker |
| `worker.js` | Cloudflare Worker: per-title RSS, image/fullimage/shorten/claude proxies |
| `data.js` | Offline fallback sample stories (7 titles), used until the worker is live |
| `logos/` | 15 publication mastheads (`<key>.png`) |

## The 15 titles
Keys: capeargus, capetimes, dailyvoice, dailynews, ios, isolezwe, mercury,
pretorianews, thestar, saturdaystar, sundaytribune, sundayindependent, thepost,
weekendargus, businessreport. Brand colour, city, region and tagline are defined
in the `PUBLICATIONS` array in `app.js`.

## Card design (Cape Argus template)
- **Logo chip** top-left: white rounded chip holding the masthead. Cape Times
  uses a **brand-blue chip** because its masthead is white (`logoBox:'brand'`).
- **Kicker pill**: brand-colour pill, auto-filled from the story's section
  (e.g. NEWS / SPORT / CRIME) but fully editable ("CRIME IN FOCUS" etc.).
- **Headline**: large bold white. Wrap word(s) in `*asterisks*` to colour them
  in the brand colour (like "UGLY AMERICANS" red on the reference). Uppercase
  toggle on by default for the Cape Argus look.
- **Bottom bar**: brand-colour strip with `CITY  |  REGION  |  TAGLINE`.
- **Breaking News** banner uses the publication's brand colour (not fixed red).
- Formats: Square 1080×1080 and Reel/Story 1080×1920. Carousel + Infographic
  modes included.

## RSS feed status (verified 2026-07-11)
Live IOL RSS feeds confirmed for 13 titles. The worker tries slug variants per
title (`iol.co.za/rss/extended/iol/<slug>/`) and returns the first that works:
capeargus, capetimes, dailynews, ios, mercury, sundayindependent, thepost,
the-star, pretoria-news, saturday-star, sunday-tribune, weekend-argus,
business-report.

**Daily Voice** and **Isolezwe** have **no IOL RSS feed** on that path. Their
feed tabs will be empty; make cards for them via **+ From URL** (paste any
article link) or by uploading an image. If a feed source turns up later, add its
slug to `PUBS.dailyvoice` / `PUBS.isolezwe` in `worker.js`.

## Local preview
```
cd IOLTitles-deploy
python3 -m http.server 8848
# open http://localhost:8848/
```
For review, `app.js`'s `WORKER` points at the existing `ioltester` worker so
image/shorten/AI proxies work now; title feeds fall back to `data.js` samples
until the new worker is deployed.

## Deployment (live)
- **Site**: GitHub Pages — `fhmkhota-lang.github.io/IOLTitles/`.
- **Worker**: `ioltitles` at `https://ioltitles.faheem-khota.workers.dev`
  (deployed via wrangler; see `wrangler.toml`). Serves feeds + image/shorten/
  fullimage proxies.
- **AI**: the `/claude` infographic call is routed to the existing `ioltester`
  worker (`AI_WORKER` in `app.js`) which holds the `ANTHROPIC_KEY` secret, so no
  key needs to be duplicated. To make `ioltitles` self-contained instead, set an
  `ANTHROPIC_KEY` secret on it and point `AI_WORKER` back at `WORKER`.
- **Note on account**: the worker is on the Cloudflare account currently logged
  into wrangler (faheem.khota@iol.co.za). The original plan named the personal
  account (fhmkhota@gmail.com, same as `ioltester`); it can be moved there later.
- **Supabase** (`asipandmcgagpswsgbtr`): reuses the existing `done_stories`
   table. Team ticks are written with a `title_` id prefix so they never clash
   with IOL Cards. No schema change required.
