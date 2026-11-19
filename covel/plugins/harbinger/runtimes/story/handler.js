import { startEpisode, title } from '../../../../../app/episode.mjs';
import { recordThoughts } from '../../../../../app/thoughts.mjs';
import { resolveTurn } from '../../../../../app/turns.mjs';
import { createCovelActors } from '../../../../actors.mjs';
import { complexStateRole, inspectionDirector } from '../../../../directing.mjs';
import { storyModelProvider } from '../../../../model-settings.mjs';
import { createHindsight } from '../../../../hindsight.mjs';
import { requestStoryObject } from '../../../../narrator.mjs';
import { pacingDirector } from '../../../../pacing-director.mjs';
import { publicMediaCues } from '../../../../public-media.mjs';
import { composeResolvedPassage } from '../../../../resolved-passage.mjs';
import { readStoredStory } from '../../../../save-storage.mjs';
import { publishStoryTurn, readPublishedPassages } from '../../../../saves.mjs';
import { gamePacingPrompt } from '../../../../worlds/bread-ledger/pacing-prompt.mjs';

const memory = createHindsight();

function narration(paragraphs) {
  return { outcome: 'success', value: { segments: paragraphs.map(text => ({ kind: 'narration', text })), yield: 'user' } };
}

function roleCompletion(gateway, role, provider, budgets, { waitForProviders, noteWait }) {
  return async ({ name, instructions, context, schema, response, signal: attemptSignal, maxOutputTokens }) => {
    const signals = [provider.signal];
    if (attemptSignal) signals.push(attemptSignal);
    const budget = budgets?.[name];
    if (budget && !waitForProviders) signals.push(AbortSignal.timeout(budget));
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const started = noteWait && budget ? performance.now() : null;
    async function request() {
      if (!gateway) return requestStoryObject({ ...provider, signal }, { name, instructions, context, schema });
      const input = { presetId: role, system: instructions, prompt: JSON.stringify(context), signal, maxOutputTokens };
      if (response === 'speech') return { speech: (await gateway.generateText(input)).text };
      try {
        return (await gateway.generateObject({ ...input, schema })).object;
      } catch (error) {
        if (name !== 'harbinger_interpret' || error?.code !== 'SCHEMA_VALIDATION_FAILED') throw error;
        signal.throwIfAborted();
        return (await gateway.generateObject({
          ...input,
          schema,
          system: instructions + '\n\nThe previous reply did not match the required JSON shape. Return only the requested JSON object using the exact fields and types shown above.',
        })).object;
      }
    }
    let completed = false;
    try {
      signal.throwIfAborted();
      const value = await request();
      completed = true;
      return value;
    } catch (error) {
      throw signal.reason?.name === 'TimeoutError' ? signal.reason : error;
    } finally {
      if (started !== null && performance.now() - started >= budget) {
        noteWait({
          operation: name, thresholdMs: budget, durationMs: Math.round(performance.now() - started),
          outcome: completed ? 'completed' : 'failed',
        });
      }
    }
  };
}

export default async function story(ctx) {
  const activeProvider = storyModelProvider();
  const stored = await readStoredStory(ctx.pluginData);
  const previous = stored.save;
  const opening = !previous;
  const memoryIncarnation = previous?.memoryIncarnation ?? crypto.randomUUID();
  const playerText = ctx.playerActions.map(action => action.text?.trim()).filter(Boolean).join('\nThen ')
    || ctx.playerMessage;
  if (previous && !playerText) {
    // The native opening follows setup when a portable save was already restored.
    const chunks = [];
    for (const paragraph of (await readPublishedPassages(ctx.pluginData)).flatMap(passage => passage.paragraphs)) {
      const last = chunks.at(-1);
      if (last && last.length + paragraph.length + 2 <= 4000) chunks[chunks.length - 1] += '\n\n' + paragraph;
      else chunks.push(paragraph);
    }
    return narration(chunks.slice(-60));
  }
  const waitForProviders = process.env.HARBINGER_WAIT_FOR_PROVIDERS === '1';
  const reportStalls = process.env.HARBINGER_BENCHMARK_STALLS === '1';
  const signal = waitForProviders ? ctx.signal : AbortSignal.any([ctx.signal, AbortSignal.timeout(4_200)]);
  const provider = { ...activeProvider, signal };
  const gateway = process.env.HARBINGER_NATIVE_STORY_ROLE === '1' ? ctx.gateway : null;
  const complexRole = complexStateRole(gateway);
  const stalls = [];
  const waits = [];
  const noteStall = waitForProviders ? operation => stalls.push(operation) : undefined;
  const policy = { waitForProviders, noteWait: reportStalls ? wait => waits.push(wait) : undefined };
  const actors = createCovelActors(provider, {
    memory, noteStall,
    completeCharacter: roleCompletion(gateway, 'character', provider, {
      harbinger_actor_reply: 3_150, harbinger_actor_thought: 750,
    }, policy),
    completeState: roleCompletion(gateway, 'state', provider, { harbinger_interpret: 1_750, harbinger_storehouse: 1_650 }, policy),
    ...(complexRole && {
      completeComplexState: roleCompletion(gateway, complexRole, provider, { harbinger_storehouse: 1_650 }, policy),
    }),
    chooseInspection: inspectionDirector(gateway, signal, noteStall, policy),
  });
  let state;
  if (opening) {
    state = startEpisode({
      campaign: process.env.HARBINGER_LONG_PROFILE === '1',
      dramatica: process.env.HARBINGER_CAMPAIGN_FLOW === '1',
    });
  } else {
    const result = await resolveTurn({ ...previous, memoryIncarnation }, playerText, actors, {
      pauseAtDirectorInterruption: true,
      continueOnUnclear: true,
    });
    state = result.state;
  }

  const save = {
    id: ctx.sessionId, name: previous?.name ?? title, revision: (previous?.revision ?? -1) + 1,
    memoryIncarnation, state,
  };
  const composed = await composeResolvedPassage(
    { save, previous, playerText, stalledResolution: stalls.length > 0 },
    {
      publishedPassages: () => readPublishedPassages(ctx.pluginData),
      getPacingDirector: () => pacingDirector(gateway, signal, noteStall, { ...policy, gamePrompt: gamePacingPrompt }),
      recordThoughts: () => recordThoughts(previous?.state, state, actors, save.revision),
      campaign: gateway ? {
        completeNarration: roleCompletion(gateway, 'story', provider, { harbinger_campaign_narration: 3_400 }, policy),
        completeReaction: roleCompletion(gateway, 'character', provider, { harbinger_campaign_reaction: 1_400 }, policy),
        signal, noteStall, memory,
      } : undefined,
    },
  );
  const { view, paragraphs, benchmarkPacing } = composed;
  if (reportStalls) {
    state.benchmarkStalls = stalls.sort();
    state.benchmarkWaits = waits;
    state.benchmarkPacing = benchmarkPacing;
  }
  ctx.signal.throwIfAborted();

  await publishStoryTurn(ctx.pluginData, { save, previous: stored, composed, playerText: opening ? null : playerText });
  const sequence = save.revision;
  const { cues, pendingProposals } = publicMediaCues(ctx, state, view.scene, paragraphs, sequence);
  const story = narration(paragraphs);
  return {
    kind: 'covel.tool-result',
    content: { ...story, value: { ...story.value, cues } },
    pendingProposals,
  };
}
