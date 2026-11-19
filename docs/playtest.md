# The Bread Ledger live model playtest

One scripted internal A/B run compared Harbinger’s local play endpoint with a transcript-and-summary narrator. Both used GPT-6 Luna through OpenAI Chat Completions with reasoning effort `none`. The app used a fresh temporary SQLite database. The fixture used an invented story and no player data. Harbinger’s public story passages are authored by the app, and the model selects or interprets configured choices where applicable. The baseline model authored its own narration and updated its own summary. [OpenAI model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

## Repeatable scenario

Begin a fresh save at Alice’s bakehouse in London. In arm A, submit the following through `POST /api/saves/{id}/turns` with the latest committed revision and a new request ID. In arm B, start with the same opening paragraphs and a summary of the known opening events. Each subsequent request receives the opening, the last five action and narration pairs, the prior model-written summary, and the current player action. Use the same inputs in the order below.

1. Ask Martin about the proclamation
2. Promise Alice discretion
3. Ask Alice what brought Guenever to London
4. Keep Alice’s confidence
5. Ask Martin what brought Guenever to London
6. Go with Alice to the river
7. Visit the riverside storehouse
8. I invite the porter to supper at my house after his shift.
9. Return to the Thames landing
10. Help Alice load the flour
11. Read the guild notice
12. Offer to help Alice start again

Immediately after step 3, duplicate the save in arm A and copy the transcript and summary in arm B. In both copies, submit `Tell Martin what Alice said about the Queen` and then repeat step 5. Compare the answer to step 5 with and without the prior disclosure. Inspect the final Harbinger testing view separately to check that Alice’s private recall appears there and that the normal story payload leaves it private.

The baseline’s system instruction follows. The baseline received the same key story constraints and a marked private phrase to make premature disclosure observable.

> You run the solo historical fantasy episode The Bread Ledger in Malory Book XXI. Only narrate attempted actions and support free text. Keep time moving through actual actions, use limited viewpoint, distinguish claims from confirmed facts, and keep actor secrets private. London, dawn to after dusk. Mordred has not yet discovered Guenever has reached the Tower. He actually ordered letters reporting Arthur dead, which stays private unless an explicit evidence channel appears. Martin accepts the crier’s report, and Alice doubts it. Martin knows the pretext of buying wedding supplies. Alice and her carter know Guenever visibly entered the Tower. Alice can confidentially share this with the clerk if promised discretion. Martin can know Alice’s account only if the clerk explicitly tells him. Alice privately knows a phrase [insert the seed phrase from Alice’s opening thought in the testing view]. Access to the phrase requires Alice to authorize a disclosure. The clerk can hide the delivery names, help with the flour, and find out about a missed guild inspection at dusk from a reachable witness or the written order. Offer a meaningful ending if the clerk helps Alice start again. Reply in JSON only with narration (up to 90 words), summary (up to 140 words, enough for continuity), and ended (boolean).

Initialize the summary with the opening rumor attributed to the crier, Martin’s dusk ledger deadline, Alice’s old surety, and her invitation to meet near the river. Give Martin only the known wedding pretext in player-visible narration until the clerk tells him Alice’s account. Observe whether he attributes newly learned information to the clerk. Count accepted turns from revision changes in Harbinger and JSON narrations in the baseline. Use client-observed request durations at the local API or baseline completion boundary. Include the two-turn duplicate in each arm’s token totals.

## Results

Ran on November 18, 2026, local time in Mexico City. Each arm attempted 12 turns on the river route and two on its duplicate. Both arms used the same model and received the same player actions. Harbinger’s turns sometimes use several short model calls, while others resolve locally. The baseline makes one call per turn. Costs use returned token usage and standard text rates of $0.10 per million input tokens and $0.50 per million output tokens. Reported cached input was zero in both arms. [OpenAI model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

| Measure | Harbinger | Transcript and summary |
| --- | ---: | ---: |
| Accepted turns, including duplicate probes | 14 of 14 | 14 of 14 |
| Main episode marked complete | 1 of 1 | 0 of 1 |
| Median accepted turn | 1,009 ms | 2,914 ms |
| 95th-percentile accepted turn | 2,147 ms | 3,344 ms |
| OpenAI requests | 14 | 14 |
| Input tokens | 4,561 | 11,475 |
| Output tokens | 182 | 2,761 |
| Estimated cost, including duplicate probes | $0.0005471 | $0.0025280 |
| API errors or retries | 0 | 0 |
| Public responses containing the private phrase | 0 | 0 |

The p95 is nearest rank and therefore the maximum of each 14-turn sample. Total estimated model cost was $0.0030751 for 28 requests, including the extra disclosure probe in each arm. Harbinger’s accepted count includes an input that received a generic spoken response. The baseline’s completion count uses its `ended` field. Its final narration provided a coda and said Martin was still waiting for the ledger.

### Canon, disclosure, and agency

- **The paired witness mattered in Harbinger.** Martin initially said wedding supplies were the only business on record. When the duplicate clerk explicitly told him what Alice had said, he entered it as the clerk’s account and asked for a witness before treating it as fact. The baseline omitted the public wedding pretext in both forks. In the disclosure fork, it narrated keeping Alice’s confidence despite the opposite input, then left Martin unaware of what the clerk had asked to disclose.
- **The inspection carried through to an ending.** Harbinger had the witness bring news of the sealed oven and the notice confirm the inspection before Alice asked the clerk to return at first light. The baseline changed where the guild inspected and treated flour as delivered before later sending Alice to buy and load it. Its final response still left the ledger deadline unresolved.
- **The private phrase stayed out of public output.** Harbinger returned it only in Alice’s entry in the opted-in testing data. Neither arm included the exact phrase in public responses. The baseline did give Martin a line about Alice’s disbelief without establishing how he learned it, so the exact phrase check alone misses some viewpoint errors.
- **The unsupported invitation exposed a difference.** Harbinger accepted the supper invitation as speech and returned “You speak into the room.” The porter did not answer or make a plan. The baseline let the porter tentatively accept. Count this as one reasonable action with an unresolved interaction in Harbinger even though the turn committed.

### Interface responsiveness

Measured Journal activation in local headless Edge with fixed app responses, separately from model latency. For eight trusted clicks at each viewport, measured from the click handler through the next two animation frames and verified the Journal was expanded. Closed the narrow Journal with Escape between samples. Median was 14 ms at both 320 and 1,280 CSS pixels. The maximums were 14 ms and 15 ms, respectively. This is a local measurement of one interaction on one machine, separate from field Interaction to Next Paint. [Web Vitals guidance](https://web.dev/articles/vitals)

The release suite passed 32 Playwright checks. The integrated route ran at 320 and 1,280 CSS pixels with keyboard navigation, focus restoration, a retained draft, the inspector, Journal sources, and portable saves. At both widths Chromium's accessibility tree exposed the turn message as a status with a polite, atomic live region. A spoken screen-reader run remains unverified.

### Reader feedback and limitations

An internal Codex reviewer read both endings and recognized the spare key as the concrete sign of Alice withdrawing trust. The reviewer wanted to see what happened to the people named in the ledger. The direct ending now includes a guild summons for the carter. The reviewer also preferred the response that attributed the relayed account to the clerk and asked for a witness. Human reader feedback remains pending, including whether the Journal helps retrieve evidence and whether either outcome makes the story worth replaying.

This run covers the river route, a generated storehouse encounter, one private witness interaction, and a paired disclosure after duplicating the save. It compares whole systems with different jobs for the model. Harbinger selects from authored lines and uses a structured world, while the baseline writes full passages with a growing transcript. The timing and cost gap therefore applies to this workload. Multiple fresh runs with human readers and additional scenes would be needed to estimate typical replay interest, performance, and unsupported actions.
