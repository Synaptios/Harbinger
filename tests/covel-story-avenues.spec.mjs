import { expect, test } from '@playwright/test';
import restore from '../covel/plugins/harbinger/runtimes/restore/handler.js';
import story from '../covel/plugins/harbinger/runtimes/story/handler.js';
import { packSave } from '../covel/saves.mjs';
import { storyAvenues } from '../covel/worlds/bread-ledger/story-avenues.mjs';

const privateStory = '_hidden.story';
const bread = storyAvenues.find(avenue => avenue.id === 'bread-supply');
const trajectory = 'The bread supply can become more urgent as Alice has to balance her apprentice with the rest of the lane.';
const initialNativeStoryRole = process.env.HARBINGER_NATIVE_STORY_ROLE;
const initialWaitPolicy = process.env.HARBINGER_WAIT_FOR_PROVIDERS;

test.beforeEach(() => {
  process.env.HARBINGER_NATIVE_STORY_ROLE = '1';
});

test.afterEach(() => {
  if (initialNativeStoryRole === undefined) delete process.env.HARBINGER_NATIVE_STORY_ROLE;
  else process.env.HARBINGER_NATIVE_STORY_ROLE = initialNativeStoryRole;
  if (initialWaitPolicy === undefined) delete process.env.HARBINGER_WAIT_FOR_PROVIDERS;
  else process.env.HARBINGER_WAIT_FOR_PROVIDERS = initialWaitPolicy;
});

function fixture(sessionId, preferredAvenue = bread.id, { stallReply = false } = {}) {
  const storage = new Map();
  const reviews = [];
  const keyFor = (namespace, key) => namespace + '\0' + key;
  const pluginData = {
    get: (namespace, key) => structuredClone(storage.get(keyFor(namespace, key))),
    set: (namespace, key, value) => storage.set(keyFor(namespace, key), structuredClone(value)),
    list: namespace => Array.from(storage)
      .filter(([key]) => key.startsWith(keyFor(namespace, '')))
      .map(([key, value]) => ({ key: key.slice(namespace.length + 1), value: structuredClone(value) })),
  };
  const gateway = {
    resolveSlot({ presetId }) {
      if (presetId === 'slot-pacing-director') return { presetId };
    },
    async generateObject({ presetId, system, prompt, schema }) {
      if (presetId === 'slot-pacing-director') {
        reviews.push({ system, briefing: JSON.parse(prompt), schema });
        if ('avenues' in schema.properties) {
          const offered = schema.properties.avenues.items.properties.id.enum;
          const avenues = storyAvenues.filter(({ id }) => offered.includes(id))
            .map(({ id, premise }) => ({ id, trajectory: id === bread.id ? trajectory : premise }));
          return { object: { avenues } };
        }
        const offered = schema.properties.avenueId.enum;
        return { object: { avenueId: offered.includes(preferredAvenue) ? preferredAvenue : offered[0] } };
      }
      if ('intents' in schema.properties) {
        const intent = stallReply
          ? { type: 'speak', choice: null, words: 'Would you rather talk later?', actorId: 'alice' }
          : { type: 'unclear', choice: null, words: null, actorId: null };
        return { object: { intents: [intent] } };
      }
      if (stallReply && 'reply' in schema.properties) throw new DOMException('Provider exceeded its timeout', 'TimeoutError');
      if ('porterName' in schema.properties) return { object: { porterName: 'Thomas', sign: 'Anchor' } };
      return { object: { index: 0 } };
    },
  };
  function context(actions = []) {
    return {
      sessionId, pluginData, gateway, signal: new AbortController().signal,
      playerActions: actions.map(text => ({ kind: 'act', text })), playerMessage: '',
    };
  }
  const save = () => pluginData.get(privateStory, 'current');
  return {
    reviews, context, save,
    play: (...actions) => story(context(actions)),
    publicView: () => pluginData.get('story', 'view'),
    setPacing(pacing) {
      const current = save();
      current.state.pacing = pacing;
      pluginData.set(privateStory, 'current', current);
    },
    capture() {
      const passages = pluginData.list('passages').map(row => row.value).sort((a, b) => a.sequence - b.sequence);
      return JSON.parse(JSON.stringify(packSave(save(), passages)));
    },
  };
}

