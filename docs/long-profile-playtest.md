# Long-profile playtest

The campaign runs ten player profiles in separate Covel saves. Each profile continues for 500 player turns. A round contains the next 100 turns in each save. The profiles run concurrently, and the prompts and game logic stay frozen within a round. At each boundary the next build uses the offline review of that round.

Each profile starts on an assigned legacy route. After its authored ending, it can return the next morning and continue through recurring local cases. The clerk can investigate, assist, challenge, leave a question open, or ask a person directly. People and their later accounts can change with prior decisions and the pacing director's choices. Standard Bread Ledger sessions keep their original endings.

## Measurement

NovelOS Guardian uses the pinned revision and GPT‑4.1 rubric from the 50-turn campaign. It grades the prose saved by Covel on the same 1–5 scale, using the exact player action, the current canonical evidence, and relevant prior chapters. The 4.9 targets apply to responsiveness and pacing. Voice is also compared with the prior campaign. The prior results used five short routes per profile. Each long run follows one continuing save, so a score change includes the different story and turns. [Prior 50-turn campaign](player-profile-playtest.md)

Latency is measured from the accepted action request on its successful attempt to its commit. All provider waits in that window count. Infrastructure recovery and earlier rolled-back attempts are documented separately. The report also measures latency with the test runner's local request throttling included. The runner checks the native action, story, and commit in SQLite and verifies the manuscript against the passage that Covel saved. Word count is measured on the native story. Exact native passages, their proofs, decisions, and the grader output are retained under `.harbinger/playtest/long-profile-campaign/`.

The player inputs and prose stay as committed. Changes between rounds apply to future generation and world resolution.

Round two exposed a 256 KiB limit on individual Covel save values. Nine uncommitted requests hit the limit. Their input IDs and receipts were checked, and the same requests resumed from their last saved revision after private history was partitioned. The original commits and narration remained intact. The technical storage change kept the round's generation sources fixed.

## Prompt review

