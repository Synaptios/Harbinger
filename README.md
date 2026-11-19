# Harbinger

Harbinger is a local interactive story. **The Bread Ledger** follows a London clerk during the succession crisis in Malory’s *Le Morte Darthur*. Start with the authored route through Alice’s bakehouse and the Thames landing.

## Run locally

Use Node 24 or later. Run `npm ci` and `npm start`, then open `http://127.0.0.1:4173`. The app saves story progress to SQLite in `.harbinger/`. Set `HARBINGER_PORT` or `HARBINGER_DATABASE_PATH` to use a different local port or save database.

## Verify

Run `npx playwright install chromium` once, then `npm test`. To use a supported installed browser, set `PLAYWRIGHT_CHANNEL` to its Playwright channel, such as `msedge`.

The [architecture proposal](docs/architecture.md) and [research review](docs/research.md) document the setting, viewpoint rules, and planned playtest.
