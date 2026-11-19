import { randomInt } from 'node:crypto';
import { actorName, sceneActorIds } from '../app/thoughts.mjs';
import { campaignLocation } from '../app/campaign.mjs';
import { campaignFollowups, getCampaignFollowup } from '../app/campaign-followups.mjs';
import { storyAvenues } from './worlds/bread-ledger/story-avenues.mjs';

const avenues = new Map(storyAvenues.map(avenue => [avenue.id, avenue]));
const chooseInterval = () => randomInt(10, 21);
const campaignVenues = {
  'London · Bakehouse lane': 'bakehouse',
  'London · Guild room': 'guildInspection',
  'London · Thames landing': 'landing',
  'London · Carters’ market': 'marketTally',
};

function pacingVenue(state) {
  return campaignVenues[campaignLocation(state)] ?? state.scene;
}

function getAvenue(state, id) {
  return avenues.get(id) ?? getCampaignFollowup(state, id);
}

export function isStoryBeat(passage) {
  return !['A moment to decide', 'The story closes'].includes(passage.heading);
}

export function advancePacing(previous, advances = false, draw = chooseInterval, state) {
  const turn = Number.isSafeInteger(previous?.turn) && previous.turn >= 0 ? previous.turn : 0;
  const nextReview = Number.isSafeInteger(previous?.nextReview) && previous.nextReview > turn
    && previous.nextReview <= turn + 20 ? previous.nextReview : turn + draw();
  const playerTurn = turn + Number(advances);
  const review = advances && playerTurn === nextReview;
  const completed = Array.isArray(previous?.completed) ? [...new Set(previous.completed.filter(id => getAvenue(state, id)))] : [];
  const prior = previous?.active;
  const avenue = getAvenue(state, prior?.id);
  const active = avenue && !completed.includes(prior.id)
    && Number.isSafeInteger(prior.startedTurn) && prior.startedTurn >= 0 && prior.startedTurn <= turn
    && Number.isSafeInteger(prior.stage) && prior.stage >= 0 && prior.stage < avenue.stages.length
    ? { id: prior.id, startedTurn: prior.startedTurn, stage: prior.stage } : null;
  const queued = active && previous.queued !== active.id && getAvenue(state, previous.queued)
    && !completed.includes(previous.queued) ? previous.queued : null;
  return { review, pacing: {
    turn: playerTurn, nextReview: review ? playerTurn + draw() : nextReview, active, queued, completed,
  } };
}

function startAvenue(pacing, id) {
  pacing.active = id ? { id, startedTurn: pacing.turn, stage: 0 } : null;
  pacing.queued = null;
}

export function chooseAvenue(pacing, id, state) {
  if (!getAvenue(state, id) || pacing.completed.includes(id)) return;
  if (pacing.active) pacing.queued = pacing.active.id === id ? null : id;
  else startAvenue(pacing, id);
}

function journalBeat(state, passage, avenue, stage, status, recipients) {
  const name = actorName(state, avenue.actorId);
  state.observations.push({
    id: 'observation-' + state.observations.length, passageId: passage.id, kind: 'clue',
    topic: 'pacing:' + avenue.id, ...stage.observation, status, recipients, minute: state.minute,
    source: status === 'firsthand' && recipients.includes('player') ? name + ' at ' + passage.location : name,
  });
}

