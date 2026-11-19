import { expect, test } from '@playwright/test';
import { startEpisode } from '../app/episode.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { createCovelActors } from '../covel/actors.mjs';

const confidence = 'Between the two of us, then.';
const report = 'The carter saw Guenever at the Tower.';
const question = 'What did we agree would stay between us?';
const remembered = 'We said it would stay between us. I was going to wait till Martin had gone out into the lane before I spoke.';
const noRecollection = 'Tell me a little more about what you mean. I can’t place the agreement you’re asking about.';

function recallPriorWords({ context }) {
  const reply = context.evidence.some(item => item.text.includes(confidence)) ? remembered : noRecollection;
  return { reply, meetingId: null };
}

test('freeform replies recall only the speaker’s own past exchanges', async () => {
  const initial = startEpisode();
  const promised = (await resolveTurn({ state: initial }, 'Promise Alice discretion')).state;
  const disclosed = (await resolveTurn({ state: promised }, 'Ask Alice what brought Guenever to London')).state;
  const calls = [];
  const actors = createCovelActors(undefined, {
    completeCharacter(request) {
      calls.push(request.context);
      return recallPriorWords(request);
    },
  });

  expect((await actors.respond(initial, { actorId: 'alice', words: question })).reply).toBe(noRecollection);
  expect((await actors.respond(disclosed, { actorId: 'alice', words: question })).reply)
    .toBe(remembered);
  expect(calls.at(-1).evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: expect.stringContaining(confidence), source: 'Conversation with Alice', status: 'firsthand' }),
    expect.objectContaining({ text: expect.stringContaining(report), source: 'Alice', status: 'reported' }),
  ]));
  expect(JSON.stringify(calls.at(-1).evidence)).not.toContain('The blue loaf wakes at low tide.');

  expect((await actors.respond(disclosed, { actorId: 'martin', words: question })).reply).toBe(noRecollection);
  expect(JSON.stringify(calls.at(-1).evidence)).not.toContain(confidence);
  expect(JSON.stringify(calls.at(-1).evidence)).not.toContain(report);
  expect(JSON.stringify(calls.at(-1).evidence)).not.toContain('The blue loaf wakes at low tide.');
});

test('Hindsight ranks committed actor knowledge, and the actor can also recall legal earlier steps locally', async () => {
  const committed = startEpisode();
  const current = (await resolveTurn({ state: committed }, 'Promise Alice discretion')).state;
  const requests = [];
  const actorRequests = [];
  const invented = 'Mordred bought Martin a crown.';
  const actors = createCovelActors(undefined, {
    memory: { async recall(request) {
      requests.push(request);
      const publicReport = request.evidence.find(record => record.topic === 'arthur-death');
      const privateFact = request.evidence.find(record => record.id === 'fact:carter-phrase');
      return [{ id: 'forged-memory', text: invented }, privateFact, { ...publicReport, text: invented }];
    } },
    completeCharacter(request) {
      actorRequests.push(request.context);
      return recallPriorWords(request);
    },
  });
  const dialogue = { actorId: 'alice', words: question };

  expect((await actors.respond(current, dialogue, { sessionId: 'save', incarnation: 'original', committedState: committed })).reply)
    .toBe(remembered);
  expect(requests[0]).toMatchObject({ sessionId: 'save', incarnation: 'original', actorId: 'alice', query: question });
  expect(requests[0]).not.toHaveProperty('committedState');
  expect(JSON.stringify(requests[0].evidence)).not.toContain(confidence);
  expect(JSON.stringify(requests[0].evidence)).toContain('The blue loaf wakes at low tide.');
  expect(JSON.stringify(actorRequests[0].evidence)).toContain(confidence);
  expect(JSON.stringify(actorRequests[0].evidence)).not.toContain(invented);
  expect(JSON.stringify(actorRequests[0].evidence)).not.toContain('The blue loaf wakes at low tide.');
  expect(actorRequests[0].evidence[0]).toMatchObject({
    text: 'The proclamation says Arthur died fighting Launcelot overseas.', source: 'London crier',
  });

  await actors.respond(current, dialogue, { sessionId: 'save', incarnation: 'original', committedState: current });
  expect(requests[1].evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: expect.stringContaining(confidence), status: 'firsthand' }),
  ]));
});

