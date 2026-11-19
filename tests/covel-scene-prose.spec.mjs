import { expect, test } from '@playwright/test';
import { playerView, startEpisode } from '../app/episode.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { createCovelActors } from '../covel/actors.mjs';
import { assembleScene, rememberSceneDetails } from '../covel/scene-prose.mjs';

async function assembledRoute(actions) {
  const model = createCovelActors({}, {
    completeCharacter: async ({ context }) => ({
      reply: context.replyOptions?.[0]?.id ?? 'I can answer for what I saw.', meetingId: null,
    }),
    completeState: async () => ({ porterName: 'Thomas', sign: 'Anchor' }),
  });
  let save = { id: 'rehearsal', state: startEpisode() };
  let history = playerView(save).passages;
  let { recentDetails, detailUses } = assembleScene(history);
  const result = [];
  for (const action of actions) {
    save = { ...save, ...await resolveTurn(save, action, model, { pauseAtDirectorInterruption: true, continueOnUnclear: true }) };
    const passages = playerView(save).passages;
    const resolved = passages.slice(history.length);
    const rendered = assembleScene(resolved, history, recentDetails, detailUses);
    const priorDetails = recentDetails.flat();
    result.push({ action, resolved, rendered, priorDetails });
    ({ recentDetails, detailUses } = rendered);
    history = passages;
  }
  return result;
}

test('quiet market, landing and storehouse turns stay full after nearby details have been used', async () => {
  const routes = [
    [
      'Ask Alice about the proclamation', 'Promise Alice discretion', 'Ask Alice what brought Guenever to London',
      'Keep Alice’s confidence', 'Go with Alice to the river', 'Ask Alice about your promise',
      'Ask Alice about the carter’s words', 'Read the carter’s sealed statement',
    ],
    [
      'Look around', 'Ask Alice about the proclamation', 'Ask Martin about the proclamation', 'Ask the carters in the market',
      'I say, “Market carter, how do you know where a cart went?”', 'Wait for the market tally',
      'I say, “Guild runner, did you see the oven closed yourself?”', 'Read the market copy of the order',
      'I say, “Market baker, when would your oven be free?”',
    ],
    [
      'I ask Alice, “Where does the flour need to go?”', 'Go with Alice to the river', 'Visit the riverside storehouse',
      'Help the porter sort the tally', 'Ask the porter about the guild tally', 'I ask Thomas, “May I see where that mark is entered?”',
      'Return to the Thames landing', 'Help Alice load the flour', 'Read the guild notice', 'Offer to help Alice start again',
    ],
  ];
  for (const route of await Promise.all(routes.map(assembledRoute))) {
    for (const { action, resolved, rendered, priorDetails } of route) {
      const words = rendered.paragraphs.join(' ').split(/\s+/u).length;
      expect(words, action).toBeGreaterThanOrEqual(200);
      expect(words, action).toBeLessThanOrEqual(300);
      const resolvedParagraphs = resolved.flatMap(passage => passage.paragraphs);
      expect(rendered.paragraphs.filter(paragraph => resolvedParagraphs.includes(paragraph)), action).toEqual(resolvedParagraphs);
      expect(rendered.recentDetails.at(-1).filter(paragraph => priorDetails.includes(paragraph)), action).toEqual([]);
    }
  }
});

test('the dusk return and the order preserve the walk back with the ledger', async () => {
  const [, returned, notice, ending] = await assembledRoute([
    'Take the ledger to Martin', 'Return to the bakehouse with the ledger', 'Read the guild notice', 'Offer to help Alice start again',
  ]);
  expect(returned.rendered.paragraphs.join(' ')).toContain('The ledger is still under your arm.');
  for (const turn of [returned, notice, ending]) {
    expect(turn.rendered.paragraphs.join(' ')).not.toMatch(/load being settled|sack went aboard|on its way to the Tower/iu);
  }
  expect(ending.rendered.paragraphs.join(' ')).toContain('The sacks still wait at the landing.');
});

test('new scene details are preferred throughout a visit and rebuilding from a save keeps that history', async () => {
  const route = await assembledRoute([
    'Try to take the ledger', 'Ask Martin what brought Guenever to London',
    'I ask Alice, “Why did you stop me when I reached for the book?”', 'Promise Alice discretion',
    'Ask Alice what brought Guenever to London', 'Tell Martin what Alice said about the Queen',
    'Ask Martin what brought Guenever to London',
  ]);
  const openingMoments = playerView({ state: startEpisode() }).passages;
  const opening = assembleScene(openingMoments);
  const heard = new Set(opening.recentDetails.flat());
  for (const { action, rendered } of route) {
    const details = rendered.recentDetails.at(-1);
    expect(details.filter(paragraph => heard.has(paragraph)), action).toEqual([]);
    details.forEach(paragraph => heard.add(paragraph));
    expect(rendered.paragraphs.join(' ').trim().split(/\s+/u).length, action).toBeGreaterThanOrEqual(200);
  }
  const before = route.slice(0, -1);
  const published = [opening, ...before.map(({ rendered }) => rendered)];
  const restored = rememberSceneDetails(published);
  expect(restored.recentDetails).toHaveLength(2);
  expect(Object.keys(restored.detailUses)).toHaveLength(published.flatMap(rendered => rendered.recentDetails.at(-1)).length);
  const last = route.at(-1);
  const replay = assembleScene(last.resolved, [
    ...openingMoments, ...before.flatMap(({ resolved }) => resolved),
  ], restored.recentDetails, restored.detailUses);
  expect(replay.paragraphs).toEqual(last.rendered.paragraphs);
});