export function advanceAvenue(state, passage) {
  const { pacing } = state;
  const present = new Set(sceneActorIds(state));
  const venue = pacingVenue(state);
  const missed = state.records.find(event => {
    if (event.type !== 'pacing-avenue' || event.discovery !== 'offstage' || !present.has(event.actorId)) return false;
    const avenue = getAvenue(state, event.avenueId);
    return avenue?.actorId === event.actorId && avenue.stages[event.stage]?.sceneIds.includes(venue);
  });
  if (missed) {
    const avenue = getAvenue(state, missed.avenueId);
    const stage = avenue.stages[missed.stage];
    passage.paragraphs = [...passage.paragraphs, stage.report];
    missed.discovery = 'reported';
    journalBeat(state, passage, avenue, stage, 'reported', ['player', avenue.actorId]);
    return { avenueId: avenue.id, text: stage.report };
  }

  const active = pacing.active;
  if (!active) return;
  const avenue = getAvenue(state, active.id);
  const stage = avenue?.stages[active.stage];
  if (!stage || pacing.turn < active.startedTurn + stage.afterTurns) return;
  const witnessed = present.has(avenue.actorId);
  if (witnessed && !stage.sceneIds.includes(venue)) return;

  state.records.push({
    type: 'pacing-avenue', avenueId: avenue.id, actorId: avenue.actorId, stage: active.stage,
    minute: state.minute, passageId: passage.id, discovery: witnessed ? 'witnessed' : 'offstage',
    ...(avenue.payoff && active.stage === avenue.stages.length - 1 && { followup: avenue.payoff }),
  });
  if (witnessed) passage.paragraphs = [...passage.paragraphs, stage.paragraph];
  journalBeat(state, passage, avenue, stage, 'firsthand', witnessed ? ['player', avenue.actorId] : [avenue.actorId]);
  active.stage += 1;
  if (active.stage === avenue.stages.length) {
    pacing.completed.push(avenue.id);
    startAvenue(pacing, pacing.queued);
  }
  if (witnessed) return { avenueId: avenue.id, text: stage.paragraph };
}

export function avenueTopics(state) {
  const active = state.pacing.active;
  const avenue = getAvenue(state, active?.id);
  if (avenue?.stages[active.stage].sceneIds.includes(pacingVenue(state)) && sceneActorIds(state).includes(avenue.actorId)) {
    return avenue.narrationTopics;
  }
  return [];
}

function sample(items, maximum) {
  if (items.length <= maximum) return items;
  return Array.from({ length: maximum }, (_, index) => items[Math.round(index * (items.length - 1) / (maximum - 1))]);
}

export function pacingBriefing(state, view) {
  const { pacing, passages } = state;
  const continuous = state.campaign?.chapter > 0;
  const window = continuous ? 7 : 12;
  const recent = passages.slice(-window);
  const earlier = sample(passages.slice(0, -window).filter(passage => isStoryBeat(passage)
    && passage.heading !== 'A moment to look'), continuous ? 9 : 24);
  const campaignChronicle = continuous ? Object.entries(state.campaign.cases).map(([id, { chapter, outcome }]) => ({
    id, chapter, outcome,
  })).sort((a, b) => a.chapter - b.chapter) : undefined;
  return {
    playerTurn: pacing.turn, scene: view.scene, playerChoices: view.choices,
    ...(campaignChronicle && { campaignChronicle }),
    earlierStory: earlier.map(({ heading, minute, playerText, paragraphs }) => ({
      heading, minute, action: playerText?.slice(0, 300), story: paragraphs.join(' ').slice(0, continuous ? 350 : 550),
    })),
    recentStory: recent.map(({ heading, minute, playerText, paragraphs }) => ({
      heading, minute, action: playerText?.slice(0, 650), story: paragraphs.join(' ').slice(0, continuous ? 700 : 1200),
    })),
    publicEvidence: sample(view.observations, continuous ? 14 : 24).map(({ title, text, source, status }) => ({
      title, text: text.slice(0, continuous ? 380 : 550), source, status,
    })),
    pursued: { active: pacing.active, queued: pacing.queued, completed: pacing.completed },
    availableAvenues: [...storyAvenues, ...campaignFollowups(state)].filter(avenue => !pacing.completed.includes(avenue.id))
      .map(({ id, title, actorId, premise, stages }) => ({
        id, title, actor: actorName(state, actorId), premise,
        milestones: stages.map(({ afterTurns, description, sceneIds }) => ({ afterTurns, description, sceneIds })),
      })),
  };
}
