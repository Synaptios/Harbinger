# The Bread Ledger on Covel

Both live routes reached an ending with GPT-6.2 Sol at medium reasoning. In one, the clerk kept the ledger and left the notice unread. In the other, the clerk helped load the flour, verified the closure order, and offered to help Alice start again. The first run encountered a defect in optional revision. After the fix, the guild route continued from its saved checkpoint and the river route continued from a Covel checkpoint rebuilt by replaying its nine accepted passages. The replay preserved the public history and used fixture responses for private actor drafts. The remaining turns ran live.

## Browser verification

The 57-check suite exercises all five existing endings, native turn recovery, witness versus absent NPC knowledge, sourced Journal entries, private first-person thoughts, generated people and places, and portable save continuation. A full route ran at 320 and 1,280 CSS pixels. Keyboard controls, source focus, restored mobile reading position, retained drafts, and pending-turn access to previous passages passed. Chromium exposed a polite, atomic status region. Spoken screen-reader output remains unverified.

## Live measurements

| Measure | Covel | Single-pass prose |
| --- | ---: | ---: |
| Successful story turns, including the shared opening | 14 | 5 matched passages |
| Words per published passage | 431–589 | 466–580 |
| Median response time | 35.8 s | 18.3 s |
| 95th percentile response time | 46.5 s | 18.6 s |
| Provider requests | 109 | 5 |
| Input tokens | 214,309 | 9,910 |
| Output tokens | 25,576 | 3,557 |
| Estimated API cost | $0.673 | $0.055 |

The Covel timings measure successful actions from submission through commit. The baseline timings measure a single provider request. Prices use the published standard input, cached input, and output rates. The Covel cost includes the original run, failed turns, and focused live continuations. It excludes the separate calibration exercise below. These two routes shared an opening. The measured spend averaged about $0.34 per completed route in this pilot. [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-6.2-sol)

The initial run rejected two valid moves twice each. The reproduced guild failure started with a 495-word draft that passed the hard checks. An optional edit added an unchosen player action, so the earlier runtime rejected the entire turn. The revised runtime retains a verified original when a style-only edit fails. A draft with an original hard failure still requires a valid repair. The corrected live continuations each reached their ending without another rejected turn. The unscripted supper invitation received a character-specific reply.

## Blinded comparison

The five pairs use the same model, action, prior public passages, authorized outcomes, speaker evidence, and word target. The single-pass arm receives the factual resolution and standard voice instructions. The Covel arm also receives the director’s dramatic guidance and can revise after review. The comparison tests the writing workflow. The browser and live routes test the interactive experience. [Read the five pairs](covel-playtest-samples.md)

Two model-assisted readers independently preferred the single-pass passage in the quiet exchange, supper invitation, refusal, and delayed callback. They pointed to physical detail that revealed the clerk’s position, a more reciprocal response to the invitation, an immediate next choice after the refusal, and a concrete expression of trust after the callback. Both preferred Harbinger’s ending, where Alice gives the clerk a job and changes where they should meet. The readers wanted the earlier exchanges to develop further before the ledger plot returned. This prompted a second version of the fiction rubric and scene guidance.

The revised guidance follows the player’s immediate move further, keeps quiet scenes selective, and gives a remembered choice a concrete effect on the present exchange. A follow-up regenerated three scenes from replayed public histories. All three passed the passage checks at 463–513 words. A third blinded, model-assisted reader preferred the revised quiet scene and the earlier single-pass drafts for the invitation and callback. These are small comparisons. The player’s response to a complete run is still the quality gate.

