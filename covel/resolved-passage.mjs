import { playerView } from '../app/episode.mjs';
import { actorName } from '../app/thoughts.mjs';
import { campaignWordCount, narrateCampaign } from './campaign-narration.mjs';
import { campaignReactionBudget, planCampaignReaction, publishCampaignReaction, writeCampaignReaction } from './campaign-reactions.mjs';
import { assembleScene, rememberSceneDetails } from './scene-prose.mjs';
import { advanceAvenue, advancePacing, avenueTopics, chooseAvenue, isStoryBeat, pacingBriefing } from './story-pacing.mjs';

export async function composeResolvedPassage({ save, previous, playerText, stalledResolution }, {
  publishedPassages, getPacingDirector, recordThoughts, campaign,
}) {
  const { state } = save;
  const priorLength = previous?.state.passages.length ?? 0;
  const playerBeat = previous && state.passages.slice(priorLength).findLast(isStoryBeat);
  const { pacing, review } = advancePacing(state.pacing, Boolean(playerBeat), undefined, state);
  state.pacing = pacing;
  let { passages, ...view } = playerView(save);
  const playable = Boolean(playerBeat && !view.ended);
  const pacingBeat = playable && !stalledResolution ? advanceAvenue(state, playerBeat) : undefined;
  if (pacingBeat) ({ passages, ...view } = playerView(save));
  const newPassages = passages.slice(priorLength);
  const finalPassage = newPassages.at(-1);
  const { recentDetails: lastDetails, detailUses: previousUses } = previous?.detailUses
    ? previous : rememberSceneDetails(previous ? await publishedPassages() : []);
  const history = passages.slice(0, priorLength);
  const direct = review && playable && getPacingDirector();
  const campaignTurn = previous && state.campaign && campaign;
  const canonicalPassages = state.passages.slice(priorLength);
  const reactionPlan = campaignTurn ? planCampaignReaction(state, {
    firstRecord: previous.state.records.length, passages: canonicalPassages,
  }) : undefined;

  async function writeCampaign() {
    if (!campaignTurn) return;
    const day = Math.floor(state.minute / 1440);
    const thisCase = state.scene === 'campaign';
    const callbackPassages = new Set(view.observations.filter(observation => observation.topic?.startsWith('pacing:'))
      .map(observation => observation.passageId));
    const recent = thisCase ? state.passages.slice(0, priorLength).filter(passage =>
      passage.sceneId === 'campaign' && Math.floor(passage.minute / 1440) === day
      && !callbackPassages.has(passage.id) && !passage.heading.startsWith('A word with ')).slice(-2) : [];
    const speakers = [...new Set(canonicalPassages.flatMap(passage => passage.actorIds ?? []))]
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
      complete: campaign.completeNarration, signal: campaign.signal, noteStall: campaign.noteStall, playerText,
      scene: {
        heading: finalPassage.heading, location: finalPassage.location, time: finalPassage.time, speakers,
        ...(state.campaign.dramatica && { immediateQuestion: view.campaign?.question }),
      },
      passages: newPassages, recent, resolvedIntent, closingBeat: pacingBeat?.text,
      reactionBudget: campaignReactionBudget(reactionPlan), dramatica: state.campaign.dramatica,
      newObservations: currentEvidence,
      earlierEvidence: currentTopic ? publicEvidence.filter(observation => oldEvidence.has(observation.id)
        && observation.topic === currentTopic && Math.floor(observation.minute / 1440) === day).slice(-4) : [],
    });
  }

  const [selectedAvenue, campaignParagraphs, reaction] = await Promise.all([
    direct ? direct(pacingBriefing(state, view)) : undefined,
    writeCampaign(),
    writeCampaignReaction(reactionPlan, {
      complete: campaign?.completeReaction, signal: campaign?.signal, noteStall: campaign?.noteStall,
      memory: campaign?.memory,
      memoryScope: previous && { sessionId: save.id, incarnation: save.memoryIncarnation, committedState: previous.state },
    }),
    recordThoughts(),
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
  const benchmarkPacing = (review || pacingBeat) ? {
    review, selectedAvenue: selectedAvenue ?? null, visibleAvenue: pacingBeat?.avenueId ?? null,
  } : null;
  return { view, paragraphs, finalPassage, passageIds: new Set(newPassages.map(passage => passage.id)), benchmarkPacing };
}
