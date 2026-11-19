import { expect, test } from '@playwright/test';
import { campaignStart } from '../app/campaign.mjs';
import { campaignFollowups, campaignPrecedent, getCampaignFollowup } from '../app/campaign-followups.mjs';
import { playerView, startEpisode, title } from '../app/episode.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { advanceAvenue, advancePacing, chooseAvenue, pacingBriefing } from '../covel/story-pacing.mjs';

async function play(save, action) {
  const { state, clarification } = await resolveTurn(save, action);
  expect(clarification, action).toBeUndefined();
  return { ...save, state, revision: save.revision + 1 };
}

async function opening() {
  let save = { state: startEpisode({ campaign: true }), id: 'followup', name: title, revision: 0 };
  save = await play(save, 'Take the ledger to Martin');
  save = await play(save, 'Give Martin the names');
  return play(save, campaignStart);
}

async function choose(save, stances) {
  for (const stance of stances) {
    const action = playerView(save).campaign.options.find(option => option.stance === stance)?.label;
    expect(action).toBeTruthy();
    save = await play(save, action);
  }
  return save;
}

test('a follow-up requires a real case decision and gives its sponsor a concrete long-range payoff', async () => {
  const begun = await opening();
  const prepared = await choose(begun, ['verify', 'verify', 'verify']);
  expect(campaignFollowups(prepared.state)).toEqual([]);
  const decided = await choose(prepared, ['verify']);
  const [avenue] = campaignFollowups(decided.state);
  expect(avenue).toMatchObject({
    id: 'campaign-followup:1', actorId: 'alice', payoff: {
      caseId: 'dawn-share', chapter: 1, outcome: 'verified',
      practice: expect.stringMatching(/separate lines for dawn and later collections/u),
    },
  });
  expect(avenue.stages.map(stage => stage.afterTurns)).toEqual([2, 8, 18]);
  expect(avenue.stages.every(stage => stage.paragraph !== stage.report)).toBe(true);
  expect(avenue.stages.at(-1).observation.text).toContain(avenue.payoff.practice);
  expect(getCampaignFollowup(JSON.parse(JSON.stringify(decided.state)), avenue.id)).toEqual(avenue);
  expect(getCampaignFollowup(decided.state, 'campaign-followup:2')).toBeUndefined();
});

test('a witness carries an attributed follow-up only after receiving the actual decision', async () => {
  const save = await choose(await opening(), ['help', 'help', 'press', 'help']);
  const [avenue] = campaignFollowups(save.state);
  expect(avenue).toMatchObject({
    id: 'campaign-followup:1', actorId: 'market-baker', payoff: { caseId: 'dawn-share', outcome: 'reported' },
  });
  const withoutReport = structuredClone(save.state);
  withoutReport.observations = withoutReport.observations.filter(item => item.title !== 'Account of the decision');
  expect(getCampaignFollowup(withoutReport, avenue.id)?.actorId).toBe('alice');
  withoutReport.observations = withoutReport.observations.filter(item => !item.title.startsWith('Decision about'));
  expect(getCampaignFollowup(withoutReport, avenue.id)).toBeUndefined();
});

test('the available followup set is bounded while an older active pursuit stays recoverable', async () => {
  let save = await opening();
  for (let chapter = 1; chapter <= 22; chapter++) save = await choose(save, ['help', 'help', 'help', 'help', 'help', 'next']);
  save.state.pacing = { active: { id: 'campaign-followup:1' }, queued: 'campaign-followup:2', completed: ['campaign-followup:22'] };
  const candidates = campaignFollowups(save.state, 4);
  expect(candidates).toHaveLength(6);
  expect(candidates.map(avenue => avenue.id).slice(0, 2)).toEqual(['campaign-followup:1', 'campaign-followup:2']);
  expect(new Set(candidates.map(avenue => avenue.id)).size).toBe(candidates.length);
  expect(candidates.some(avenue => avenue.id === 'campaign-followup:22')).toBe(false);
});

test('a paid-off precedent becomes available after the relevant actor discloses it', async () => {
  const save = await choose(await opening(), ['verify', 'verify', 'verify', 'verify']);
  const [avenue] = campaignFollowups(save.state);
  const event = { type: 'pacing-avenue', avenueId: avenue.id, actorId: 'alice', stage: 2, discovery: 'offstage', followup: avenue.payoff };
  save.state.records.push(event);
  expect(campaignPrecedent(save.state, avenue.payoff.caseId, 'alice')).toBeUndefined();
  event.discovery = 'reported';
  expect(campaignPrecedent(save.state, avenue.payoff.caseId, 'alice')).toBe(avenue.payoff.practice);
  expect(campaignPrecedent(save.state, avenue.payoff.caseId, 'martin')).toBeUndefined();
});

test('a recurring follow-up survives restoration, pays off, and affects its next encounter', async () => {
  let save = await choose(await opening(), ['verify', 'verify', 'verify', 'verify']);
  const id = 'campaign-followup:1';
  save.state.pacing = { turn: 0, nextReview: 14, active: null, queued: null, completed: [] };
  expect(pacingBriefing(save.state, playerView(save)).availableAvenues.some(avenue => avenue.id === id)).toBe(true);
  chooseAvenue(save.state.pacing, id, save.state);
  expect(save.state.pacing.active?.id).toBe(id);

  for (let turn = 1; turn <= 2; turn++) {
    save = await play(save, 'Look around');
    save.state.pacing = advancePacing(save.state.pacing, true, () => 20, save.state).pacing;
    advanceAvenue(save.state, save.state.passages.at(-1));
  }
  const first = save.state.records.find(item => item.type === 'pacing-avenue' && item.avenueId === id);
  expect(first).toMatchObject({ stage: 0, actorId: 'alice', discovery: 'offstage' });
  expect(playerView(save).observations.some(item => item.topic === 'pacing:' + id)).toBe(false);

  save.state = JSON.parse(JSON.stringify(save.state));
  save = await choose(save, ['verify']);
  for (let turn = 3; turn <= 18; turn++) {
    save = await play(save, 'Look around');
    save.state.pacing = advancePacing(save.state.pacing, true, () => 20, save.state).pacing;
    advanceAvenue(save.state, save.state.passages.at(-1));
  }
  const phases = save.state.records.filter(item => item.type === 'pacing-avenue' && item.avenueId === id);
  expect(phases).toHaveLength(3);
  expect(phases.map(({ stage, discovery }) => [stage, discovery])).toEqual([[0, 'reported'], [1, 'witnessed'], [2, 'witnessed']]);
  expect(save.state.pacing.completed).toContain(id);
  expect(phases[2].followup).toMatchObject({ caseId: 'dawn-share', outcome: 'verified' });

  save = await choose(save, ['next']);
  for (let chapter = 2; chapter <= 16; chapter++) save = await choose(save, ['verify', 'verify', 'verify', 'verify', 'verify', 'next']);
  expect(playerView(save).campaign.chapter).toBe(17);
  expect(playerView(save).observations).toContainEqual(expect.objectContaining({
    title: 'The earlier practice brought forward',
    source: 'Alice',
    text: expect.stringContaining(phases[2].followup.practice),
  }));
});