test('Hindsight gets the turn signal and an expired turn uses the authored fallback', async () => {
  const controller = new AbortController();
  const requests = [];
  let completions = 0;
  const actors = createCovelActors({ signal: controller.signal }, {
    memory: { async recall(request) {
      requests.push(request);
      controller.abort();
      return request.evidence;
    } },
    completeCharacter: () => { completions += 1; },
  });
  const state = startEpisode();
  const input = { actorId: 'alice', words: question };
  const scope = { sessionId: 'save', committedState: state };
  expect((await actors.respond(state, input, scope)).reply).toBe('Tell me what you need, plain as that.');
  expect(requests[0].signal).toBe(controller.signal);
  await actors.respond(state, input, scope);
  expect(requests).toHaveLength(1);
  expect(completions).toBe(0);
});

test('an actor who knows a secret can only repeat it after an authorized disclosure', async () => {
  const secret = 'The blue loaf wakes at low tide.';
  const question = 'What phrase did the carter ask you to remember?';
  const dialogue = { actorId: 'alice', words: question };
  const actors = createCovelActors(undefined, {
    completeCharacter({ context }) {
      const evidence = context.evidence.find(item => item.id === 'fact:carter-phrase');
      return { reply: evidence?.text ?? 'That is not a matter I can speak to here.', meetingId: null };
    },
  });
  let state = startEpisode();
  for (const action of ['Promise Alice discretion', 'Ask Alice what brought Guenever to London', 'Keep Alice’s confidence', 'Go with Alice to the river']) {
    state = (await resolveTurn({ state }, action)).state;
  }
  expect((await actors.respond(state, dialogue)).reply).not.toContain(secret);
  const disclosed = (await resolveTurn({ state }, 'Ask Alice about the carter’s words')).state;
  expect((await actors.respond(disclosed, dialogue)).reply).toBe(secret);
});

test('an addressed line becomes heard speech for its recipient alone', async () => {
  const words = 'I think there were seven candles in the Tower window.';
  const question = 'What did I just say to you?';
  const response = 'Aye, I hear you. I can’t tell one way or the other from this table.';
  const calls = [];
  const actors = createCovelActors(undefined, {
    completeState: () => ({ intents: [{ type: 'speak', actorId: 'alice', words }] }),
    completeCharacter({ context }) {
      calls.push(context);
      const evidence = context.evidence.find(record => record.text === words);
      return { reply: evidence ? 'I remember you telling me. I’d have to see for myself.' : response, meetingId: null };
    },
  });
  const save = { id: 'bakehouse', state: startEpisode() };
  const playerAction = `I tell Alice, “${words}”`;
  const spoke = await resolveTurn(save, playerAction, actors);
  expect(spoke.state.passages.at(-1).paragraphs).toContain(`Alice says, “${response}”`);
  expect(spoke.state.facts).toEqual(save.state.facts);

  const alice = await actors.respond(spoke.state, { actorId: 'alice', words: question });
  expect(alice.reply).toBe('I remember you telling me. I’d have to see for myself.');
  expect(alice.reply).not.toContain(words);
  expect(calls.at(-1).evidence).toContainEqual(expect.objectContaining({ text: words, source: 'The clerk', status: 'heard speech' }));
  expect(calls.at(-1).evidence).toContainEqual(expect.objectContaining({ text: response, source: 'Alice', status: 'own prior speech' }));

  const martin = await actors.respond(spoke.state, { actorId: 'martin', words: question });
  expect(martin.reply).not.toContain(words);
  expect(JSON.stringify(calls.at(-1).evidence)).not.toContain(words);
});

test('only a named witness can recall a shared firsthand observation', async () => {
  const state = startEpisode();
  const text = 'A stone weight rests beside the scales.';
  const observation = {
    id: 'stone-weight', passageId: 'passage-0', kind: 'clue', text, status: 'firsthand',
    source: 'Seen at the bakehouse', recipients: ['player', 'alice'], minute: state.minute,
  };
  state.observations.push(observation, { ...observation, id: 'private-quoted-line',
    text: 'Martin said “I have paid for the flour.”', recipients: ['alice'] });
  const actors = createCovelActors(undefined, {
    completeCharacter({ context }) {
      expect(context.evidence.some(item => item.id === 'observation:private-quoted-line')).toBe(false);
      const sight = context.evidence.find(item => item.id === 'observation:stone-weight');
      return { reply: sight?.text ?? 'I can’t answer that with any certainty.', meetingId: null };
    },
  });
  const words = 'What was beside the scales?';
  expect((await actors.respond(state, { actorId: 'alice', words })).reply).toBe(text);
  expect((await actors.respond(state, { actorId: 'martin', words })).reply).toBe('I can’t answer that with any certainty.');
});
