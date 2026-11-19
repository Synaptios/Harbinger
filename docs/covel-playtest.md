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
