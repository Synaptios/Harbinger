# Harbinger

Harbinger is a local interactive story. **The Bread Ledger** follows a London clerk during the succession crisis in Malory’s *Le Morte Darthur*. Start with the authored route through Alice’s bakehouse and the Thames landing.

## Run locally

Use Node 24 or later. Run `npm ci` and `npm start`, then open `http://127.0.0.1:4173`. The app saves story progress to SQLite in `.harbinger/`. Set `HARBINGER_PORT` or `HARBINGER_DATABASE_PATH` to use a different local port or save database.

## Verify

Run `npx playwright install chromium` once, then `npm test`. To use a supported installed browser, set `PLAYWRIGHT_CHANNEL` to its Playwright channel, such as `msedge`.

For model-enabled free text, set `HARBINGER_MODEL_URL` to an OpenAI-compatible Chat Completions endpoint that accepts JSON mode and `HARBINGER_MODEL_NAME` to its model ID. Set `HARBINGER_MODEL_KEY` if the endpoint requires a key. Use your environment or the gitignored `.env` file, then restart the app. The authored action buttons also work with the fixed-response engine.

The [architecture proposal](docs/architecture.md) and [research review](docs/research.md) document the setting, viewpoint rules, and planned playtest.
