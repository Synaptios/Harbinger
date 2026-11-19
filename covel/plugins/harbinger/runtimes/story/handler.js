import { playerView, startEpisode, title } from '../../../../../app/episode.mjs';
import { actorName, recordThoughts } from '../../../../../app/thoughts.mjs';
import { resolveTurn } from '../../../../../app/turns.mjs';
import { createCovelActors } from '../../../../actors.mjs';
import { campaignWordCount, narrateCampaign } from '../../../../campaign-narration.mjs';
import { campaignReactionBudget, planCampaignReaction, publishCampaignReaction, writeCampaignReaction } from '../../../../campaign-reactions.mjs';
import { complexStateRole, inspectionDirector } from '../../../../directing.mjs';
import { storyModelProvider } from '../../../../model-settings.mjs';
import { createHindsight } from '../../../../hindsight.mjs';
import { requestStoryObject } from '../../../../narrator.mjs';
import { pacingDirector } from '../../../../pacing-director.mjs';
import { publicMediaCues } from '../../../../public-media.mjs';
import { readStoredStory, writeStoredStory } from '../../../../save-storage.mjs';
import { assembleScene, rememberSceneDetails } from '../../../../scene-prose.mjs';
import { advanceAvenue, advancePacing, avenueTopics, chooseAvenue, isStoryBeat, pacingBriefing } from '../../../../story-pacing.mjs';
import { gamePacingPrompt } from '../../../../worlds/bread-ledger/pacing-prompt.mjs';

const publicStory = 'story';
const memory = createHindsight();

