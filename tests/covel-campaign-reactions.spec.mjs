import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { campaignStart } from '../app/campaign.mjs';
import { playerView, startEpisode, title } from '../app/episode.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { campaignReactionBudget, campaignReactionMaxWords, planCampaignReaction, publishCampaignReaction, writeCampaignReaction } from '../covel/campaign-reactions.mjs';

async function act(save, text) {
  const result = await resolveTurn(save, text);
  expect(result.clarification).toBeUndefined();
  return { ...save, revision: save.revision + 1, state: result.state };
}

async function choose(save, stance) {
  const option = playerView(save).campaign.options.find(item => item.stance === stance);
  expect(option).toBeTruthy();
  return act(save, option.label);
}

async function openCase() {
  let save = { id: 'reaction-fixture', name: title, revision: 0, state: startEpisode({ campaign: true }) };
  save = await act(save, 'Take the ledger to Martin');
  save = await act(save, 'Give Martin the names');
  return act(save, campaignStart);
}

async function prepareComparison() {
  let save = await openCase();
  save = await choose(save, 'verify');
  return choose(save, 'verify');
}

const planned = (before, after) => planCampaignReaction(after.state, {
  firstRecord: before.state.records.length, passages: after.state.passages.slice(before.state.passages.length),
});
const speech = 'The marks are there if anyone wants to count them. I can keep a place for the early share without promising bread I have not baked yet.';

test('comparison gives the onstage actor only their disclosed case knowledge and current proof', async () => {
  const before = await prepareComparison();
  const after = await choose(before, 'verify');
  const minute = after.state.minute;
  const passageId = after.state.passages.at(-1).id;
  for (const [text, recipients, topic] of [
    ['Alice’s unrelated private intention', ['alice'], 'campaign:dawn-share'],
    ['A fact spoken only to the clerk', ['player'], 'campaign:dawn-share'],
    ['A released observation from a different case', ['player', 'alice'], 'campaign:wet-fuel'],
  ]) {
    after.state.observations.push({ id: 'new-' + text, title: text, text, recipients, topic, minute,
      passageId, status: 'firsthand', kind: 'clue', source: 'Test evidence' });
  }
  const plan = planned(before, after);
  expect(plan).toMatchObject({
    actorId: 'alice', passageId,
    context: {
      campaignReaction: true,
      action: { phase: 'comparison', disposition: null, stance: 'verify' },
      resultEvidence: { source: 'the dawn bread tally', status: 'firsthand' },
    },
  });
  const context = JSON.stringify(plan.context);
  expect(context).not.toContain('unrelated private intention');
  expect(context).not.toContain('spoken only to the clerk');
  expect(context).not.toContain('from a different case');

  after.state.passages.at(-1).actorIds = ['martin'];
  expect(planned(before, after)).toBeUndefined();
});

test('a decision speaker and its later witness are chosen from the actual passage, not from the next menu', async () => {
  const before = await choose(await prepareComparison(), 'verify');
  const decision = await choose(before, 'verify');
  expect(playerView(decision).campaign.actorName).toBe('Market baker');
  expect(planned(before, decision)).toMatchObject({
    actorId: 'alice',
    context: { action: { phase: 'decision', disposition: 'verified' },
      resultEvidence: { status: 'firsthand', source: 'Alice at London · Bakehouse lane' } },
  });
  const followThrough = await choose(decision, 'press');
  expect(playerView(followThrough).campaign.actorName).toBe('Alice');
  expect(planned(decision, followThrough)).toMatchObject({
    actorId: 'market-baker',
    context: { action: { phase: 'follow-through', disposition: 'verified' },
      resultEvidence: { status: 'reported', source: 'Alice' } },
  });
  expect(campaignReactionBudget(planned(before, decision))).toBe(47);
  expect(campaignReactionBudget(planned(decision, followThrough))).toBe(48);
});

test('a spoken reaction renders once without creating a fact, an observation, or clerk dialogue', async () => {
  const before = await prepareComparison();
  const after = await choose(before, 'verify');
  const beforeState = structuredClone(after.state);
  const reaction = await writeCampaignReaction(planned(before, after), {
    complete: async request => {
      expect(request).toMatchObject({
        name: 'harbinger_campaign_reaction', schema: { required: ['speech'] },
      });
      expect(request.instructions).toContain('24–' + campaignReactionMaxWords + ' words');
      return { speech };
    },
  });
  expect(publishCampaignReaction(after.state, reaction)).toBe('Alice says, “' + speech + '”');
  expect(publishCampaignReaction(after.state, reaction)).toBeUndefined();
  expect(after.state.facts).toEqual(beforeState.facts);
  expect(after.state.observations).toEqual(beforeState.observations);
  expect(after.state.passages).toEqual(beforeState.passages);
  expect(after.state.records.at(-1)).toMatchObject({ type: 'actor-exchange', reaction: true, actorId: 'alice', reply: speech });
  expect(after.state.records.at(-1)).not.toHaveProperty('words');
});

test('Hindsight ranks only earlier observations available to both speaker and player', async () => {
  const before = await prepareComparison();
  const after = await choose(before, 'verify');
  const plan = planned(before, after);
  const recalled = [];
  await writeCampaignReaction(plan, {
    memoryScope: { sessionId: 'reaction-fixture', committedState: before.state },
    memory: { recall: ({ actorId, evidence }) => {
      expect(actorId).toBe('alice');
      recalled.push(...evidence);
      return [{ id: 'observation:another-person-private' }, ...evidence];
    } },
    complete: async ({ context }) => {
      expect(context.resultEvidence).toEqual(plan.context.resultEvidence);
      expect(JSON.stringify(context)).not.toContain('another-person-private');
      return { speech };
    },
  });
  expect(recalled.length).toBeGreaterThan(0);
  for (const item of recalled) expect(before.state.observations.find(record => 'observation:' + record.id === item.id)?.recipients)
    .toEqual(expect.arrayContaining(['alice', 'player']));
});

test('missing or stalled reactions finish without authored replacement and keep ordinary speech alone', async () => {
  const before = await prepareComparison();
  const after = await choose(before, 'verify');
  const plan = planned(before, after);
  expect(await writeCampaignReaction(plan, { complete: async () => ({ speech: 'Too short.' }) })).toBeUndefined();
  const stalls = [];
  let returned = false;
  const pending = writeCampaignReaction(plan, {
    complete: async () => {
      await delay(15);
      returned = true;
      throw Object.assign(new Error('provider timeout'), { code: 'TIMEOUT' });
    },
    noteStall: operation => stalls.push(operation),
  });
  expect(returned).toBe(false);
  expect(await pending).toBeUndefined();
  expect(returned).toBe(true);
  expect(stalls).toEqual(['campaign-reaction']);

  after.state.records.push({ type: 'actor-exchange', actorId: 'alice', words: 'What else?', reply: speech });
  expect(planned(before, after)).toBeUndefined();
});
