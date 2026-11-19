# Dramatica Flow playtest

Ten existing player profiles start in fresh, isolated Bread Ledger saves. Each plays 50 turns in five blocks of ten. The same saves and player policies carry across blocks. The initial story passage is turn zero. Prompt and world changes apply only to later blocks. NovelOS grades the original committed text with the same GPT‑4.1 model and rubric used in the previous playtest.

The new campaign starts with an immediate conflict around the dawn bread tally. It uses Dramatica Flow's Architect-to-Writer handoff and gives the live writer the resulting scene structure, evidence, and grounded choice. The actor still receives their own evidence and Hindsight retrieval. The writer brief documents the offline execution of the upstream prompt builders and their English adaptation. [Writer brief](dramatica-flow-writer-brief.md)

The comparison spans different game runs. The previous 500-turn reference used short scenario routes and averaged 4.018 for pacing and 4.848 for voice. The final block of the 5,000-turn continuation averaged 4.021 for pacing and 4.262 for voice. The new targets are 4.5 and 4.8. The evaluator's direct-start mode skips seeding the legacy oven plot that this campaign never opens. The historical results remain as originally graded. [Prior short playthroughs](player-profile-playtest.md) · [Long campaign](long-profile-playtest.md)

## Prompt review

Prompt Architect rates clarity, specificity, context, completeness, and structure on a separate 1–10 scale. CO-STAR supplies the narrator's viewpoint, scene task, tone, and response. The actor prompt uses a speaker, an immediate goal, authorized evidence, and a typed reply. The ratings assess the prompts as written. NovelOS grades what they actually produced. [Prompt Architect](https://github.com/ckelsoe/prompt-architect/blob/main/skills/prompt-architect/SKILL.md)

| Build | Prompt | Five ratings | Mean |
|---|---|---|---:|
| Turns 1–10 | Dramatica narrator | 9 / 7 / 8 / 8 / 9 | 8.2 |
| Turns 1–10 | Dramatica actor | 9 / 7 / 8 / 8 / 8 | 8.0 |
| Turns 11–20 | Narrator with explicit perception and beat guidance | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Turns 11–20 | Actor with a single speaker's voice brief | 9 / 9 / 9 / 8 / 9 | 8.8 |
| Turns 21–30 | Narrator with source-only access to unverified report text | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Turns 21–30 | Actor with a short finished reply and output headroom | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Turns 31–40 | Narrator with two distinct beats and the word budget shared with Character | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Turns 31–40 | Actor response to a witnessed act | 9 / 9 / 9 / 9 / 9 | 9.0 |
| Turns 41–50 | Narrator with sourced actor ownership and completed work distinguished from permission | 9 / 9 / 9 / 9 / 10 | 9.2 |
| Turns 41–50 | Actor with a personal stake, room for voice, and a complete-sentence retry | 9 / 9 / 9 / 9 / 9 | 9.0 |

## Changes between blocks

- **Before block 1.** Start at the live conflict. Go from evidence to decision and consequence. Use the case outcome to offer connected conflicts. Give a speaker the attributed result and run their reaction alongside the narrator.
- **After block 1.** Separate newly visible evidence and reported information in the narrator's input. Give each scene phase its own job. On a pure observation, keep the focus on known pressure. Give each actor only their own voice brief and use a plain-text Character response for a single line of speech. Shorten the passage from decision to concrete work and give deference a meaningful exit.
- **After block 2.** Turn decisions into case-specific physical or logistical work. Give the narrator the source of an unverified report while retaining its attributed wording in the manuscript. Replace the recurring invitation to return with the concrete remaining job or a settled result. Ask actors for one or two complete sentences with a higher token ceiling. Accept the previous release's saved menu labels at resume.
- **After block 3.** Give witnesses a concrete act on arrival or reveal, with an attributed effect and optional next work when evidence supports it. Use two narrator paragraphs with distinct functions and count expected speech toward the total. Replace short drafts through fresh generation. The Story model completed 74 of 100 fourth-block turns on its first call, up from 30 in block three.
- **After block 4.** Offer specific player choices that combine examination and bounded work. Keep precaution, permission, and completed work distinct in the sourced beat, with the actor who owns it. Restore room for a full character reply. If the provider indicates it cut the reply off, ask it for one shorter complete sentence.