The complete local episode and the passages are available for the player’s own verdict. [Full-episode acceptance issue](https://github.com/Synaptios/Harbinger/issues/11)

With the Covel runtime set up and the OpenAI key available in the process environment or the local `.env`, run `node --env-file-if-exists=.env scripts/covel-playtest.mjs` for a fresh scripted comparison.

## Voyage lineup release check

The release route opens The Bread Ledger, invites Alice to supper, promises discretion, asks for Alice’s account of Guenever, and later asks Alice to recall the promise. Run `node scripts/covel-stage-voyage.mjs <database> <candidate-toml>` with the provider credentials to stage a profile separately from the active configuration. Run `scripts/covel-voyage-playtest.mjs` with `HARBINGER_VOYAGE_CANDIDATE_TOML` set to that profile and `HARBINGER_VOYAGE_PREVIOUS_TOML` set to the control profile. In the control, GPT‑6.2 Sol at medium reasoning runs Story, Character, and State. Both arms use the same rating, memory and other fixed bindings. These model profiles remain available for comparing Character and State. The current Bread Ledger narrator does not use a separate Story draft. The servers use isolated saves and record timings, public continuity checks, request usage, and prose in `.harbinger/playtest/`.

The runner checks that all five moves commit once and records the length of each passage. Pass the optional `--require-length` switch to test the earlier 400–700 word target. The Hindsight-backed engine assembles approved material and has no minimum word count. Public journal disclosures must preserve their sources. Review the live dialogue, delayed recall, and agency alongside the private-knowledge and recovery fixtures before activating the profile. The live timings measure submission to committed text and exclude detached media. With five samples the p95 is the slowest turn. The historical experiments below used the earlier writer pipeline. Their cost estimates use reported input, cached input, and output token usage at the provider rates on November 19, 2026. They exclude calls with no attributable usage, detached media, and separate capability probes. [OpenAI GPT‑6.2 Sol pricing](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [Inworld model prices](https://inworld.ai/models) · [OpenRouter Qwen3 14B](https://openrouter.ai/qwen/qwen3-14b)

Provider probes returned structured responses for the GLM 5.3 Flash, Gemma 4 31B, Gemini 3 Flash, Jev, Qwen3 14B, Mistral NeMo, and GPT‑5.6 Luna routes. Direct OpenAI returned a Flare Low PNG. Inworld returned WAV audio for the two configured TTS voices. Browser fixtures resume a legacy Bread Ledger save and create, revise, and play a Studio world. In both scenarios a rejected draft is withheld, the turn commits a fallback, and only the accepted passage supplies cues for first-reveal art and cast voices.

The first matched live run saved all five moves in each arm and preserved the source of Alice’s account. The candidate measured 11.7 s median and 14.0 s tail, at an estimated $0.0040 for its five foreground turns. Previous measured 53.9 s median and 77.0 s tail, at $0.1718. Candidate passages ran 7–93 words, all on the authored recovery path. A second continuity review, better structured-output instructions, a bounded redraft, and repair deadlines address the faults exposed by that run. Alice’s character evidence also now includes her own recorded statements, paired with their existing provenance and time of delivery.

The matched rerun after restoring Alice’s own testimony produced the following measurements. The spend column is in US dollars.

| Scene | Previous words | Voyage words | Previous time | Voyage time | Previous spend | Voyage spend |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening | 460 | 623 | 43.5 s | 19.9 s | $0.0254 | $0.0011 |
| Supper invitation | 455 | 29 | 53.6 s | 42.3 s | $0.0348 | $0.0232 |
| Promise of discretion | 497 | 75 | 48.1 s | 21.8 s | $0.0367 | $0.0071 |
| Alice’s sourced account | 25 | 563 | 45.8 s | 33.3 s | $0.0441 | $0.0159 |
| Delayed callback | 533 | 682 | 59.9 s | 44.5 s | $0.0467 | $0.0157 |
| Median / tail and total spend | | | 48.1 / 59.9 s | 33.3 / 44.5 s | $0.1876 | $0.0630 |

The Voyage text occasionally gave Alice distinctive working gestures and evasions. On the same inputs, the Previous arm gave her room to answer the supper invitation, while the Voyage arm redirected to the flour meeting. A later paired repeat landed four longer Voyage passages, but the opening invented a ledger commitment for the clerk and the Guenever scene published an ellipsis. The callback remembered discretion but supplied further speech for the player. In that repeat, Previous preserved the agency boundary in its opening and distinguished the carter’s account from Alice’s knowledge in the Guenever scene, while its supper exchange fell back to a brief listening beat. The local runtime now guards player viewpoint, uses a parallel continuity review for the Voyage Story profile, and rules out punctuation-only drafts. These checks preserve a saved turn when a candidate fails.

**Release decision.** Keep Previous for Story, Character, and State. The continuity-checked Inworld candidate saved all five actions, with authored continuations of 93, 29, 22, 25, and 14 words. Its median was 32.6 s, its slowest turn took 39.1 s, and its reported usage came to $0.0930. The OpenRouter route for the same GLM model saved the same five authored continuations. Its median was 58.0 s, its slowest turn took 80.6 s, and its reported usage came to $0.0276. The OpenRouter run included 15 calls without attributable usage, including provider timeouts. The local rollout enables native Settings, Studio, and media with Previous still active. The existing Bread Ledger save retained its complete transcript and picked up automatic art and cast audio for future turns. [Release ticket](https://github.com/Synaptios/Harbinger/issues/34) · [OpenRouter GLM 5.3 Flash](https://openrouter.ai/z-ai/glm-5.3-flash)

### GLM fallback investigation

A native provider fixture reproduced the transport failure with a 426-word passage the gateway discarded while parsing it as JSON. Bread Ledger now requests plain text for GLM drafts and retains structured output for world actions, review, and edits. Successful plain drafts also exposed independent continuity faults. Some invented speech or choices for the clerk. The writer now gets the ordered resolved actions, exact spoken words where available, and sourced outcomes. The director focuses on private promises and disclosures when they are the current scene. Alice’s reply instructions distinguish a social invitation from a possible flour appointment.

The continuity reviewer explains the required corrections and groups findings by paragraph. It can repair required changes when the Story route cannot. A bounded follow-up can keep a verified passage within range or correct a remaining finding. One live opening demonstrated this failure mode by passing continuity at 394 words, which previously triggered a full new draft. In another run Qwen sent malformed verdicts for passages that had already passed continuity. The rating check now retries malformed or transient responses once within the same deadline. A valid denial still takes effect immediately. A provider outage or unresolved violation still leaves one committed authored continuation.

### Activation verification

Both live candidate runs saved every action exactly once and met the length requirement on all ten passages. The paired Previous run also saved all five actions and fell back on the promise and recall turns. In both candidate runs, Alice recalled the private promise in her own dialogue and kept the carter’s Tower sighting distinct from her inference about Guenever. The follow-up remained the player’s choice. Some bakehouse imagery recurred across scenes.

| Scene | Previous | Paired Voyage | Independent Voyage repeat |
| --- | ---: | ---: | ---: |
| Opening | 493 words | 485 words | 485 words |
| Supper invitation | 493 words | 437 words | 472 words |
| Promise of discretion | 22 words | 418 words | 458 words |
| Alice’s sourced account | 514 words | 456 words | 442 words |
| Delayed callback | 14 words | 463 words | 451 words |
| Median committed-text time | 46.5 s | 44.2 s | 40.3 s |
| Slowest committed-text time | 52.7 s | 79.3 s | 95.4 s |
| Estimated five-turn foreground spend | $0.1824 | $0.1761 | $0.2316 |

The local app now serves Balanced Story and High Character with Inworld GLM 5.3 Flash, and High State with Inworld Gemma 4 31B. GPT‑6.2 Sol remains available through Previous and handles required continuity edits on the Voyage profile. The live rollout preserved the saved Bread Ledger transcript and existing media settings. All 84 automated tests passed. [Release ticket](https://github.com/Synaptios/Harbinger/issues/34)

### Turn latency investigation

The 95.4-second discretion turn made 20 successful requests. Inworld GLM accounted for 43.3 seconds of provider work, OpenAI continuity work for 49.7 seconds, and Qwen rating for 5.3 seconds. The reconstructed sequence includes two drafts, repeated editorial and continuity reviews, four edits, and final rating. Provider work is summed across calls, so concurrent time can exceed elapsed time. The updated live runner records call durations, overlap, and time outside the provider calls without saving prompts or rejected response contents.

From the same resolved turn, Covel now starts two GLM drafts and runs independent reviews and exact-text rating concurrently. It commits the first in-range passage that passes and cancels outstanding requests. Mandatory corrections still receive fresh checks. Findings across three or more paragraphs go directly to a whole-scene continuity edit. A whole-scene edit can also recover when local changes leave incompatible paragraphs. Private thoughts run concurrently with Story, with a six-second budget and an authored private fallback. Actions whose outcomes change later steps still resolve in order.

Route probes compare compatible providers by measured tail and median latency. Inworld returned three usable full-length GLM drafts in 9.35–12.99 seconds. The OpenRouter route returned no usable full scene in three attempts, with one timeout. Inworld also had the lower measured median for GLM Character and Gemma State. OpenRouter returned Qwen’s boolean verdict in 0.38–0.72 seconds with its native no-thinking parameter, compared with 5.19–6.33 seconds for the previous wire setting. The approved roles and model families stay the same. [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) · [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

| Measure | Previous passing run | Optimized run | Optimized repeat |
| --- | ---: | ---: | ---: |
| Full-length turns saved exactly once | 5 of 5 | 5 of 5 | 5 of 5 |
| Passage lengths | 442–485 words | 470–523 words | 482–519 words |
| Median commit | 40.3 s | 35.1 s | 34.5 s |
| Slowest commit | 95.4 s | 43.8 s | 42.3 s |
| Discretion promise | 95.4 s | 39.8 s | 42.3 s |
| Estimated five-turn foreground spend | $0.2316 | $0.2225 | $0.2428 |

The fresh serial control saved all five turns, with a 25-word disclosure fallback after rating schema failures. Its median was 45.7 seconds and its slowest turn was 60.4 seconds. The optimized samples both passed the full-length gate. The cost estimates exclude requests whose usage was unavailable, including canceled calls. In the independent repeat, Alice recalls the correct promise and distinguishes the source of the Guenever report. The narrator quotes two fragments of indirect player speech literally, which makes the pronouns awkward. All 87 automated tests passed. The local rollout verified the measured profile and retained the saved transcript.

## Hindsight-backed dialogue

The same five-move route ran with local Hindsight 1.2.2, on-device English embeddings, and the existing Inworld Character and State routes. All five turns committed once, and each Journal source linked to a saved passage. Alice recalled the wording of her promise. The median time to a committed turn was 1.03 s and the slowest was 4.27 s. Published passages were 17–93 words. The five-turn sample measures the new assembly path with its own length profile.

The native knowledge test verifies that Martin gets Alice’s account only after the clerk tells him. It also checks separate saves, a whisper addressed to Alice, an unauthorized transfer proposed by State, and fabricated text returned by both the memory and Character providers. [Hindsight recall API](https://hindsight.vectorize.io/developer/api/recall)

## Fifty-turn NovelOS review

Five fresh saves ran ten player actions each in parallel, with the opening excluded. The routes covered the guild-first clerk, Alice’s confidante, a skeptical investigator, a practical helper, and a clerk testing the limits of what the world would let them do. The live harness timed submission to committed story, counted the saved player action and passage, and checked each route’s expected knowledge transitions and ending. The benchmark ran with media plugins disabled.

| Playstyle | Turns saved once | Passage length | Slowest save |
| --- | ---: | ---: | ---: |
| Guild-first clerk | 10 of 10 | 238–283 words | 1.915 s |
| Loyal confidante | 10 of 10 | 236–288 words | 1.159 s |
| Skeptical investigator | 10 of 10 | 235–283 words | 2.585 s |
| Practical helper | 10 of 10 | 213–288 words | 0.968 s |
| Boundary-pushing clerk | 10 of 10 | 247–286 words | 2.152 s |
| **Total** | **50 of 50** | **213–288 words** | **2.585 s** |

Overall nearest-rank median and p95 were 0.369 s and 1.915 s. Every passage fell in the 200–300-word target. All harness route and persistence checks passed. The figures describe the build sampled before the following tuning.

NovelOS imported each saved turn as a chapter in a project for its playstyle and evaluated it offline using native continuity, Voice Lab, and the Guardian with GPT‑4.1. It counted 82 paragraph reuses within playthroughs and found dialogue in 16.2% of paragraphs on average. Its 24 warnings largely reflect chapter-based inactivity heuristics. The separate transcript audit found five issues the Guardian missed, including an invented witness, an incorrect oven schedule, a reversal of who reached for the ledger, and one reply that echoed an instruction. Guardian prose scores and warnings are diagnostic. [NovelOS continuity](https://github.com/mrigankad/NovelOS/blob/44106062149b5f179da683cb65e4574e75411ffe/server/services/continuity.py) · [Voice Lab](https://github.com/mrigankad/NovelOS/blob/44106062149b5f179da683cb65e4574e75411ffe/server/voice/analyze.py)

The tuned prompt prioritizes a direct response in the character’s own voice and anchors concrete claims to their sources. The game now records the clerk’s attempt to take the ledger, the porter’s tally help, the carters’ wax tally, the runner’s copy of the order, and the baker’s actual offer as evidence for the people who experienced them. Scripted exchanges have more character-specific speech, and the narrator leads with the exchange and avoids repeating scenic paragraphs from the last two turns. Runtime saves use the same deadline and authored fallback. The 50 live actions ran once. The tuning has separate regression coverage for the evidence, narration, and fallback behavior.

The harness is `scripts/covel-novel-eval.mjs`. Supply your configured provider and local Hindsight endpoint, then run `node --env-file-if-exists=.env scripts/covel-novel-eval.mjs --parallel --output .harbinger/playtest/novelos-live-first-pass.json`. It writes the five isolated transcripts, preserving only evaluation snapshots from the test saves. The evaluator is `scripts/novelos-evaluate.py`. Use Python 3.12 with the pinned NovelOS checkout at `.harbinger/novelos-eval/NovelOS` and its `requirements.txt` installed, and pass the saved transcript and `--output` path. Supply `OPENAI_API_KEY` for the Guardian or use `--deterministic-only` for continuity and Voice Lab. [Pinned NovelOS](https://github.com/mrigankad/NovelOS/tree/44106062149b5f179da683cb65e4574e75411ffe)

## Tuned NovelOS rerun

The rerun used the same 50 player actions across five parallel isolated saves, the same model lineup, and the same NovelOS revision and GPT‑4.1 Guardian configuration. Thomas and the Anchor Storehouse appeared on both practical-helper routes. The benchmark kept the tuned build’s deadlines and recorded timeouts by stage. A stalled reply was omitted from the saved scene. The benchmark did not add a substitute line or extend that scene to hit its word target.

| Measure | First pass | Tuned rerun |
| --- | ---: | ---: |
| Turns saved exactly once | 50/50 | 50/50 |
| Turns with 200–300 words | 50/50 | 42/50 |
| Passage length | 213–288 words | 7–288 words |
| Median save | 0.369 s | 0.386 s |
| p95 save | 1.915 s | 2.229 s |
| Slowest save | 2.585 s | 3.549 s |
| NovelOS repeated paragraphs | 82 | 24 |
| Voice Lab dialogue paragraph ratio | 16.2% | 18.5% |
| Guardian responsiveness, voice | 4.40, 4.62 | 4.58, 4.76 |
| Guardian pacing, specificity | 4.02, 4.80 | 4.02, 4.76 |
| Guardian pass, warning | 26, 24 | 26, 24 |

The Character provider timed out on guild-first turn 9. The input and listening beat saved once in 3.549 seconds. The seven-word scene carries no Alice reply, which accounts for the failed route check. The other short passages were loyal-confidante turn 8 (149), skeptical-investigator turns 6 (179), 7 (197), and 9 (121), and practical-helper turns 4 (146), 5 (94), and 10 (162). All five routes reached their tenth action and ending.

| Previously missed turn | Direct inspection of the rerun |
| --- | --- |
| Guild-first 6 | Alice drops the claim that the crier paid Martin. She still misattributes his request to the clerk’s guild. |
| Skeptical investigator 7 | The runner gives the written guild order as his source and says he did not see the closure. The invented baker’s man is gone. |
| Skeptical investigator 9 | The baker offers the two hours before dawn with wood as the condition. The invented overnight firing schedule is gone. |
| Practical helper 1 | The prompt echo is gone. Alice says Mordred died in the crier’s proclamation, which named Arthur, and leaves the flour question unanswered. |
| Boundary-pushing 3 | Alice correctly recalls the clerk reaching for the ledger. The invented family and debt are gone, but she replaces them with an unsupported story about a previous removal of the ledger costing her flour. |

The Guardian again raised no factual or agency flags, including on the last two cases. Direct inspection also found the market carter describing a chalked and signed tally where the scene established a scored wax tablet. On boundary-pushing turn 9, the narrator described the sound of settling a load on a route where no flour dispatch occurred. The measured gains are less reused narration and modestly higher subjective responsiveness and voice scores. Length coverage fell and the direct audit still found invented facts. Both raw transcripts and NovelOS reports are under `.harbinger/playtest`.

## Grounding and length rerun

The third live benchmark used the same 50 player actions, five parallel saves, provider lineup, and NovelOS revision and Guardian model. Each route ended after ten actions. The previous benchmark cut off long model calls, while this run awaited them and included elapsed wait time in the commit measurement.

| Measure | First pass | Tuned rerun | Grounding rerun |
| --- | ---: | ---: | ---: |
| Turns saved exactly once | 50/50 | 50/50 | 50/50 |
| Turns at 200–300 words | 50/50 | 42/50 | 50/50 |
| Word range | 213–288 | 7–288 | 202–288 |
| Median save | 0.369 s | 0.386 s | 0.374 s |
| p95 save | 1.915 s | 2.229 s | 1.133 s |
| Slowest save | 2.585 s | 3.549 s | 1.796 s |
| NovelOS repeated paragraphs | 82 | 24 | 25 |
| Dialogue-bearing paragraphs | 16.2% | 18.5% | 17.1% |
| Guardian responsiveness, voice | 4.40, 4.62 | 4.58, 4.76 | 4.56, 4.74 |
| Guardian pacing, specificity | 4.02, 4.80 | 4.02, 4.76 | 4.00, 4.76 |
| Guardian passes, warnings | 26, 24 | 26, 24 | 26, 24 |

One private-thought call on boundary-pushing turn 1 completed after 814 ms, past the former 750 ms cutoff. That turn saved once in 907 ms. All providers returned and the run recorded zero terminal stalls. Guild-first turn 9, whose Alice reply was missing on the previous pass, saved a 269-word scene with her answer in 503 ms. All eight previously short turns reached the target this time.

Direct review confirmed the five earlier dialogue defects were absent. Alice directs the clerk to the Thames landing when asked about the flour and correctly remembers who reached for the ledger. She says Martin asked the clerk for the ledger at dusk. The runner gives the written order as his source. The baker offers Alice two hours before dawn conditional on bringing wood. The market carter’s marks are scored on wax, the porter refers to his tally, and the return from the guild no longer describes a flour dispatch. Martin’s two extended answers still repeat parts of his reasoning about sealed reports.

For direct questions about these records, Character chooses among replies grounded in evidence available to the speaker at that point. The normal narrator assembles the selected dialogue with the resolved events and relevant scene detail. NovelOS and the direct audit ran after the benchmark. The raw rerun and annotated evaluation are in `.harbinger/playtest/novelos-grounding-rerun.json` and `.harbinger/playtest/novelos-grounding-evaluation.json`.

### Final replay with Martin’s witness rule

The grounding rerun also exposed an inconsistency in Martin’s free-form answer about hearsay. In the final build, his opening explains that he records a report under the name of the person who brought it and reserves the witness line for someone with firsthand knowledge. His answers draw on that record. The final replay used the same 50 actions and evaluated them with the same NovelOS protocol.

| Measure | Tuned rerun | Final replay |
| --- | ---: | ---: |
| Turns saved exactly once | 50/50 | 50/50 |
| Turns at 200–300 words | 42/50 | 50/50 |
| Word range | 7–288 | 202–288 |
| Median save | 0.386 s | 0.354 s |
| p95 save | 2.229 s | 1.260 s |
| Slowest save | 3.549 s | 1.366 s |
| NovelOS repeated paragraphs | 24 | 26 |
| Dialogue-bearing paragraphs | 18.5% | 17.0% |
| Guardian responsiveness, voice | 4.58, 4.76 | 4.58, 4.82 |
| Guardian pacing, specificity | 4.02, 4.76 | 4.00, 4.82 |
| Guardian passes, warnings | 26, 24 | 26, 24 |

Two private-thought calls exceeded their former 750 ms threshold and completed. Practical-helper turn 8 waited 932 ms for the thought and saved in 1.366 s. Boundary-pushing turn 2 waited 1.162 s for the thought and saved in 1.228 s. Both waits are included in the measurements. There were zero terminal stalls or gateway failures.

The five earlier dialogue defects remained absent on direct inspection. Martin distinguished what makes a witness on guild-first turn 4 and how he enters a secondhand report on turn 8. All previously short turns reached the word target. The final raw replay and annotated evaluation are in `.harbinger/playtest/novelos-grounding-final-rerun.json` and `.harbinger/playtest/novelos-grounding-final-evaluation.json`.

## Narration and dialogue variation replay

The variation build prefers scene details that are fresh within the current save. It tracks the use of authored details across turns and rebuilds the history from rendered passages when an older or portable save is opened. It uses fresh local alternatives before revisiting a detail. Record-backed dialogue uses unused wording when an eligible alternative exists. A character receives their own recent speech for follow-ups. Martin gives his tally’s account before disclosure and records the Tower as the clerk’s attributed report afterward.

The replay used the same 50 actions, five parallel saves, Hindsight, provider lineup, and pinned NovelOS with GPT‑4.1. The previously reported grounding replay is the baseline. Repeats are counted against earlier player turns in the same save, with the opening excluded. Paragraph counts use normalized exact matches of at least ten words. Quoted-dialogue counts use exact spans of at least five words.

| Measure | Grounding baseline | Variation replay |
| --- | ---: | ---: |
| Turns saved exactly once | 50/50 | 50/50 |
| Turns at 200–300 words | 50/50 | 50/50 |
| Word range | 202–288 | 202–290 |
| Median save | 0.354 s | 0.403 s |
| p95 save | 1.260 s | 1.012 s |
| Slowest save | 1.366 s | 1.719 s |
| Exact repeated narration paragraphs | 26 | 0 |
| Exact repeated quotes | 1 | 0 |
| Reused eight-word spans in dialogue | 25 | 0 |
| Guardian responsiveness, voice | 4.58, 4.82 | 4.60, 4.78 |
| Guardian pacing, specificity | 4.00, 4.82 | 4.02, 4.82 |
| Guardian passes, warnings | 26, 24 | 26, 24 |

The direct read covered all ten NPC replies and the previously flagged grounding anchors. The runner still cites the written order, the baker keeps the conditional two hours before dawn, and Alice and Martin retain their proper roles at the ledger. The guild walk-back describes the clerk returning with the ledger and the closure report. A close read found no new concrete contradiction in the ten replies. The Guardian scores moved slightly in both directions, while measured repetition fell. No calls crossed their waiting thresholds or ended in a terminal stall. The benchmark still awaited provider responses and included the full time in its measurements.

The raw replay and annotated NovelOS evaluation are `.harbinger/playtest/novelos-varied-rerun.json` and `.harbinger/playtest/novelos-varied-evaluation.json`.