test('the narrator leads with the exchange and varies details across nearby turns', () => {
  const setting = { heading: 'A word with Alice', location: 'London · Bakehouse lane', time: 'Dawn' };
  const reply = 'Alice says, “Ask me first, if you please.”';
  const past = playerView({ state: startEpisode() }).passages;
  const first = { ...setting, id: 'passage-1', paragraphs: [reply] };
  const next = { ...setting, id: 'passage-2', paragraphs: ['Alice says, “What would you do with it?”'] };
  const opening = assembleScene(past);
  const rendered = assembleScene([first], past, opening.recentDetails);
  const later = assembleScene([next], [...past, first], rendered.recentDetails);
  for (const [source, result] of [[first, rendered], [next, later]]) {
    expect(result.paragraphs[0]).toBe(source.paragraphs[0]);
    const words = result.paragraphs.join(' ').trim().split(/\s+/u).length;
    expect(words).toBeGreaterThanOrEqual(200);
    expect(words).toBeLessThanOrEqual(300);
  }
  expect(later.paragraphs.filter(paragraph => rendered.paragraphs.includes(paragraph))).toEqual([]);
  const question = { ...setting, heading: 'A moment to decide', paragraphs: ['Who would you like to address?'] };
  expect(assembleScene([question], past).paragraphs).toEqual(question.paragraphs);
});

test('entering the guild begins with the player’s action and closes on its decision', async () => {
  const [turn] = await assembledRoute(['Take the ledger to Martin']);
  const [arrival, decision] = turn.resolved[0].paragraphs;
  expect(turn.rendered.paragraphs[0]).toBe(arrival);
  expect(turn.rendered.paragraphs.at(-1)).toBe(decision);
  expect(turn.rendered.paragraphs.slice(1, -1).join(' ')).toMatch(/delivery column|oven account/u);
});

test('the warning precedes details about the written order it introduces', async () => {
  const [, turn] = await assembledRoute(['Ask the carters in the market', 'Wait for the market tally']);
  const [arrival, warning] = turn.resolved[0].paragraphs;
  expect(turn.rendered.paragraphs.slice(0, 2)).toEqual([arrival, warning]);
  expect(turn.rendered.paragraphs.slice(2).join(' ')).toMatch(/folded copy|copy is still folded/u);
});

test('the market ending leaves Alice’s reply last and the market order only introduces the document', async () => {
  const route = await assembledRoute([
    'Ask the carters in the market', 'Wait for the market tally',
    'Read the market copy of the order', 'Help Alice find another oven',
  ]);
  const [, , order, ending] = route;
  expect(order.rendered.paragraphs.join(' ')).not.toContain('Here are the missing ledger');
  expect(ending.rendered.paragraphs.at(-1)).toBe(ending.resolved.at(-1).paragraphs.at(-1));
  expect(ending.rendered.paragraphs.join(' ').split(/\s+/u).length).toBeGreaterThanOrEqual(200);

  const confidence = await assembledRoute([
    'Ask Alice about the proclamation', 'Promise Alice discretion', 'Ask Alice what brought Guenever to London',
  ]);
  expect(confidence.at(-1).rendered.paragraphs.join(' ')).not.toContain('throughout the shops');
});

test('a conversation answers immediately and closes on a separately resolved invitation', () => {
  const past = playerView({ state: startEpisode() }).passages;
  const reply = 'Alice says, “Ask me about the flour.”';
  const consequence = 'Alice offers to meet you at the Thames landing.';
  const passage = {
    id: 'passage-1', heading: 'A word with Alice', location: 'London · Bakehouse lane', time: 'Dawn',
    playerText: '“Can we talk about the flour later?”',
    paragraphs: ['Alice turns toward the clerk to listen.', reply, consequence],
  };
  const scene = assembleScene([passage], past);
  expect(scene.paragraphs.slice(0, 2)).toEqual(passage.paragraphs.slice(0, 2));
  expect(scene.paragraphs.at(-1)).toBe(consequence);
});

test('the speaker receives the actual ledger interruption and the market witnesses’ sources', async () => {
  const prompts = [];
  const actors = createCovelActors({}, {
    completeCharacter: async ({ context }) => {
      prompts.push(context);
      return { reply: context.replyOptions?.[0]?.id ?? 'I will tell you what I can answer for.', meetingId: null };
    },
  });
  let save = { id: 'evidence-test', state: startEpisode() };
  const submit = async text => {
    const { state } = await resolveTurn(save, text, actors, { continueOnUnclear: true });
    save = { ...save, state };
  };
  await submit('Try to take the ledger');
  await submit('I ask Alice, “Why did you put your hand on the ledger?”');
  await submit('Ask the carters in the market');
  await submit('I say, “Market carter, where is the tally?”');
  await submit('Wait for the market tally');
  await submit('I say, “Guild runner, how did you hear of the closure?”');
  await submit('Read the market copy of the order');
  await submit('I say, “Market baker, when could we use your oven?”');
  expect(prompts).toHaveLength(4);
  const observed = [
    ['alice', 'The clerk reached for the ledger.', 'firsthand'],
    ['market-carter', 'scores the hired-cart tally into wax', 'firsthand'],
    ['guild-runner', 'He has the closure from the order.', 'reported'],
    ['market-baker', 'two hours before dawn', 'firsthand'],
  ];
  for (const [index, [id, text, status]] of observed.entries()) {
    expect(prompts[index].actor.id).toBe(id);
    expect(prompts[index].evidence).toContainEqual(expect.objectContaining({ text: expect.stringContaining(text), status }));
  }
  expect(JSON.stringify(prompts[3])).not.toContain('The clerk reached for the ledger.');
});