Prompt Architect 3.5.1 was introduced after turn 300 of each profile. The ratings below are design judgments on a 1–10 scale, in the order clarity, specificity, context, completeness, and structure. NovelOS independently grades saved prose on its 1–5 scale. The player brief, campaign transcripts, live request shape, and schemas supplied the material for the review. [Prompt Architect skill](https://github.com/ckelsoe/prompt-architect/blob/main/skills/prompt-architect/SKILL.md)

| Prompt | Initial ratings | Mean | Review |
|---|---|---:|---|
| Campaign narrator and field directions | 8 / 7 / 8 / 7 / 8 | 7.6 | CO-STAR. Give the clerk's action and the immediate consequence priority. Identify the evidence change, keep each paragraph distinct, and reserve dialogue for characters. |
| Narrator bridge for short drafts | 8 / 7 / 7 / 8 / 8 | 7.6 | Keep the short form. Add one new beat supported by the same evidence, with distinct drafted topics supplied as constraints. |
| Character dialogue and campaign suffix | 9 / 8 / 9 / 8 / 7 | 8.2 | Prioritize a spoken answer and one usable detail. Clarify attribution, unknown facts, and the speaker's role when threatened. |
| Known-record reply selector | 9 / 9 / 8 / 9 / 9 | 8.8 | Keep exact option IDs and the schema. |
| NPC reaction to a menu choice | 9 / 9 / 9 / 8 / 8 | 8.6 | Tie the response to the case phase and clarify the JSON speech field. |
| State intent parser | 8 / 9 / 8 / 8 / 8 | 8.2 | Clarify how to preserve valid clauses around an unclear clause when next changing this prompt. |
| Storehouse appearance selector | 9 / 9 / 8 / 9 / 9 | 8.8 | Keep exact eligible IDs and the optional return. |
| Initial inspection opportunity and staging | 8 / 7 / 7 / 7 / 9 and 9 / 9 / 7 / 8 / 9 | 7.6 and 8.4 | The opening remained fixed for the comparison. |
| Private thought selection | 9 / 8 / 8 / 8 / 9 | 8.4 | The campaign supplies a single first-person line and needs no selection call. |
| Universal director scout | 8 / 8 / 8 / 7 / 7 | 7.6 | RACE. Ground each possible trajectory in a supplied action, obligation, or source. |
| Director selection | 8 / 7 / 9 / 8 / 8 | 8.0 | Prioritize the concrete consequence of an earlier decision and clarify how to keep the saved plans. |
| Bread Ledger director policy | 8 / 8 / 9 / 8 / 8 | 8.2 | Favor a change in what an established NPC can do or what it costs them. |
| Director candidate output contract | 9 / 9 / 8 / 8 / 9 | 8.6 | Keep the existing enum and bounded proposals. |
| Public recap | 9 / 8 / 8 / 8 / 8 | 8.2 | The resolved campaign uses scoped evidence and bypasses public recap generation. |
| Public safety classification | 9 / 9 / 8 / 9 / 8 | 8.6 | Keep the narrow task and boolean output contract. |
| NovelOS review, grounding, and Guardian | 9 / 9 / 8 / 9 / 8, 9 / 9 / 9 / 8 / 7, and 9 / 8 / 8 / 9 / 9 | 8.6, 8.4, and 8.6 | Keep the evaluation rubric fixed across all rounds. |

Hindsight receives scoped retrieval queries and memory records. There is no Harbinger-authored generation prompt in that step. The compact NovelOS evidence snapshot can omit the opening inspection record after the inspection has resolved. Treat later dormant-inspection warnings as a limitation of those diagnostics.

| Revised prompt | Round | Revised ratings | Mean |
|---|---:|---|---:|
| Campaign narrator and field directions | 4 | 9 / 9 / 9 / 9 / 8 | 8.8 |
| Campaign narrator with pending-examination fields | 5 | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Character dialogue and campaign suffix | 4 | 9 / 9 / 9 / 8 / 8 | 8.6 |
| NPC reaction with a specified speech field | 4 | 9 / 9 / 9 / 8 / 9 | 8.8 |
| NPC reaction with explicit evidence limits | 5 | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Universal director scout, reassessed against the reply schema | 5 | 9 / 8 / 9 / 8 / 8 | 8.4 |
| Universal director scout with the exact object contract | After 500 | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Director selection | 5 | 9 / 9 / 9 / 9 / 8 | 8.8 |
| Bread Ledger director policy | 5 | 9 / 9 / 9 / 8 / 9 | 8.8 |

## Changes between rounds

- **After turn 100.** Draft the scene's distinct parts together, with a short addition if needed. Give Story the current case only and scope NPC retrieval to the current case unless the player explicitly requests a memory. Add longer pursuits drawn from recorded decisions.
- **After turn 200.** Make the inspection follow-through reflect what was verified, reported, held, or deferred. Separate older payoffs from the current case draft and shorten direct Character calls.
- **After turn 300.** Pass new and earlier evidence as separate inputs. Ask Story to end on a concrete next possibility. Generate short NPC reactions on selected consequential choices in parallel with Story.
- **After turn 400.** Apply Prompt Architect's evidence and outcome distinctions to the narrator and both director stages. Give pending inspections their own instructions. Keep NPC reactions within the result and the speaker's responsibility, using Hindsight to rank eligible supporting observations. Let a disclosed precedent offer a concrete action when a fresh decision in the same case permits that work.

## Arc examples

The ten final saves contain 150 completed director pursuits. Players witnessed 33, learned of another 115 through attributed reports, and had yet to discover two by turn 500.

- **Curious, turns 173–280.** The clerk verifies the seam and handoff mark on a low-sided sack while leaving the time of the tear open. The director takes up the decision at turn 200, and the carter's practice changes by turn 218. The clerk learns from the carter at turn 236 that he will check the seam and handoff mark together before moving usable flour. The practice returns with a new case at turn 280.
- **Confrontational, turns 167–274.** In the same kind of case, this clerk keeps the disputed claim out. The carter completes his pursuit offstage by turn 210. At turn 224, the clerk hears that the carter will record the damage separately from where the sack tore. That different practice returns at turn 274.
- **Cautious, turns 174–279.** The clerk records a loose handle on a borrowed peel, leaving replacement off the account. Alice adopts a repair-first practice in front of the clerk at turn 204. The practice is recalled with the next matching case at turn 279.

The final block recorded 40 actions that applied a disclosed practice to a later case. At confrontational turn 406, the runner set a disputed two-date slip aside with its source attached and kept it out of the account. At curious turn 409, the baker set out the order for the two trays while leaving the later firing subject to oven heat. The journal records both the prior payoff and the new decision that allowed the work.

## Round results

| Round per profile | Turns | Exactly-once saves | 200–300 words | Word range | p95 | Turns with provider waits |
|---|---:|---:|---:|---:|---:|---:|
| 1–100 | 1,000 | 1,000 | 258 | 79–295 | 5.736 s | 98 |
| 101–200 | 1,000 | 1,000 | 999 | 195–274 | 4.460 s | 105 |
| 201–300 | 1,000 | 1,000 | 1,000 | 200–269 | 3.771 s | 94 |
| 301–400 | 1,000 | 1,000 | 1,000 | 200–289 | 3.989 s | 157 |
| 401–500 | 1,000 | 1,000 | 1,000 | 200–282 | 4.008 s | 126 |
| All rounds | 5,000 | 5,000 | 4,257 | 79–295 | 5.086 s | 580 |

Each profile reached 500 distinct player turns and finished below five seconds at p95 in its final block. With the baseline round excluded, the remaining 4,000 turns had a pooled p95 of 4.126 seconds and 3,999 were in range. The longest accepted turn took 17.655 seconds and committed. Elapsed times include provider waits, and the harness recorded no local request throttling or terminal provider stalls. Six first-block comparisons required Covel's own paragraph whitespace normalization to match the saved manuscript. The native action, story, and commit checks passed.

A Windows PID reuse left one profile's round-five database with a stale lock owned by a previous process. The harness resumed it at its first unsaved action after the stale lock was moved aside. The startup wait occurred before action acceptance. The round archive was assembled from the ten committed journals.

## NovelOS scores

The report matched all 5,000 valid scores to their captured action, saved manuscript, and timing. All five rounds used Guardian revision `44106062149b5f179da683cb65e4574e75411ffe`, GPT-4.1, and the same rubric. [Campaign report](../.harbinger/playtest/long-profile-campaign/campaign-report.json)

| Run | Graded turns | Responsiveness / 5 | Pacing / 5 | Voice / 5 | Specificity / 5 |
|---|---:|---:|---:|---:|---:|
| Prior short profiles | 500 | 4.618 | 4.018 | 4.848 | 4.864 |
| 1–100 | 1,000 | 4.585 | 4.078 | 4.394 | 4.249 |
| 101–200 | 1,000 | 4.331 | 4.013 | 4.256 | 4.164 |
| 201–300 | 1,000 | 4.331 | 4.021 | 4.257 | 4.131 |
| 301–400 | 1,000 | 4.361 | 4.018 | 4.220 | 4.144 |
| 401–500 | 1,000 | 4.404 | 4.021 | 4.262 | 4.173 |
| All long-profile rounds | 5,000 | 4.402 | 4.030 | 4.278 | 4.172 |

Responsiveness and pacing both fell short of 4.9. Final-block voice recovered from 4.220 to 4.262, below the earlier short profiles' 4.848. Pacing was effectively flat against the short profiles. Only 25 final-block turns earned a pacing five. The early review most often awarded those grades to decisions that visibly changed the work, such as separating the two receipts or setting dry fuel aside while leaving responsibility open. The NovelOS harness counted 286 reused paragraphs in the first block and 1,158 in the final block by exact matching.

| Profile | Final responsiveness | Prior pacing | Final pacing | Prior voice | Final voice | Final p95 |
|---|---:|---:|---:|---:|---:|---:|
| Passive | 4.23 | 4.02 | 4.00 | 4.80 | 4.20 | 3.357 s |
| Cautious | 4.38 | 4.02 | 4.04 | 4.80 | 4.23 | 3.218 s |
| Cooperative | 4.37 | 4.00 | 4.00 | 4.86 | 4.21 | 4.496 s |
| Curious | 4.54 | 4.02 | 4.09 | 4.90 | 4.42 | 4.008 s |
| Pragmatic | 4.40 | 4.00 | 4.01 | 4.82 | 4.16 | 4.594 s |
| Assertive | 4.45 | 4.04 | 4.00 | 4.90 | 4.23 | 3.503 s |
| Suspicious | 4.54 | 4.04 | 4.06 | 4.84 | 4.35 | 4.846 s |
| Confrontational | 4.33 | 4.02 | 3.99 | 4.80 | 4.27 | 3.962 s |
| Murder hobo | 4.45 | 4.02 | 4.00 | 4.88 | 4.27 | 3.698 s |
| Active control | 4.35 | 4.00 | 4.02 | 4.88 | 4.28 | 4.277 s |

## Grounding audit

An independent offline review examined the first 20 turns per profile in the fourth and fifth blocks. Apparent narrator-added speech fell from nine passages in the third-block sample to zero in both later samples. In the fourth block, 13 of 20 new NPC reactions clearly added unsupported work, obligations, or costs. In the fifth, 2 of 40 clearly added unsupported work or binding conditions and three raised attribution or status questions. The fifth-block errors included promising to mend a borrowed peel that day and giving an actor authority to hold a grain measure until Alice established a date.

All eight pending examinations in the fifth-block sample included at least one unsupported detail or condition. Guardian's grounding flags missed the errors found in the independent audit. NPC prompts receive only their authorized evidence, and the narrator receives the public record with its evidence status. Models still sometimes expand that evidence into unsupported claims. All checks of the finished narration and dialogue ran offline on saved passages.

All 168 repository tests passed after the director correction, including the native Covel and browser suites.

## Director correction after turn 500

Native traces recorded structured-output failures on 20 of 71 fourth-block scout reviews and 49 of 61 fifth-block reviews. Every accepted scouting response produced a successful selection. The traces identify a JSON or schema failure without recording the specific field. The prompt asked for an empty array in one case while the gateway required an object with an `avenues` field. The corrected prompt spells out the object contract and asks for short trajectories. The application keeps its 440-character limit for the proposal passed to selection.

A paired live check used the ten final saves read-only and ran just the director. The fifth-block contract produced one accepted scout and selection. The revised contract produced ten. This check wrote no story turns and contributes no grades or latency measurements to the 5,000-turn campaign. [Director contract probe](../.harbinger/playtest/long-profile-campaign/director-post-campaign-probe.json)
