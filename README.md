# Harbinger

Harbinger is a local character chat based on ReverieMem, the perspective-bounded memory architecture in *Staying in Character: Role-Playing Agents with Perspective-Bounded Memory* (arXiv:2606.25632v2). Its source is the Ortuzar-Prototype first-contact story bible, converted into [story JSON](story/ortuzar-first-contact.json) with PDF page references.

## Run locally

Use Node.js 22 or later.

```sh
npm start
```

Open [Harbinger](http://127.0.0.1:4173/). The server reads `OPENAI_API_KEY` and `OPENROUTER_API_KEY` from the environment or the local `.credentials` file. Both keys stay on the server. OpenAI model IDs go directly to OpenAI. Other model IDs go through OpenRouter.

Run `npm test` to check the chat and provider boundaries with test fixtures.

## Chat and memory

- **Chat** takes a character and an event cutoff. Start a conversation and expand the evidence under a reply to see which scenes and facts were retrieved. Changing the perspective starts a fresh conversation.
- **Story** shows the cast, locations, timeline, and knowledge grants. It also exports the JSON and lets you build memory for the selected character. The prepared story facts and brief scene recollections are available on startup. Building memory makes multiple model calls for each scene known to that character and adds emotional histories and behavioral patterns when the evidence supports them. Built memories are stored in `app-state/`.
- **Source-to-Memory**, **Reasoning**, and **Fusion** hold the model and prompt settings. Anchor and visibility-gated retrieval have separate embedding-model settings. Changes to a construction step take effect on the next build. The browser saves settings locally.

The story bible is an omniscient authoring document. The JSON therefore records explicit knowledge grants per event. Harbinger uses those grants as the limit for generated memories and applies character and event cutoffs before ranking evidence. Dates that the bible does not establish are described in relative terms. Unresolved plot threads are stored for reference and do not enter the chat memory.
