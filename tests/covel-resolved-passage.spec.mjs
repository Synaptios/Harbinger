import { expect, test } from '@playwright/test';
import { playerView, playFixedTurn, startEpisode } from '../app/episode.mjs';
import { campaignWordCount } from '../covel/campaign-narration.mjs';
import { composeResolvedPassage } from '../covel/resolved-passage.mjs';
import { storyAvenues } from '../covel/worlds/bread-ledger/story-avenues.mjs';

function verify(save) {
  const playerText = playerView(save).campaign.options.find(option => option.stance === 'verify').label;
  const { state } = playFixedTurn(save.state, playerText);
  return { playerText, save: { ...save, state, revision: save.revision + 1 } };
}

test('Dramatica preserves the order of the authored decision, credited dialogue, narration, and closing avenue', async () => {
  const previous = verify({
    id: 'fixture', name: 'Fixture', revision: 0, memoryIncarnation: 'original',
    state: startEpisode({ dramatica: true }), recentDetails: [], detailUses: {},
  }).save;
  previous.state.pacing = {
    turn: 1, nextReview: 2, active: { id: 'bread-supply', startedTurn: 0, stage: 0 }, queued: null, completed: [],
  };
  const { playerText, save } = verify(previous);
  const canonical = save.state.passages.at(-1);
  const printed = [...canonical.paragraphs];
  const closing = storyAvenues.find(avenue => avenue.id === 'bread-supply').stages[0].paragraph;
  const speech = 'Count the early loaves in their own line. Each mark answers for the bread that has already left the oven.';
  const spoken = `Alice says, “${speech}”`;
  let drafted;
  const result = await composeResolvedPassage({ save, previous, playerText, stalledResolution: false }, {
    publishedPassages: () => { throw new Error('Previous scene details already exist'); },
    getPacingDirector: () => async () => 'guild-accountability',
    recordThoughts: async () => {},
    campaign: {
      signal: new AbortController().signal,
      async completeNarration({ context, schema }) {
        expect(context.printed).toEqual(printed);
        expect(JSON.stringify(context)).not.toContain(closing);
        expect(context.earlierEvidence).toContainEqual(expect.objectContaining({ status: 'firsthand' }));
        expect(context.resolvedIntent).toMatchObject({ kind: 'campaign-act', phase: 3, decision: 'verified' });
        const fields = Object.keys(schema.properties);
        const length = Math.ceil(context.targetWords / fields.length);
        drafted = fields.map(field => Array.from({ length }, (_, index) => `${field}${index}`).join(' '));
        return Object.fromEntries(fields.map((field, index) => [field, drafted[index]]));
      },
      async completeReaction({ response, context }) {
        expect(response).toBe('speech');
        expect(context.resultEvidence).toMatchObject({ status: 'firsthand', source: 'Alice at London · Bakehouse lane' });
        return { speech };
      },
    },
  });

  expect(result.paragraphs).toEqual([...printed, spoken, ...drafted, closing]);
  expect(canonical.paragraphs).toEqual([...printed, spoken, closing]);
  expect(save.state.records.at(-1)).toMatchObject({ type: 'actor-exchange', actorId: 'alice', reply: speech, reaction: true });
  expect(result.view.observations).toContainEqual(expect.objectContaining({ topic: 'pacing:bread-supply', passageId: canonical.id }));
  expect(result.passageIds).toEqual(new Set([canonical.id]));
  expect(result.benchmarkPacing).toEqual({ review: true, selectedAvenue: 'guild-accountability', visibleAvenue: 'bread-supply' });
  expect(campaignWordCount(result.paragraphs)).toBeGreaterThanOrEqual(200);
  expect(campaignWordCount(result.paragraphs)).toBeLessThanOrEqual(300);
});