test('a saved pacing review waits for a substantive player turn and runs in two stages', async () => {
  const game = fixture('pacing-cadence');
  await game.play();
  expect(game.reviews).toHaveLength(0);
  const initialPacing = game.save().state.pacing;
  expect(initialPacing.turn).toBe(0);
  expect(initialPacing.nextReview).toBeGreaterThanOrEqual(10);
  expect(initialPacing.nextReview).toBeLessThanOrEqual(20);

  game.setPacing({ turn: 0, nextReview: 10, active: null });
  await game.play('Ask Alice about the proclamation', 'Look around');
  expect(game.save().state.passages).toHaveLength(3);
  expect(game.save().state.pacing.turn).toBe(1);

  for (let turn = 2; turn < 10; turn++) await game.play('Look around');
  expect(game.save().state.pacing).toMatchObject({ turn: 9, nextReview: 10, active: null });
  expect(game.reviews).toHaveLength(0);

  await game.play('Do the usual thing');
  await game.play('What happens now?');
  expect(game.save().state.pacing.turn).toBe(9);
  expect(game.reviews).toHaveLength(0);

  await game.play('Look around');
  const { turn, nextReview, active } = game.save().state.pacing;
  expect(turn).toBe(10);
  expect(nextReview - turn).toBeGreaterThanOrEqual(10);
  expect(nextReview - turn).toBeLessThanOrEqual(20);
  expect(active).toMatchObject({ id: bread.id, startedTurn: 10, stage: 0 });
  expect(game.reviews).toHaveLength(2);
  expect(game.reviews[0].system).not.toMatch(/The Bread Ledger/iu);
  expect(game.reviews[0].briefing.earlierStory.map(({ heading }) => heading)).toContain('Alice on the proclamation');
  expect(game.reviews[1].system).toMatch(/The Bread Ledger/iu);
  expect(JSON.stringify(game.reviews[1].briefing)).toContain(trajectory);
  expect(game.publicView()).not.toHaveProperty('pacing');
  expect(JSON.stringify(game.publicView())).not.toContain(trajectory);
});

test('a committed spoken turn still reaches a due review after a character provider timeout', async () => {
  process.env.HARBINGER_WAIT_FOR_PROVIDERS = '1';
  const game = fixture('pacing-after-timeout', bread.id, { stallReply: true });
  await game.play();
  game.setPacing({ turn: 9, nextReview: 10, active: null });
  await game.play('I ask Alice, “Would you rather talk later?”');
  expect(game.save().state.records).toContainEqual(expect.objectContaining({
    type: 'protagonist-speech', words: 'Would you rather talk later?',
  }));
  expect(game.reviews).toHaveLength(2);
  expect(game.save().state.pacing).toMatchObject({ turn: 10, active: { id: bread.id } });
});

test('canceling during passage composition leaves the committed save and Journal unchanged', async () => {
  const game = fixture('canceled-passage');
  await game.play();
  const before = game.capture();
  const publicView = game.publicView();
  const action = 'Go with Alice to the river';
  const context = game.context([action]);
  const controller = new AbortController();
  const canceled = new Error('The player canceled this turn.');
  const generate = context.gateway.generateObject;
  context.gateway.generateObject = async request => {
    const result = await generate(request);
    if (request.presetId === 'character' && 'index' in request.schema.properties) controller.abort(canceled);
    return result;
  };

  await expect(story({ ...context, signal: controller.signal })).rejects.toBe(canceled);
  expect(game.capture()).toEqual(before);
  expect(game.publicView()).toEqual(publicView);
});

