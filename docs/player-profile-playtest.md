# Player profile playtest

The campaign runs 10 scripted player profiles through the same five Bread Ledger routes, with 10 player turns per route. The routes cover the guild, a promise of confidence, a market investigation, work at the storehouse, and pressure on Alice’s boundaries. The active control keeps all 50 original input strings and action kinds. The other profiles keep the route decisions, vary 10 directed speech inputs, and submit movement as native actions. The murder-hobo variant uses threats and the existing ledger interruption. Its results describe how the story responds to those inputs.

Each round uses a new isolated save for each route. The five routes run concurrently within a round. After grading the saved passages, the next round runs with updated prompts or logic. The exact control comes last. Scores from different profiles reflect both the inputs and the build used for that round.

## Pacing director tested in this campaign

In this campaign's final build, the shared and Bread Ledger prompts formed one system message for the dedicated `pacing-director` role. The game prompt defined why the guild's decisions, Alice's relationships, and the next morning's bread mattered. The model received the resolved public beat, recent public beats, current choices, and available ways to emphasize the turn. [Current long-range director](architecture.md#model-roles-in-covel)

The director returns one offered beat ID or leaves the emphasis to the composer. The composer can give the selected beat more space or use it to end the passage. The world engine resolves the player’s input and keeps every established outcome. The director sees only its public briefing. The original inspection director still handles eligible ways to discover a missed inspection. NPCs receive their own Hindsight evidence, and the narrator composes the public passage. The pacing request runs concurrently with NPC thought generation.

NovelOS runs offline against the passages Covel committed. Its Guardian rates pacing, voice, responsiveness, and specificity on a 1–5 scale. The harness separately measures elapsed time from submission to commit, counts the saved player action and story response, and records provider waits. The p95 uses the nearest-rank percentile. Media generation and offline grading are outside the turn timing. No runtime fact checker participated.

## Results

All 500 turns were committed exactly once, with one saved player action and one story response per turn. Every response was 202–278 words. Across the campaign, median latency was 0.50 seconds and p95 was 1.85 seconds. The slowest profile's p95 was 3.20 seconds.

| Player profile | Voice / 5 | Pacing / 5 | Words | p95 | Pacing director calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| passive | 4.80 | 4.02 | 215–273 | 1.12 s | 0 |
| cautious | 4.80 | 4.02 | 206–278 | 1.85 s | 0 |
| cooperative | 4.86 | 4.00 | 206–274 | 1.34 s | 0 |
| curious | 4.90 | 4.02 | 206–277 | 1.24 s | 0 |
| pragmatic | 4.82 | 4.00 | 208–267 | 1.59 s | 0 |
| assertive | 4.90 | 4.04 | 206–267 | 1.29 s | 0 |
| suspicious | 4.84 | 4.04 | 203–265 | 1.65 s | 44 |
| confrontational | 4.80 | 4.02 | 206–265 | 1.95 s | 43 |
| murder-hobo | 4.88 | 4.02 | 206–265 | 3.20 s | 45 |
| active-control | 4.88 | 4.00 | 202–267 | 2.21 s | 43 |

The exact 50-turn control matched the prior input sequence and action kinds. Voice rose from **4.78 to 4.88**, exceeding the earlier 4.82 reading. Pacing moved from **4.02 to 4.00**. The control does not show a pacing score improvement. Control p95 increased from **1.01 to 2.21 seconds** and stayed below the five-second target. Every control response was 202–267 words. [Prior control evaluation](../.harbinger/playtest/novelos-varied-evaluation.json) · [New control evaluation](../.harbinger/playtest/player-profile-campaign/10-active-control-evaluation.json)

The pacing director was added after the sixth profile. Across the final four live profiles it ran 175 times, influenced 170 passages, and supplied the closing beat in 142. Those counts measure application of the suggestion. The prose scores above measure perceived pacing. The final adjustment asks the director to choose among distinct story consequences or character beats and skips repeated explanations. That adjustment passed fixtures after the last live profile.

Seventy-nine turns crossed at least one provider instrumentation threshold and kept waiting. Two complete turns exceeded five seconds. Cooperative boundary-pushing turn 9 took **11.66 seconds**, including a 10.68-second inspection-staging request. Active-control practical-helper turn 5 took **9.36 seconds**, including a 9.31-second pacing request about the tally. Both providers returned and both turns saved normally. No wait ended in a provider timeout or caused an authored substitution.

## Grounding review

NovelOS returned 500 valid grades and raised zero knowledge leaks, invented player actions, invented world effects, unsupported claims, or prompt echoes. It recorded zero exact paragraph reuse within each profile. Independent review still found two narrator problems in early rounds. A wedding rumor was described as circulating longer than the records supported, and the market order was worded as if the missing ledger were present. Both optional passages were excluded from selection after the pragmatic round, and both were absent throughout rounds six to nine.

All ten hostile replies acknowledged or redirected the spoken threat. The saved events remained speech. Three live replies nonetheless introduced unsupported details. Alice invented a Michaelmas flour debt in guild-first turn 6, reversed who stopped whom at the ledger in boundary-pushing turn 3, and presumed raised fists and a new dawn arrangement in practical-helper turn 1. NovelOS missed all three. The following build separated a brief generated verbal reaction from the selected authorized record reply. Fixtures covered that boundary and repeated questions. The hostile profile ran once, so the modified threat path has no second live score.

## Adjustments after each round

| Completed profile | Change before the next run |
| --- | --- |
| passive | The porter’s tally turn kept repeating the chalk and sack procedure across distinct paragraphs. Added a preference against repeating the same active subject among optional narration details, and steered careful record replies toward one useful detail. |
| cautious | The cautious replay kept the action first but quiet answers still ended on unrelated room texture. Favor an existing consequence or actor-specific detail as a closing beat. Ask speakers to end on a useful request, consequence, or honest limit. |
| cooperative | Open a voiced exchange on the NPC’s answer, keep the existing meeting decision as its close, and favor work-specific requests in response to offers of help. |
| curious | Lower the optional narration target from 220 to 208 words to reduce the decorative tail, and direct NPCs to name one thing the player can verify or do. |
| pragmatic | Close the two recovery endings on Alice’s consequential line, make four redundant or ambiguous narrator details ineligible, and have NPCs communicate stance through their trade and existing trust. |
| assertive | Add a dedicated pacing director with a shared base prompt and Bread Ledger game prompt. Give it public, eligible developments to spotlight and run the request in parallel with private thoughts. |
| suspicious | Distinguish eligible consequences and character reactions from setting detail in the director’s briefing, tell it to choose a playable development, and direct skeptical dialogue toward what could settle an account. |
| confrontational | Let an NPC respond in their own voice to an explicit spoken threat using the same narrow Hindsight evidence and no assumed action or appointment. Ordinary record questions keep their established answer choices. |
| murder-hobo | Replace freeform threat answers about known records with an optional one-sentence verbal reaction plus a selected eligible answer. The prompt reserves facts, commitments, and past actions for the authorized record. |
| active-control | Send the director only consequential and character beats, skip routine explanations or scenes without meaningful alternatives, and keep one tally explanation per turn. Count the recorded answer as used even when an NPC prefaced it with a generated reaction. |

The raw transcripts, Guardian grades, digests, and prompt snapshots are in `.harbinger/playtest/player-profile-campaign/`. The game saved the passages used for all scoring. The evaluator used [NovelOS revision 4410606](https://github.com/mrigankad/NovelOS/tree/44106062149b5f179da683cb65e4574e75411ffe) with GPT‑4.1.

The final build passed all 129 Playwright tests. Harbinger restarted on the local port with the pacing role active. The existing save's transcript and enabled plugins matched the pre-restart snapshot.
