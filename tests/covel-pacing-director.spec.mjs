import { setTimeout } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { pacingDirector } from '../covel/pacing-director.mjs';
import { assembleScene } from '../covel/scene-prose.mjs';
import { advancePacing } from '../covel/story-pacing.mjs';

const gamePrompt = 'PREFER THE HUMAN COST OF THE BAKEHOUSE WORK.';
const briefing = {
  earlierStory: [{ heading: 'Opening bargain', story: 'Alice stood surety for the clerk long ago.' }],
  recentStory: [{ heading: 'Dusk notice', story: 'The clerk watched the lane.' }],
  availableAvenues: [{ id: 'bread-supply' }, { id: 'guild-accountability' }, { id: 'flour-route' }],
};
const proposals = [
  { id: 'guild-accountability', trajectory: 'Question the authority behind a public report as more people hear of it.' },
  { id: 'bread-supply', trajectory: 'Alice can treat the bread bill as a way to decide whose work she stands behind.' },
];
const gateway = generateObject => ({ resolveSlot: () => ({ presetId: 'slot-pacing-director' }), generateObject });

test('the scout reads the story and the game prompt alone decides which proposal leads', async () => {
  const requests = [];
  const director = pacingDirector(gateway(async request => {
    requests.push(request);
    return { object: requests.length === 1 ? { avenues: proposals } : { avenueId: 'bread-supply' } };
  }), new AbortController().signal, undefined, { gamePrompt });

  await expect(director(briefing)).resolves.toBe('bread-supply');
  expect(requests).toHaveLength(2);
  expect(requests.map(request => request.presetId)).toEqual(['slot-pacing-director', 'slot-pacing-director']);
  expect(requests[0].system).toMatch(/offstage|unfinished actions/iu);
  expect(requests[0].system).not.toContain(gamePrompt);
  expect(requests[1].system).toContain(gamePrompt);
  expect(JSON.parse(requests[0].prompt)).toEqual(briefing);
  expect(JSON.parse(requests[1].prompt)).toMatchObject({
    earlierStory: briefing.earlierStory, proposals,
    availableAvenues: [{ id: 'bread-supply' }, { id: 'guild-accountability' }],
  });
  expect(requests[1].schema.properties.avenueId.enum).toEqual(['guild-accountability', 'bread-supply', null]);
});

test('missing or unusable advice leaves the existing direction available', async () => {
  for (const response of [null, 'made-up', 'flour-route']) {
    const director = pacingDirector(gateway(async ({ schema }) => ({
      object: 'avenues' in schema.properties ? { avenues: proposals } : { avenueId: response },
    })), new AbortController().signal, undefined, { gamePrompt });
    await expect(director(briefing)).resolves.toBeUndefined();
  }
  const calls = [];
  const offline = pacingDirector(gateway(async request => {
    calls.push(request);
    throw new Error('Provider unavailable');
  }), new AbortController().signal, undefined, { gamePrompt });
  await expect(offline(briefing)).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
  await expect(offline({ ...briefing, availableAvenues: [] })).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
});

test('the scout asks for the exact no-op object and bounds long private proposals at the selector', async () => {
  const requests = [];
  const passes = [
    { avenues: [] },
    { avenues: [{ id: 'flour-route', trajectory: 'The carter can follow the receipt. '.repeat(16) }] },
    { avenueId: 'flour-route' },
  ];
  const director = pacingDirector(gateway(async request => {
    requests.push(request);
    return { object: passes.shift() };
  }), new AbortController().signal, undefined, { gamePrompt });

  await expect(director(briefing)).resolves.toBeUndefined();
  expect(requests).toHaveLength(1);
  expect(requests[0].system).toContain('{"avenues":[]}');
  expect(requests[0].schema.properties.avenues.items.properties.trajectory).toEqual({ type: 'string' });

  await expect(director(briefing)).resolves.toBe('flour-route');
  const [proposal] = JSON.parse(requests[2].prompt).proposals;
  expect(proposal.trajectory).toHaveLength(440);
});

test('the director requires its dedicated role and game prompt', () => {
  const signal = new AbortController().signal;
  expect(pacingDirector(gateway(() => {}), signal)).toBeUndefined();
  expect(pacingDirector({ resolveSlot: () => ({ presetId: 'slot-story' }) }, signal, undefined, { gamePrompt }))
    .toBeUndefined();
});

test('waiting for a slow scout still allows its proposal to be selected', async () => {
  const waits = [];
  const director = pacingDirector(gateway(async ({ signal, schema }) => {
    if ('avenues' in schema.properties) {
      await setTimeout(1_100, undefined, { signal });
      return { object: { avenues: proposals } };
    }
    return { object: { avenueId: 'guild-accountability' } };
  }), new AbortController().signal, undefined, { gamePrompt, waitForProviders: true, noteWait: wait => waits.push(wait) });

  await expect(director(briefing)).resolves.toBe('guild-accountability');
  expect(waits).toEqual([expect.objectContaining({ operation: 'harbinger_pacing_scout', outcome: 'completed' })]);
});

test('the saved clock accepts the ten and twenty turn interval boundaries', () => {
  const draws = [10, 20, 10];
  const draw = () => draws.shift();
  let { pacing } = advancePacing(null, false, draw);
  const reviewTurns = [];
  expect(pacing).toMatchObject({ turn: 0, nextReview: 10 });
  for (let turn = 1; turn <= 35; turn++) {
    const result = advancePacing(pacing, true, draw);
    if (result.review) reviewTurns.push(result.pacing.turn);
    pacing = JSON.parse(JSON.stringify(result.pacing));
  }
  expect(reviewTurns).toEqual([10, 30]);
  expect(pacing).toMatchObject({ turn: 35, nextReview: 40 });
  expect(draws).toEqual([]);
});

test('an NPC development can close the narration after the player’s resolved beat', () => {
  const reply = 'Alice’s hand comes down on the ledger. “Ask me first,” she says. She leaves her hand there.';
  const initiative = 'Alice turns back to the day’s baking and makes a place for bread to keep back.';
  const passages = [{
    id: 'passage-1', heading: 'Alice intervenes', location: 'London · Bakehouse lane', time: 'Dawn',
    playerText: 'Reach for the ledger', paragraphs: [reply, initiative],
  }];
  const { paragraphs } = assembleScene(passages, [], [], {}, { topics: ['bread', 'baking'], beat: initiative });
  const words = paragraphs.join(' ').trim().split(/\s+/u).length;
  expect(paragraphs[0]).toBe(reply);
  expect(paragraphs.at(-1)).toBe(initiative);
  expect(paragraphs.filter(paragraph => paragraph === reply)).toEqual([reply]);
  expect(words).toBeGreaterThanOrEqual(200);
  expect(words).toBeLessThanOrEqual(300);
});

test('a routine tally keeps one explanation', () => {
  const passages = [{
    id: 'tally', heading: 'The guild tally', location: 'London · Guild Storehouse', time: 'Late afternoon',
    playerText: 'Ask the porter about the guild tally',
    paragraphs: ['Thomas sets the chalk aside. “Each sack goes down by its own mark.”'],
  }];
  const rendered = assembleScene(passages).paragraphs;
  const explanations = rendered.filter(paragraph => /^(?:The tally has to survive|The chalk gives him|There is as much room)/u.test(paragraph));
  expect(explanations).toHaveLength(1);
  expect(rendered.join(' ').split(/\s+/u).length).toBeGreaterThanOrEqual(200);
});
