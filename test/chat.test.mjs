import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createServer } from '../server.mjs';

const character = (id, name) => ({ id, name, aliases: [], summary: '', sourcePages: [1] });
const event = (id, participants, statement) => ({
  id, title: id, when: 'That day', summary: statement, locationIds: [], participants,
  sourcePages: [1], knowledge: [{ statement, visibleTo: participants, route: 'direct' }],
});
const story = {
  title: 'The lockhouse', source: { filename: 'fixture' },
  characters: [character('ada', 'Ada'), character('ben', 'Ben')], locations: [],
  events: [
    event('private', ['ben'], 'The hidden signal is SABLE-FLARE.'),
    event('arrival', ['ada'], 'The unlocked door is painted cobalt.'),
    event('tomorrow', ['ada'], 'The key the next day is NEPHRITE-KEY.'),
  ],
};

const responses = {
  selfProbe: { refined_query: 'The color of the lockhouse door.', self_probe: 'What color was the door?' },
  sufficiency: { sufficient: true },
  conclusion: { supported: true, conclusion: 'Ada saw a cobalt door.' },
  emotionGate: { fire: false },
  fusion: 'I saw a cobalt door.',
};

async function start(t, providers) {
  const server = await createServer({ story, providers, storageDirectory: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('chat retrieves the character’s evidence without sending another perspective or future scene to any model', async (t) => {
  const inputs = [];
  const settings = Object.fromEntries(Object.keys(responses).map((stage) => [stage, { model: 'openai/test-' + stage }]));
  const base = await start(t, {
    embed: async ({ texts }) => {
      inputs.push(texts);
      return texts.map(() => [1, 0]);
    },
    generate: async ({ model, input }) => {
      const stage = model.slice('openai/test-'.length);
      inputs.push(input);
      const result = responses[stage];
      assert.ok(result, 'Unexpected generation stage ' + stage);
      if (stage === 'fusion') assert.match(JSON.stringify(input.facts), /painted cobalt/i);
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  });
  const result = await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId: 'ada', eventId: 'arrival', message: 'What color was the door?', history: [], settings }),
  });
  assert.equal(result.status, 200);
  const turn = await result.json();
  assert.equal(turn.reply, 'I saw a cobalt door.');
  assert.deepEqual(turn.trace.scenes.map(({ id }) => id), ['arrival']);
  assert.doesNotMatch(JSON.stringify(inputs), /SABLE-FLARE|NEPHRITE-KEY/);
});

test('chat exhausts bounded probes and marks the final response unsupported when the evidence checks fail', async (t) => {
  const probes = ['Did Ada see a radio?', 'What signal did Ada hear?', 'Was the signal written at the lockhouse?'];
  const settings = Object.fromEntries(Object.keys(responses).map((stage) => [stage, { model: 'openai/test-' + stage }]));
  const base = await start(t, {
    embed: async ({ texts }) => texts.map(() => [1, 0]),
    generate: async ({ model, input }) => {
      const stage = model.slice('openai/test-'.length);
      if (stage === 'selfProbe') return JSON.stringify({ refined_query: 'What signal did Ada learn?', self_probe: probes[input.priorProbes.length] });
      if (stage === 'sufficiency') return '{"sufficient":false}';
      if (stage === 'conclusion') return '{"supported":true,"conclusion":"The model guessed an answer."}';
      if (stage === 'fusion') return input.grounded || input.conclusion.includes('guessed') ? 'My guess is an answer.' : 'I never learned what the signal was.';
      return JSON.stringify(responses[stage]);
    },
  });
  const result = await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId: 'ada', eventId: 'arrival', message: 'What was the distress signal?', settings }),
  });
  assert.equal(result.status, 200);
  const turn = await result.json();
  assert.equal(turn.reply, 'I never learned what the signal was.');
  assert.deepEqual(turn.trace.rounds.map(({ probe }) => probe), probes);
  assert.equal(turn.trace.grounded, false);
});