test('a selected avenue produces its later beats after a portable reload and preserves the player’s choices', async () => {
  const game = fixture('pacing-original');
  await game.play();
  const originalChoices = game.publicView().choices;
  game.setPacing({ turn: 9, nextReview: 10, active: null });
  await game.play('Look around');
  const selectedPacing = game.save().state.pacing;
  expect(game.reviews).toHaveLength(2);

  const restored = fixture('pacing-restored');
  const restoreResult = await restore({ ...restored.context(), manualPayload: game.capture() });
  expect(restoreResult.outcome).toBe('success');
  await restored.play();
  expect(restored.save().state.pacing).toEqual(selectedPacing);
  expect(restored.reviews).toHaveLength(0);
  expect(restored.publicView().choices).toEqual(originalChoices);

  const observations = restored.publicView().observations.map(observation => observation.id);
  await restored.play('Look around');
  expect(restored.publicView().observations.map(observation => observation.id)).toEqual(observations);
  const earlyResult = await restored.play('Look around');
  const firstBeat = restored.publicView().observations.filter(observation => !observations.includes(observation.id));
  expect(firstBeat).toEqual([expect.objectContaining(bread.stages[0].observation)]);
  const earlyNarration = earlyResult.content.value.segments.map(({ text }) => text);
  expect(earlyNarration).toContain('You take a moment to look around.');
  expect(earlyNarration).toContain(bread.stages[0].paragraph);
  expect(earlyNarration.join(' ')).not.toContain(trajectory);
  expect(restored.save().state.records).toContainEqual(expect.objectContaining({
    type: 'pacing-avenue', avenueId: bread.id, stage: 0,
  }));
  expect(restored.save().state.observations).toContainEqual(expect.objectContaining({
    ...bread.stages[0].observation, topic: 'pacing:' + bread.id, recipients: ['player', 'alice'],
  }));
  expect(restored.publicView().choices).toEqual(originalChoices);

  const continued = fixture('pacing-continued', 'guild-accountability');
  const continuedRestore = await restore({ ...continued.context(), manualPayload: restored.capture() });
  expect(continuedRestore.outcome).toBe('success');
  await continued.play();
  for (let turn = 13; turn <= 18; turn++) await continued.play('Look around');
  const followUp = continued.publicView().observations.filter(observation =>
    ![...observations, firstBeat[0].id].includes(observation.id));
  expect(followUp).toEqual([expect.objectContaining(bread.stages[1].observation)]);
  expect(continued.save().state.records).toContainEqual(expect.objectContaining({
    type: 'pacing-avenue', avenueId: bread.id, stage: 1,
  }));
  expect(continued.publicView().choices).toEqual(originalChoices);
  expect(continued.reviews).toHaveLength(0);

  continued.setPacing({ ...continued.save().state.pacing, nextReview: 20 });
  await continued.play('Look around');
  await continued.play('Look around');
  expect(continued.reviews).toHaveLength(2);
  expect(continued.save().state.pacing).toMatchObject({
    active: { id: bread.id, startedTurn: 10 }, queued: 'guild-accountability',
  });

  let payoff;
  for (let turn = 21; turn <= 28; turn++) payoff = await continued.play('Look around');
  expect(payoff.content.value.segments.map(({ text }) => text)).toContain(bread.stages[2].paragraph);
  expect(continued.save().state.records).toContainEqual(expect.objectContaining({
    type: 'pacing-avenue', avenueId: bread.id, stage: 2,
  }));
  expect(continued.save().state.pacing).toMatchObject({
    active: { id: 'guild-accountability', startedTurn: 28, stage: 0 }, queued: null, completed: [bread.id],
  });
  expect(continued.publicView().choices).toEqual(originalChoices);
});

test('a missed avenue advances offstage and can be learned from the NPC on returning', async () => {
  const game = fixture('pacing-offstage');
  await game.play();
  game.setPacing({ turn: 9, nextReview: 10, active: null });
  await game.play('Look around');
  await game.play('Go with Alice to the river');
  const storehouse = await game.play('Visit the riverside storehouse');
  expect(game.publicView().scene.id).toBe('guild-storehouse');
  expect(storehouse.content.value.segments.map(({ text }) => text)).not.toContain(bread.stages[0].paragraph);
  const firstStage = { type: 'pacing-avenue', avenueId: bread.id, stage: 0 };
  const stageTopic = 'pacing:' + bread.id;
  expect(game.save().state.records).toContainEqual(expect.objectContaining({ ...firstStage, discovery: 'offstage' }));
  expect(game.save().state.observations).toContainEqual(expect.objectContaining({
    ...bread.stages[0].observation, topic: stageTopic, status: 'firsthand', source: 'Alice', recipients: ['alice'],
  }));
  expect(game.publicView().observations.some(({ topic }) => topic === stageTopic)).toBe(false);

  const reunion = await game.play('Return to the Thames landing');
  expect(reunion.content.value.segments.map(({ text }) => text)).toContain(bread.stages[0].report);
  expect(game.publicView().observations.filter(({ topic }) => topic === stageTopic)).toEqual([
    expect.objectContaining({ ...bread.stages[0].observation, status: 'reported', source: 'Alice' }),
  ]);
  expect(game.publicView().choices).toContain('Help Alice load the flour');
  const next = await game.play('Look around');
  expect(next.content.value.segments.map(({ text }) => text)).not.toContain(bread.stages[0].report);
  expect(game.save().state.records.filter(record => record.type === firstStage.type && record.avenueId === bread.id)).toEqual([
    expect.objectContaining({ ...firstStage, discovery: 'reported' }),
  ]);
});

test('Alice can carry the flour plan forward after the current load leaves', async () => {
  const flour = storyAvenues.find(avenue => avenue.id === 'flour-route');
  const game = fixture('pacing-future-flour', flour.id);
  await game.play();
  game.setPacing({ turn: 9, nextReview: 10, active: null });
  await game.play('Look around');
  await game.play('Go with Alice to the river');
  const loaded = await game.play('Help Alice load the flour');
  expect(game.publicView().scene.id).toBe('shutter');
  expect(game.save().state.records).toContainEqual(expect.objectContaining({ type: 'flour-dispatched' }));
  expect(loaded.content.value.segments.map(({ text }) => text)).toContain(flour.stages[0].paragraph);
  expect(game.save().state.pacing.active).toMatchObject({ id: flour.id, stage: 1 });
  expect(game.publicView().choices).toContain('Read the guild notice');
});