## Results

The five original turn archives matched 500 valid NovelOS grades for 500 distinct, exactly-once saves. Each profile saved 50 turns. The pooled numbers include the first block and each later tuning experiment. [Campaign results](../.harbinger/playtest/dramatica-profile-campaign/campaign-report.json)

| Turns per profile | Pacing / 5 | Voice / 5 | Responsiveness / 5 | 200–300 words | p95 |
|---|---:|---:|---:|---:|---:|
| 1–10 | 4.010 | 4.740 | 4.900 | 100/100 | 3.957 s |
| 11–20 | 4.150 | 4.920 | 4.980 | 100/100 | 3.854 s |
| 21–30 | 4.090 | 4.750 | 4.930 | 100/100 | 4.736 s |
| 31–40 | 4.070 | 4.610 | 4.950 | 100/100 | 4.547 s |
| 41–50 | 4.090 | 4.710 | 4.940 | 95/100 | 7.774 s |
| All turns | 4.082 | 4.746 | 4.940 | 495/500 | 5.065 s |

Pacing peaked at 4.15 and fell short of 4.5. Voice reached 4.92 in the second block and finished the full run at 4.746. The final build scored 4.09 for pacing and 4.71 for voice in its 100 live turns. It added 11 expedited actions, including four that verified the source and did the bounded work that turn. Curious turn 46 checked and separated two receipts in one action. Cooperative turn 47 granted permission to fetch a tool while preserving who was responsible for the room. Those permissions stayed distinct from completed work in both final-block permission turns.

The strongest early pacing scores came from decisions that changed what someone could do, especially when a reported account became verified before the player acted. Twelve of 45 second-block decisions earned fives. Later witness preparation improved the saved scene, yet only one of 36 fourth-block turns with that initiative earned a pacing five. The independent audit still found repeated adjudication and occasional claims that transferred an NPC's work to the clerk. NovelOS gave frequent missing-character warnings on purposeful changes of cast. The audit verified that those characters were offstage. It could not isolate the warnings' impact on voice or pacing.

| Profile | Overall pacing | Overall voice | Final-block pacing | Final-block voice | Overall p95 |
|---|---:|---:|---:|---:|---:|
| Passive | 4.12 | 4.84 | 4.30 | 4.80 | 4.564 s |
| Cautious | 4.10 | 4.74 | 4.20 | 4.80 | 5.307 s |
| Cooperative | 4.08 | 4.66 | 4.00 | 4.60 | 5.890 s |
| Curious | 4.16 | 4.72 | 4.20 | 4.80 | 4.536 s |
| Pragmatic | 4.08 | 4.72 | 4.00 | 4.50 | 13.779 s |
| Assertive | 4.02 | 4.78 | 4.00 | 4.60 | 4.547 s |
| Suspicious | 4.12 | 4.88 | 4.00 | 4.90 | 4.826 s |
| Confrontational | 4.00 | 4.76 | 4.10 | 4.90 | 4.732 s |
| Murder hobo | 4.08 | 4.68 | 4.10 | 4.80 | 4.537 s |
| Active control | 4.06 | 4.68 | 4.00 | 4.40 | 5.276 s |

## Save and generation checks

The harness waited out 315 turns with observed provider waits and recorded no terminal stall. One second-block turn saved a clarification because the next build had changed the menu label from an older save. A compatibility fix now accepts the original label. The clarification remained in the graded turns.

The fifth block's five short turns had no published actor reply and used four to six Story calls. The longer-reply experiment coincided with more omitted dialogue and an extra sequence of Story retries for length. After turn 50, the build returned to a smaller provisional dialogue allowance and limits final length repair to one fresh generation. A failed repair preserves the first complete provider draft. This correction is outside the measured 500 turns.

All 180 tests in the native Covel and browser suite passed. The post-campaign correction passed 35 focused tests. The campaign used Hindsight and the existing actor evidence boundaries. The grounding review and NovelOS grading ran offline on the committed prose.
