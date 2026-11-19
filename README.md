# Harbinger

Harbinger is a local interactive story. **The Bread Ledger** follows a London clerk during the succession crisis in Malory’s *Le Morte Darthur*. Decide who gets the ledger, what happens to Alice’s oven, and whose confidence the clerk keeps.

## Run locally

Use Node 24 or later. Run `npm ci` and `npm start`, then open `http://127.0.0.1:4173`. The app saves story progress to SQLite in `.harbinger/`. Set `HARBINGER_PORT` or `HARBINGER_DATABASE_PATH` to use a different local port or save database.

Open **Journal** to revisit what the clerk discovered. Use **Saves** to start another story, duplicate current progress, or move a save. **Testing view** reveals private NPC thoughts and director decisions after you opt in.

### Covel opening in development

Run `npm run covel:setup` once, then set the narrator’s provider in your shell or in the gitignored `.env`. For OpenAI, use `HARBINGER_MODEL_URL=https://api.openai.com/v1/responses`, `HARBINGER_MODEL_NAME=gpt-6.2-sol`, and `HARBINGER_REASONING_EFFORT=medium`. Supply `HARBINGER_MODEL_KEY` locally.

Run `npm run start:covel` and open `http://127.0.0.1:4174`. The Covel opening writes to `.harbinger/covel-story.sqlite`, or to `HARBINGER_COVEL_DATABASE_PATH` when configured. Use `npm start` to play or access saves in the current app. The local setup pins Covel v0.0.54 and keeps the upstream MIT license with its checkout.

### Editing skill

For authoring in Codex, install the complete Avoid AI Writing skill from the repository root.

```sh
git clone --depth 1 --branch v3.39.0 https://github.com/conorbronsdon/avoid-ai-writing.git .agents/skills/avoid-ai-writing
git -C .agents/skills/avoid-ai-writing rev-parse HEAD
```

The expected revision is `aecf2680a56b9b19835a3e362af4ebdd2e8e92f1`. The project-local install keeps the pattern catalog and MIT notice with the skill. Harbinger’s narrator and editor use their own versioned fiction rubric adapted from its contextual editing workflow. [Avoid AI Writing](https://github.com/conorbronsdon/avoid-ai-writing/tree/aecf2680a56b9b19835a3e362af4ebdd2e8e92f1)

## Verify

Run `npx playwright install chromium` once, then `npm test`. To use a supported installed browser, set `PLAYWRIGHT_CHANNEL` to its Playwright channel, such as `msedge`.

To exercise the Covel browser suite, run `npm run covel:setup` and set `HARBINGER_TEST_COVEL=1` before running `npm test`. The test uses the pinned runtime and a local, deterministic provider response.

For model-enabled free text, set `HARBINGER_MODEL_URL` to an OpenAI-compatible Chat Completions endpoint that accepts JSON mode and `HARBINGER_MODEL_NAME` to its model ID. Set `HARBINGER_MODEL_KEY` if the endpoint requires a key. For models that accept a reasoning setting, set `HARBINGER_REASONING_EFFORT` as well. Use your environment or the gitignored `.env` file, then restart the app. The authored action buttons also work with the fixed-response engine.

The [architecture proposal](docs/architecture.md) and [research review](docs/research.md) document the setting and viewpoint rules. The [live playtest report](docs/playtest.md) records the same-model comparison and browser checks.
