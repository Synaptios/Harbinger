# Harbinger

Harbinger is a local interactive story. **The Bread Ledger** follows a London clerk during the succession crisis in Malory’s *Le Morte Darthur*. Decide who gets the ledger, what happens to Alice’s oven, and whose confidence the clerk keeps.

## Run locally

Use Node 24 or later. Run `npm ci` and `npm run covel:setup` once, then set the text-model provider in your shell or in the gitignored `.env`. For OpenAI, use `HARBINGER_MODEL_URL=https://api.openai.com/v1/responses`, `HARBINGER_MODEL_NAME=gpt-6.2-sol`, and `HARBINGER_REASONING_EFFORT=medium`. Supply `HARBINGER_MODEL_KEY` locally.

Run `npm start` and open `http://127.0.0.1:4174`. Choose **The Bread Ledger** in Covel’s world library. Open an existing game or start a new one and select **Begin Adventure**. Harbinger’s **Journal** and opt-in **Testing view** appear in Covel’s game panels. The Journal shows source labels alongside discoveries. Set `HARBINGER_PORT` to use a different local port.

Use **Settings → Models → AI roles** to choose a tier or edit the **Story**, **Character**, **State**, **Image**, and **Speech** roles directly. Character and State drive The Bread Ledger, and Story drives Covel Studio worlds. Add a model through **Providers & keys**, then set any supported parameters on its role. Changes apply on the next turn. **Previous lineup** restores the text model and parameters in use when Harbinger first migrated the settings.

Set `HARBINGER_OPENAI_API_KEY`, `HARBINGER_OPENROUTER_API_KEY`, and `HARBINGER_INWORLD_API_KEY` on the server for the full Voyage lineup. `HARBINGER_MODEL_KEY` still works for the provider configured by `HARBINGER_MODEL_URL`. The native roles use server credentials. Port and database path come from the startup configuration. Run `npm run covel:setup` again after updating an existing Covel installation.

Run `node --env-file-if-exists=.env scripts/covel-probe-route-latency.mjs` to refresh the provider measurements used by Settings and the Voyage stager. The probe sends short structured requests and scene-length prose with synthetic inputs. Harbinger ranks compatible gateways by measured tail latency, then median and estimated cost. Cost is the fallback when measurements are unavailable.

The **Illustrations** and **Narration** panels show media from committed passages. Use the plugin settings to change image quality, turn automatic generation on or off, and choose narrator and cast voices. Playback starts when you press Play. **AI Create World** and **Revise this world** use the native Covel authoring screens, with the content rating in the world’s **Tone** settings.

The Bread Ledger assembles authored scene events with dialogue grounded in the addressed character’s own records. For supported questions about specific records, the character chooses wording backed by their evidence. Most resolved turns aim for 200–300 words. The game waits for slow provider replies and saves the completed turn. Brief clarifications can be shorter.

On Windows, run `pwsh -NoProfile -File scripts/hindsight-local.ps1` in a separate terminal to enable Hindsight retrieval. The launcher requires PowerShell 7.5 and `uv`. It installs the service and an on-device English embedding model, stores the index and local token under gitignored `.harbinger/hindsight`, and listens on port 8888. `npm start` detects the local token. Set `HINDSIGHT_URL` and `HINDSIGHT_API_KEY` for a different server. Each character has a separate bank for each save, and Harbinger uses the save’s own knowledge records when retrieval is unavailable. [Hindsight memory banks](https://hindsight.vectorize.io/developer/api/memory-banks)

The local setup builds Covel’s own web app from the pinned v0.0.54 checkout and keeps the MIT license there. Covel and Harbinger’s compatibility tools use `.harbinger/covel-story.sqlite`, or `HARBINGER_COVEL_DATABASE_PATH` when configured. Stop the Covel web server before running `npm run start:covel-tools` to move or restore a full Harbinger backup. Use `npm run start:legacy` and open `http://127.0.0.1:4173` for saves from the original fixed-response app. It retains its own database and accepts `HARBINGER_DATABASE_PATH` for an override.

### Editing skill

For authoring in Codex, install the complete Avoid AI Writing skill from the repository root.

```sh
git clone --depth 1 --branch v3.39.0 https://github.com/conorbronsdon/avoid-ai-writing.git .agents/skills/avoid-ai-writing
git -C .agents/skills/avoid-ai-writing rev-parse HEAD
```

The expected revision is `aecf2680a56b9b19835a3e362af4ebdd2e8e92f1`. The project-local install keeps the pattern catalog and MIT notice with the skill. Harbinger’s narrator and editor use their own versioned fiction rubric adapted from its contextual editing workflow. [Avoid AI Writing](https://github.com/conorbronsdon/avoid-ai-writing/tree/aecf2680a56b9b19835a3e362af4ebdd2e8e92f1)

## Verify

Run `npx playwright install chromium` once, then `npm test`. To use a supported installed browser, set `PLAYWRIGHT_CHANNEL` to its Playwright channel, such as `msedge`.

To exercise the Covel browser suite, run `npm run covel:setup` and set `HARBINGER_TEST_COVEL=1` before running `npm test`. The suite uses the pinned runtime, the native web build, and a deterministic local provider.

For model-enabled free text in the original app, set `HARBINGER_MODEL_URL` to an OpenAI-compatible Chat Completions endpoint that accepts JSON mode and `HARBINGER_MODEL_NAME` to its model ID. Set `HARBINGER_MODEL_KEY` if the endpoint requires a key. For models that accept a reasoning setting, set `HARBINGER_REASONING_EFFORT` as well. Use your environment or the gitignored `.env` file, then restart the app. The authored action buttons also work with the fixed-response engine.

The [architecture proposal](docs/architecture.md) and [research review](docs/research.md) document the setting and viewpoint rules. The [Covel playtest](docs/covel-playtest.md) includes the live comparison and browser checks. The [original playtest](docs/playtest.md) records the earlier comparison.
