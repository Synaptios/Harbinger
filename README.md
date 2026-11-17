# Bellwether

Bellwether is a single-player browser RPG set in a salt-marsh ferry town. You begin at Floodgate Quay with an urgent delivery, a brass ferry token, and conflicting accounts of a distant signal light. Approach the delivery, explore the marsh, or follow whatever interests you. Enter an action in your own words or edit a suggestion before sending it.

## Play locally

Use Node.js 22 or later. The project has no package dependencies.

```sh
npm start
```

Open [Bellwether](http://127.0.0.1:4173). Offline demo is available immediately, with scripted routes through the ferry town. The browser remembers a campaign ID and the server stores that campaign in `data/`. Start a new campaign from the page. You can switch narrators mid-campaign, though starting each model from the opening makes comparisons easier.

To enable live narrators, point the server to an existing credentials file. It accepts dotenv assignments or a flat JSON object with `OPENAI_API_KEY` and `OPENROUTER_API_KEY`, including the spellings `OPEN_AI_API_KEY` and `OPEN_ROUTER_API_KEY`. The same names work as server environment variables. The file is read in place.

**PowerShell**

```powershell
$env:CREDENTIALS_FILE = 'C:\path\to\Ascendant\.credentials'
npm start
```

**macOS or Linux**

```sh
CREDENTIALS_FILE=/absolute/path/to/Ascendant/.credentials npm start
```

If the environment routes HTTPS through a configured proxy, use Node 24.5+ and set `NODE_USE_ENV_PROXY=1` for the server and evaluation commands. The server binds to loopback. The browser receives model availability and campaign data. OpenAI models go directly to OpenAI, and Gemini and Claude go through OpenRouter. Live turns send the action and relevant story context to the selected provider. Optional `OPENAI_MODEL` and `OPENROUTER_MODEL` settings add a model by API ID.

## How a turn works

1. The game master sees the current scene, possessions, open commitments, five recent turns, and older evidence selected by word overlap. Stored facts, claims, and cast details carry their original turn numbers in model context.
2. The selected model returns narration, suggested actions, and proposed state changes in one structured response. The game master can invent a rumor about an unseen place or introduce an NPC and an opportunity where it fits.
3. The server validates each change and commits the new snapshot and turn record together. It checks item ownership, claim attribution, and stable IDs. It retries invalid outputs once. Revision and request IDs protect against stale tabs and duplicate submissions.
4. The journal displays directly observed facts beside attributed rumors, so two NPCs can disagree until the player discovers what happened. It also shows the current inventory, cast, and plot threads.

The initial campaign setting and continuity rules are authored here. Live play can move beyond the scripted town. Server checks cover the structured record. They cannot prove that every sentence in the narration agrees with prior facts, respects an NPC’s knowledge, or leaves the player enough agency. Retrieval in this version is lexical and can miss paraphrased references. The demo is useful for exercising the interface and save mechanics, and the same replay with live narrators probes model behavior.

## Research and model choices

| Function | MVP choice and evidence |
| --- | --- |
| Narration and action resolution | **GPT-6.1 Terra** is the direct OpenAI baseline. **Gemini 4 Argon** is the first OpenRouter prose comparison. Argon led Arena’s November 2026 creative-writing comparison at high effort, with a rank range overlapping Claude Opus 5.5. Arena measures general human preference, and the game currently calls Argon at low effort for latency. **Claude Sonnet 5.5** is another playable comparator. [Terra model card](https://developers.openai.com/api/docs/models/gpt-6.1-terra) · [Arena Creative Writing](https://arena.ai/leaderboard/chat/text/creative-writing) · [Argon](https://openrouter.ai/google/gemini-4-argon) · [Sonnet](https://openrouter.ai/anthropic/claude-sonnet-5.5) |
| Structured state | A deterministic reducer owns acceptance of state changes. **GPT-6 Luna** is the low-cost model baseline and a candidate for a separate state-extraction pass later. RPGBench found different leaders for interestingness and mechanics. NCP-Bench found substantial commitment failures over 20 adversarial turns even among its strongest evaluated models. [RPGBench](https://arxiv.org/html/2502.00595v1) · [NCP-Bench](https://arxiv.org/abs/2608.08160) · [Luna model card](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Long-term memory and NPC knowledge | Store canonical events, open commitments, and attributed testimony. Recover relevant older turns alongside recent dialogue and keep the source of each claim. LongMemEval and Lost in the Middle motivate selective context, while Generative Agents and CoSER motivate maintaining distinct character knowledge, goals, and voices. [LongMemEval](https://arxiv.org/abs/2410.10813) · [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) · [Generative Agents](https://arxiv.org/abs/2304.03442) · [CoSER](https://proceedings.mlr.press/v267/wang25dk.html) |
| Narrative pacing and prose review | Open threads give the scene continuity without dictating player choices. Evaluate concrete detail, differentiated voices, deliberate pacing, agency, and repetition by reading anonymized transcripts. Detailed Outline Control improved coherence in long-form generation. Hamilton and Mimno found recurrent stock words in sampled model stories, and LitBench documents the gap between human preference and automatic judgments. [DOC](https://aclanthology.org/2023.acl-long.190/) · [Low Diversity in LLM Stories](https://aclanthology.org/2026.emnlp-main.2013/) · [LitBench](https://arxiv.org/abs/2507.00769) |

## Replay and compare

```sh
npm run eval -- --turns 20
npm run eval -- --turns 50
npm run eval -- --turns 100
```

The default demo replay crosses the recent memory window, restarts the server, verifies saved state, recovers an earlier signal explanation, compares attributed testimony, and tries to reuse a spent fare. It also tests an invalid turn and its repair.

With credentials configured, run the same actions through live narrators. Each action makes a paid API call, with one additional call on repair.

```sh
npm run eval -- --model gpt-6.1-terra --model google/gemini-4-argon --turns 20
```

Successful replays report scenario checkpoints, retries, recorded tokens, median model-turn latency, and turn numbers for manual review. They write the complete transcript to `eval-results/`. A checkpoint can fail because the GM played the action differently. For a prose comparison, read the transcripts with model names hidden and mark each continuity error with the turn that establishes the conflicting fact. Look for NPCs giving away things they could not know, quiet turns that add no useful texture, repeated phrasing, and the narrator taking unrequested actions for the player. The 50- and 100-turn scripts extend the same run with repeated detours and callbacks.

### First playtest · November 17, 2026

| Narrator | Live turns | Median turn | Recorded tokens | Repairs |
| --- | ---: | ---: | ---: | ---: |
| GPT-6.1 Terra | 20 | 5.8 s | 59,414 | 0 |
| Gemini 4 Argon | 20 | 11.5 s | 110,667 | 0 |

Terra preserved the signal meaning, denied the reused fare, and confirmed the old delivery. Its signal callback repeated much of the original explanation. Argon used more specific local detail and sustained conflicting accounts of the keeper. It kept the office closed once Nera locked it, then answered the delivery callback through the receipt. Its ferry required the player to show that receipt, a move the replay never attempted, so the spent-fare and tower discovery checks were unexercised. It also occasionally narrated extra actions for the player. These are observations from one paired script at low reasoning effort.

GPT-6 Luna and Claude Sonnet 5.5 each passed a one-turn live smoke test. Scripted demo replays passed at 20, 50, and 100 turns. Longer live campaigns and a separate prose-versus-state-call comparison remain unmeasured.
