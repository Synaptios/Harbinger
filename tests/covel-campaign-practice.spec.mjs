import { expect, test } from '@playwright/test';
import { campaignCases } from '../app/campaign-cases.mjs';
import { campaignStart } from '../app/campaign.mjs';
import { campaignPractice } from '../app/campaign-practice.mjs';
import { playerView, startEpisode, title } from '../app/episode.mjs';
import { actorContext } from '../app/knowledge.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { advanceAvenue } from '../covel/story-pacing.mjs';

const dawn = campaignCases[0];

async function play(save, action) {
  const result = await resolveTurn(save, action);
  expect(result.clarification, action).toBeUndefined();
  return { ...save, state: result.state, revision: save.revision + 1 };
}

async function choose(save, stances) {
  for (const stance of stances) {
    const { options } = playerView(save).campaign;
    const label = options.find(item => item.stance === stance)?.label;
    expect(label).toBeTruthy();
    save = await play(save, label);
  }
  return save;
}

async function start() {
  let save = { state: startEpisode({ campaign: true }), id: 'practice', name: title, revision: 0 };
  for (const action of ['Take the ledger to Martin', 'Give Martin the names', campaignStart]) save = await play(save, action);
  return save;
}

function reachPayoff(state) {
  state.pacing = { turn: 18, nextReview: 26, active: { id: 'campaign-followup:1', startedTurn: 0, stage: 2 },
    completed: [], queued: null };
  advanceAvenue(state, state.passages.at(-1));
  return state.records.findLast(item => item.type === 'pacing-avenue');
}

async function returnToDawn(save, stances) {
  save = await choose(save, ['next']);
  for (let chapter = 2; chapter <= 16; chapter++) {
    save = await choose(save, ['defer', 'defer', 'defer', 'defer', 'defer', 'next']);
  }
  save = await choose(save, stances);
  expect(playerView(save).campaign).toMatchObject({ chapter: 17, step: 4 });
  return save;
}

test('a public earlier practice can now change what can be done with a fresh verified entry', async () => {
  let save = await choose(await start(), ['verify', 'verify', 'verify', 'verify']);
  save = await choose(save, ['verify']);
  expect(reachPayoff(save.state)).toMatchObject({ actorId: 'alice', discovery: 'witnessed' });
  save = await returnToDawn(save, ['verify', 'verify', 'verify', 'verify']);

  const old = structuredClone(save.state);
  const work = campaignPractice(save.state, dawn, 'verified');
  expect(work).toMatchObject({
    stance: 'verify', label: 'Check where to mark the next dawn collection', actorId: 'alice',
    text: expect.stringContaining('The next dawn mark can go in its own line as soon as a loaf is collected'),
    record: { precedentId: 'campaign-followup:1', disposition: 'verified', actorId: 'alice' },
  });
  expect(save.state).toEqual(old);

  const known = actorContext(save.state, 'alice').observations;
  expect(known.find(item => item.id === work.record.precedentSourceId)).toMatchObject({
    topic: 'pacing:campaign-followup:1', status: 'firsthand',
  });
  expect(known.find(item => item.id === work.record.decisionSourceId)).toMatchObject({
    title: 'Decision about the dawn bread tally', status: 'firsthand',
  });
  expect(save.state.observations.find(item => item.id === work.record.precedentSourceId).recipients).toEqual(['player', 'alice']);
  expect(campaignPractice(save.state, dawn, 'held')).toBeUndefined();

  expect(playerView(save).campaign.options).toContainEqual({ stance: 'verify', label: work.label });
  save = await play(save, work.label);
  expect(save.state.records.at(-1)).toMatchObject({ type: 'campaign-act', step: 4, disposition: 'verified', work: work.record });
  expect(save.state.observations.at(-1)).toMatchObject({ title: work.title, text: work.text, status: 'firsthand' });
  save.state.campaign.step = 4;
  expect(campaignPractice(save.state, dawn, 'verified')).toBeUndefined();
});

test('an unseen or unjournaled payoff cannot authorize work', async () => {
  let save = await choose(await start(), ['verify', 'verify', 'verify', 'verify']);
  expect(reachPayoff(save.state)).toMatchObject({ actorId: 'alice', discovery: 'offstage' });
  save = await returnToDawn(await choose(save, ['verify']), ['verify', 'verify', 'verify', 'verify']);
  expect(campaignPractice(save.state, dawn, 'verified')).toBeUndefined();

  const event = save.state.records.find(item => item.type === 'pacing-avenue');
  event.discovery = 'reported';
  expect(campaignPractice(save.state, dawn, 'verified')).toBeUndefined();
});

test('the actual disclosed report restores a missed payoff without turning it into firsthand knowledge', async () => {
  let save = await choose(await start(), ['verify', 'verify', 'verify', 'verify']);
  expect(reachPayoff(save.state)).toMatchObject({ actorId: 'alice', discovery: 'offstage' });
  save = await choose(save, ['verify']);
  expect(advanceAvenue(save.state, save.state.passages.at(-1))?.avenueId).toBe('campaign-followup:1');
  save = await returnToDawn(save, ['verify', 'verify', 'verify', 'verify']);

  const work = campaignPractice(save.state, dawn, 'verified');
  expect(work?.record.precedentId).toBe('campaign-followup:1');
  expect(save.state.observations.find(item => item.id === work.record.precedentSourceId)).toMatchObject({
    status: 'reported', source: 'Alice', recipients: ['player', 'alice'],
  });
});

test('a witness can continue their own attributed practice while the current report stays a report', async () => {
  const reported = ['help', 'help', 'press', 'help'];
  let save = await choose(await start(), reported);
  expect(reachPayoff(save.state)).toMatchObject({ actorId: 'market-baker', discovery: 'witnessed', followup: { outcome: 'reported' } });
  save = await returnToDawn(await choose(save, ['help']), reported);
  const work = campaignPractice(save.state, dawn, 'reported');
  expect(work).toMatchObject({
    stance: 'help', label: 'Ask to keep the named account ready for someone who can witness it', actorId: 'market-baker',
    text: expect.stringMatching(/^Market baker sets the account with its source attached/u),
    record: { disposition: 'reported' },
  });
  expect(save.state.campaign.evidence).toBe('reported');
  expect(campaignPractice(save.state, dawn, 'verified')).toBeUndefined();
  const matched = save.state.observations.find(item => item.id === work.record.precedentSourceId);
  matched.recipients = ['player'];
  expect(campaignPractice(save.state, dawn, 'reported')).toBeUndefined();
});
