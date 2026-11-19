# Harbinger

Harbinger is a local interactive story. **The Bread Ledger** follows a London clerk during the succession crisis in Malory’s *Le Morte Darthur*. Decide who gets the ledger, what happens to Alice’s oven, and whose confidence the clerk keeps.

## Run locally

Use Node 24 or later. Run `npm ci` and `npm start`, then open `http://127.0.0.1:4173`. The app saves story progress to SQLite in `.harbinger/`. Set `HARBINGER_PORT` or `HARBINGER_DATABASE_PATH` to use a different local port or save database.

Open **Journal** to revisit what the clerk discovered. Use **Saves** to start another story, duplicate current progress, or move a save. **Testing view** reveals private NPC thoughts and director decisions after you opt in.

## Verify

Run `npx playwright install chromium` once, then `npm test`. To use a supported installed browser, set `PLAYWRIGHT_CHANNEL` to its Playwright channel, such as `msedge`.

For model-enabled free text, set `HARBINGER_MODEL_URL` to an OpenAI-compatible Chat Completions endpoint that accepts JSON mode and `HARBINGER_MODEL_NAME` to its model ID. Set `HARBINGER_MODEL_KEY` if the endpoint requires a key. For models that accept a reasoning setting, set `HARBINGER_REASONING_EFFORT` as well. Use your environment or the gitignored `.env` file, then restart the app. The authored action buttons also work with the fixed-response engine.

The [architecture proposal](docs/architecture.md) and [research review](docs/research.md) document the setting and viewpoint rules. The [live playtest report](docs/playtest.md) records the same-model comparison and browser checks.