async function publishedPassages(ctx) {
  return (await ctx.pluginData.list('passages')).map(row => row.value).sort((a, b) => a.sequence - b.sequence);
}

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
    for (const paragraph of (await publishedPassages(ctx)).flatMap(passage => passage.paragraphs)) {
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
  const priorLength = previous?.state.passages.length ?? 0;
  const playerBeat = !opening && state.passages.slice(priorLength).findLast(isStoryBeat);
  const { pacing, review } = advancePacing(state.pacing, Boolean(playerBeat), undefined, state);
  state.pacing = pacing;
  let { passages, ...view } = playerView(save);
  const stalledResolution = stalls.length > 0;
  const playable = Boolean(playerBeat && !view.ended);
  const pacingBeat = playable && !stalledResolution ? advanceAvenue(state, playerBeat) : undefined;
  if (pacingBeat) ({ passages, ...view } = playerView(save));
  const newPassages = passages.slice(priorLength);
  const finalPassage = newPassages.at(-1);
  const { recentDetails: lastDetails, detailUses: previousUses } = previous?.detailUses
    ? previous : rememberSceneDetails(previous ? await publishedPassages(ctx) : []);
  const history = passages.slice(0, priorLength);
  const direct = review && playable && pacingDirector(gateway, signal, noteStall, { ...policy, gamePrompt: gamePacingPrompt });
  const reactionPlan = !opening && state.campaign && gateway ? planCampaignReaction(state, {
    firstRecord: previous.state.records.length, passages: state.passages.slice(priorLength),
  }) : undefined;
  async function writeCampaign() {
    if (opening || !state.campaign || !gateway) return;
    const day = Math.floor(state.minute / 1440);
    const thisCase = state.scene === 'campaign';
    const callbackPassages = new Set(view.observations.filter(observation => observation.topic?.startsWith('pacing:'))
      .map(observation => observation.passageId));
    const recent = thisCase ? state.passages.slice(0, priorLength).filter(passage =>
      passage.sceneId === 'campaign' && Math.floor(passage.minute / 1440) === day
      && !callbackPassages.has(passage.id) && !passage.heading.startsWith('A word with ')).slice(-2) : [];
    const speakers = [...new Set(state.passages.slice(priorLength).flatMap(passage => passage.actorIds ?? []))]
      .map(id => actorName(state, id)).filter(Boolean);
    const oldEvidence = new Set(previous.state.observations.map(observation => observation.id));
    const move = state.records.slice(previous.state.records.length).findLast(record =>
      ['campaign-act', 'campaign-opened', 'actor-exchange', 'observe'].includes(record.type));
    const publicEvidence = state.observations.filter(observation => observation.recipients.includes('player')
      && observation.minute <= state.minute && !observation.topic?.startsWith('pacing:'));
    const currentEvidence = publicEvidence.filter(observation => !oldEvidence.has(observation.id));
    const currentTopic = thisCase && move?.caseId ? 'campaign:' + move.caseId : null;
    const resolvedIntent = move && {
      kind: move.type, stance: move.stance, phase: move.step, speaker: actorName(state, move.actorId),
      ...(move.step === 0 && { pendingQuestion: view.campaign?.question }),
      evidenceBefore: previous.state.campaign?.chapter === state.campaign.chapter ? previous.state.campaign.evidence ?? 'pending' : 'pending',
      evidenceAfter: state.campaign.evidence ?? 'pending',
      ...(move.step === 3 && { decision: move.outcome }),
      ...(move.step === 4 && { decision: move.disposition }),
      ...(move.dramaticBeat && { beat: move.dramaticBeat }),
    };
    return narrateCampaign({
      complete: roleCompletion(gateway, 'story', provider, { harbinger_campaign_narration: 3_400 }, policy),
      signal, noteStall, playerText, scene: {
        heading: finalPassage.heading, location: finalPassage.location, time: finalPassage.time, speakers,
        ...(state.campaign.dramatica && { immediateQuestion: view.campaign?.question }),
      }, passages: newPassages, recent, resolvedIntent, closingBeat: pacingBeat?.text, reactionBudget: campaignReactionBudget(reactionPlan),
      dramatica: state.campaign.dramatica,
      newObservations: currentEvidence,
      earlierEvidence: currentTopic ? publicEvidence.filter(observation => oldEvidence.has(observation.id)
        && observation.topic === currentTopic && Math.floor(observation.minute / 1440) === day).slice(-4) : [],
    });
  }
  const [selectedAvenue, campaignParagraphs, reaction] = await Promise.all([
    direct ? direct(pacingBriefing(state, view)) : undefined,
    writeCampaign(),
    writeCampaignReaction(reactionPlan, {
      complete: roleCompletion(gateway, 'character', provider, { harbinger_campaign_reaction: 1_400 }, policy), signal, noteStall,
      memory, memoryScope: previous && { sessionId: save.id, incarnation: memoryIncarnation, committedState: previous.state },
    }),
    recordThoughts(previous?.state, state, actors, save.revision),
  ]);
  chooseAvenue(pacing, selectedAvenue, state);
  if (reaction && campaignParagraphs
      && campaignWordCount([...campaignParagraphs, reaction.actorName + ' says, ' + reaction.speech]) <= 300) {
    const spoken = publishCampaignReaction(state, reaction);
    if (spoken) {
      const passage = state.passages.find(item => item.id === reaction.passageId);
      const held = passage.paragraphs.at(-1) === pacingBeat?.text;
      const insertion = newPassages.reduce((count, item) => count + item.paragraphs.length, 0) - Number(held);
      campaignParagraphs.splice(insertion, 0, spoken);
      passage.paragraphs = held ? [...passage.paragraphs.slice(0, -1), spoken, passage.paragraphs.at(-1)] : [...passage.paragraphs, spoken];
    }
  }
  const { paragraphs, recentDetails, detailUses } = campaignParagraphs
    ? { paragraphs: campaignParagraphs, recentDetails: lastDetails, detailUses: previousUses }
    : stalledResolution
    ? { paragraphs: newPassages.flatMap(passage => passage.paragraphs), recentDetails: lastDetails, detailUses: previousUses }
    : assembleScene(newPassages, history, lastDetails, previousUses, {
      topics: playable ? avenueTopics(state) : [], beat: pacingBeat?.text,
    });
  save.recentDetails = recentDetails;
  save.detailUses = detailUses;
  if (reportStalls) {
    state.benchmarkStalls = stalls.sort();
    state.benchmarkWaits = waits;
    state.benchmarkPacing = (review || pacingBeat) ? {
      review, selectedAvenue: selectedAvenue ?? null, visibleAvenue: pacingBeat?.avenueId ?? null,
    } : null;
  }
  ctx.signal.throwIfAborted();

  const sequence = save.revision;
  const rendered = { ...finalPassage, playerText: opening ? null : playerText, paragraphs, sequence };
  const currentIds = new Set(newPassages.map(passage => passage.id));
  const linkPassage = observation => currentIds.has(observation.passageId)
    ? { ...observation, passageId: rendered.id } : observation;
  state.observations = state.observations.map(linkPassage);
  await writeStoredStory(ctx.pluginData, save, stored);
  await ctx.pluginData.set(publicStory, 'view', { ...view, observations: view.observations.map(linkPassage) });
  await ctx.pluginData.set('passages', rendered.id, rendered);

  const { cues, pendingProposals } = publicMediaCues(ctx, state, view.scene, paragraphs, sequence);
  const story = narration(paragraphs);
  return {
    kind: 'covel.tool-result',
    content: { ...story, value: { ...story.value, cues } },
    pendingProposals,
  };
}
