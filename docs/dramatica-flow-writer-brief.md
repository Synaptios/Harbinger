# Dramatica Flow and The Bread Ledger

Dramatica Flow's Architect gives its Writer the conflict between a goal and an obstacle, an ordered beat sequence, a pacing note, a hook that can advance, and specific risks to continuity. The Writer receives the blueprint along with a viewpoint, recent causes, and a style guide. This brief uses the same handoff for a game where the engine resolves the action before the Writer describes it. [Pinned Architect and Writer](https://github.com/ydsgangge-ux/dramatica-flow/blob/1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315/core/agents/__init__.py) · [Outline template](https://github.com/ydsgangge-ux/dramatica-flow/blob/1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315/templates/outline_import_template.md)

## Give the Writer a scene

1. Name the particular thing at stake today. A baker can use some dry wood before the first firing. A lost half-mark may prevent someone from recognizing a sack at the handoff. A permit can affect whether a stall opens.
2. Give the scene its current source, place, people, and allowable change. Mark what has already been printed, what can be seen firsthand, what was attributed, and what is still unavailable. Give each actor only the source and relevant Hindsight memories they possess.
3. Choose the scene's job from the present action. A reply can answer a challenge. A decision changes who can do the work. A consequence can make the cost of a previous choice arrive. A transition brings in the next practical obstacle.
4. For an ongoing pursuit, keep the initiating event, the NPC's own objective, the next obstacle, and the public trace of eventual work. Advance only the step now eligible. A later consequence can occur offstage if someone with the right position and knowledge carries it. Let the clerk find the trace on their own terms.

## Narrator brief

> Begin with what the clerk's move has just changed. After the engine's visible result, follow one cause through the next available choice, obstacle, or piece of work. Write from the clerk's immediate perspective in second-person present. Use the evidence and practical stakes at hand. Keep an unseen thing out of the description and leave an attributed claim with its speaker. Give each paragraph a fresh job. Close on who can act, what they can do, or the specific question they can answer. Aim for 200–300 words including the supplied action and dialogue.

Use dialogue supplied by the character pass. Public motion, sensory detail, and practical stakes should come from the current scene. The Writer can let a cost bear emotional weight without assigning feelings to the clerk or exposing anyone's private thoughts. A report left under a source's name can give the next person a place to ask. A verified line can let specific work go ahead. A held or deferred decision can leave a real job with the people entitled to do it.

## Actor brief

Use the actor's immediate goal to decide what they volunteer and what they press for. Let their trade shape the words they choose. Keep the speaker's immediate reaction, the evidence they can answer for, and any feasible offer grounded in that person's own position.

| Person | Work they protect | How it sounds |
| --- | --- | --- |
| Alice | Usable flour and fuel, bread for people coming early, the names she has been entrusted with | She starts with what can be done before the next firing. Affection and resentment can come through what she is willing to do herself. |
| Martin | The entry someone will later have to read and answer for | He separates the person who witnessed the thing, the hand that brought it, and the person whose name belongs on the account. |
| Guild runner | Delivering the right paper and saying where it changed hands | Brief, precise, and clear about when their own sight ended. |
| Market baker | The use already promised and the work the oven can still take | Speaks in hours, heat, fuel, and trays. |
| Market carter | The mark, receipt, and person actually responsible for each hire | Direct. Starts from the thing that distinguishes the two accounts. |
| River carter | The load that reached the landing and what was done at the handoff | Short sentences, with places, loads, and times in the foreground. |

## Worked pre-write example

For **The seal under the fold**, the guild runner handled the paper and can say when they noticed the seal. Martin needs an entry he can defend before deciding how to proceed. Those purposes put pressure on the same document. Keep two different briefs for two different engine results.

| Engine result | Next eligible beat | Remaining tension |
| --- | --- | --- |
| The clerk asks to examine the permit and it is still pending | Who can make the permit available or account for when it was received? | The clerk has asked for a source and still needs to see it. Save details about the wax for that moment. |
| The clerk is shown that the two wax edges line up | The record can describe where the wax sits and what its condition shows. | The runner still cannot establish who stamped it. Leave any change in the stall's position conditional until the engine makes that change. |

A later, independently available hook is whether the same person records where the wax sits before asking who stamped another paper. A case closure can support that practice. A subsequent save must establish the work or report before it becomes a payoff. The first chapter, the case catalog, and the permitted practice come from Harbinger's existing world and follow-up rules. [World](../covel/worlds/bread-ledger/WORLD.md) · [Case catalog](../app/campaign-cases.mjs) · [Follow-up rules](../app/campaign-followups.mjs)

## Reproduce the prompt handoff

From the repository root, use a Python 3.11+ interpreter that already has Pydantic v2. The local NovelOS environment also works. The recorder runs the reviewed upstream Architect and Writer prompt builders with a fixed planning fixture. It captures the two messages each stage would send and the parsed blueprint, uses an in-memory provider, and clears inherited environment variables before importing the checkout. The fixture has no player output. [Upstream pipeline](https://github.com/ydsgangge-ux/dramatica-flow/blob/1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315/core/pipeline.py) · [MIT license](https://github.com/ydsgangge-ux/dramatica-flow/blob/1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315/LICENSE)

```powershell
git clone --no-checkout https://github.com/ydsgangge-ux/dramatica-flow .harbinger/dramatica-flow-upstream
git -C .harbinger/dramatica-flow-upstream checkout --detach 1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315
.harbinger/novelos-eval/venv/Scripts/python.exe -I docs/dramatica-flow-prewrite.py
```

Use the output to design prompts before a test block. The English fragments above adapt the upstream Chinese-language prompts for Harbinger's live Writer and character passes. NovelOS can assess responsiveness, pacing, and voice from completed turns. Dramatica Flow's post-write validation and revision stages are outside this workflow.
