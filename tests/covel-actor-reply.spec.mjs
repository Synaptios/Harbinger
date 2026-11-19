import { expect, test } from '@playwright/test';
import { startEpisode } from '../app/episode.mjs';
import { speakerHistory } from '../app/knowledge.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { createCovelActors } from '../covel/actors.mjs';

test('the addressed actor writes a reply using only shareable knowledge', async () => {
  const words = 'Will you come to supper after you’re finished here?';
  const reply = 'When the last loaf comes out, ask me again. I can talk a good deal better when I’m sitting down than when I’m trying to hear you over the oven.';
  const requests = [];
  const actors = createCovelActors(undefined, { completeCharacter(request) {
    requests.push(request);
    return { reply, meetingId: null };
  } });

  expect(await actors.respond(startEpisode(), { actorId: 'alice', words })).toMatchObject({ reply, commitment: null });
  const [{ context }] = requests;
  expect(context).toMatchObject({
    words,
    actor: { id: 'alice', name: 'Alice' },
    evidence: expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringContaining('belief:arthur-death:'),
        source: 'London crier', status: 'reported', stance: 'doubts',
      }),
    ]),
  });
  expect(context.actor.voice).not.toHaveProperty('examples');
  const sent = JSON.stringify(context);
  expect(sent).not.toContain('Mordred commissioned');
  expect(sent).not.toContain('Arthur has landed at Dover');
  expect(sent).not.toContain('Six sacks');
  expect(sent).not.toContain('The blue loaf wakes at low tide.');
  expect(sent).not.toContain('Guenever took refuge');
});

test('malformed replies and unavailable meeting IDs use the authored fallback', async () => {
  const invented = 'I have paid Martin to keep the oven open.';
  const attempts = [
    { reply: invented },
    { reply: '', meetingId: null },
    { reply: '“ ”', meetingId: null },
    { reply: invented, meetingId: 'tower' },
    { reply: invented, meetingId: null, commitment: invented },
  ];
  const actors = createCovelActors(undefined, { completeCharacter: () => attempts.shift() });
  for (const attempt of [...attempts]) {
    const result = await actors.respond(startEpisode(), { actorId: 'alice', words: 'What was in the letters?' });
    expect(result, JSON.stringify(attempt)).toMatchObject({ actorId: 'alice', reply: 'Tell me what you need, plain as that.', commitment: null });
  }
});

test('a structurally valid line is returned without semantic review', async () => {
  const reply = 'I thought I saw an odd coin on the table, but I can’t say where it came from.';
  let calls = 0;
  const actors = createCovelActors(undefined, { completeCharacter() {
    calls += 1;
    return { reply, meetingId: null };
  } });
  expect(await actors.respond(startEpisode(), { actorId: 'alice', words: 'What caught your eye?' })).toMatchObject({ reply });
  expect(calls).toBe(1);
});

test('a grounded appointment can still be proposed using the offered world option', async () => {
  const words = 'Could we speak again somewhere away from the guild?';
  const actors = createCovelActors(undefined, { completeCharacter({ context }) {
    expect(context.meetingOptions).toEqual([{ id: 'thames-landing', place: 'the Thames landing',
      time: 'Late afternoon', purpose: 'flour' }]);
    return { reply: 'I could speak to you nearer the river, if we can find a moment free of the guild.', meetingId: 'thames-landing' };
  } });
  expect(await actors.respond(startEpisode(), { actorId: 'alice', words })).toMatchObject({
    commitment: { locationId: 'thames-landing', purpose: 'flour' },
  });
});

test('benchmark mode records a stalled reply without substituting a line in the scene', async () => {
  const stall = () => { throw new DOMException('The reply deadline expired', 'TimeoutError'); };
  const stalls = [];
  const text = 'I ask Alice, “What do you need from me?”';
  const save = { id: 'timed-out-conversation', state: startEpisode() };
  const actors = createCovelActors(undefined, { completeCharacter: stall, noteStall: stage => stalls.push(stage) });
  const { state } = await resolveTurn(save, text, actors, { continueOnUnclear: true });
  expect(stalls).toEqual(['character-reply']);
  expect(state.passages).toHaveLength(2);
  expect(state.passages.at(-1).paragraphs).toEqual(['Alice turns toward the clerk to listen.']);
  expect(state.records).toContainEqual(expect.objectContaining({ type: 'protagonist-speech', words: 'What do you need from me?' }));
  expect(state.records.some(record => record.type === 'actor-exchange')).toBe(false);
  const normal = createCovelActors(undefined, { completeCharacter: stall });
  expect((await normal.respond(save.state, { actorId: 'alice', words: 'What do you need from me?' })).reply)
    .toBe('Tell me what you need, plain as that.');
});

async function afterActions(actions) {
  let state = startEpisode();
  for (const action of actions) ({ state } = await resolveTurn({ state }, action));
  return state;
}

const market = 'Ask the carters in the market';
const waitForTally = 'Wait for the market tally';
const storehouse = ['Go with Alice to the river', 'Visit the riverside storehouse'];
const factualQuestions = [
  ['who counts as a witness', [], 'martin', 'Who would qualify as a witness?',
    'guild-witness-rule', /where they stood/iu],
  ['writing a secondhand account', ['Take the ledger to Martin'], 'martin', 'Would you enter a rumor in the book?',
    'guild-witness-rule', /(?:under the name|as a report)/iu],
  ['flour handoff', [], 'alice', 'Which way do you want the sacks taken?', 'flour-handoff', /Thames landing/u],
  ['ledger incident', ['I try to take the ledger'], 'alice', 'Why did you stop my hand on the ledger?',
    'Alice stops the clerk at the ledger', /(?:you reached|yours was reaching)/iu],
  ['guild attribution', ['Ask Alice about the proclamation'], 'alice', 'Do you know what Martin will write down?',
    'ledger-dusk', /you (?:Martin asked to bring|to bring him).*dusk/iu],
  ['guild names', ['Take the ledger to Martin'], 'alice', 'Which names may be read out?',
    'ledger-names', /(?:give each one a moment|read .*slowly)/iu],
  ['wax tally before the last count', [market], 'market-carter', 'How would you tell where a hired load went?',
    'wax-tally', /wax.*(?:last tally|before I can say)/iu],
  ['completed cart tally', [market, waitForTally], 'market-carter', 'Can you tell me where the cart went?',
    'completed-wax-tally', /(?:tally’s here|tally’s finished)/iu],
  ['closure source', [market, waitForTally], 'guild-runner', 'Did you see the shutter sealed?',
    'closure-source', /(?:written guild order|order in writing)/iu],
  ['conditional oven hours', [market, waitForTally, 'Read the market copy of the order'], 'market-baker', 'When could Alice use the oven?',
    'oven-hours', /two hours before dawn/iu],
  ['tally mark', [...storehouse, 'Ask the porter about the guild tally'], 'guild-porter', 'Where do you write the mark for the sack?',
    'fact:storehouse-tally', /(?:mark.*entry|mark.*entered)/iu],
];

for (const [name, actions, actorId, words, recordKey, expected] of factualQuestions) {
  test(`a direct question about ${name} uses the speaker’s known record`, async () => {
    const state = await afterActions(actions);
    const supplied = [];
    const actors = createCovelActors(undefined, { completeCharacter({ context, schema }) {
      supplied.push(context);
      expect(schema.properties.reply.enum).toEqual(context.replyOptions.map(({ id }) => id));
      return { reply: context.replyOptions[0].id, meetingId: null };
    } });
    const { reply, commitment } = await actors.respond(state, { actorId, words });
    expect(commitment).toBeNull();
    expect(reply).toMatch(expected);
    expect(supplied).toHaveLength(1);
    expect(supplied[0].evidence).toHaveLength(1);
    const [record] = supplied[0].evidence;
    expect([record.topic, record.title, record.id]).toContain(recordKey);
    expect(supplied[0].replyOptions.every(option => expected.test(option.text))).toBe(true);
  });
}

test('an undisclosed tally rule never reaches the speaker’s answer options', async () => {
  const state = await afterActions(storehouse);
  let speech;
  const actors = createCovelActors(undefined, { completeCharacter({ context }) {
    speech = context;
    return { reply: 'Ask me which mark you mean.', meetingId: null };
  } });
  const result = await actors.respond(state, { actorId: 'guild-porter', words: 'Where do you write the mark?' });
  expect(result.reply).toBe('Ask me which mark you mean.');
  expect(speech.replyOptions).toBeUndefined();
  expect(speech.evidence.map(item => item.id)).not.toContain('fact:storehouse-tally');
});

test('a spoken threat can get a personal response with the same narrow witness evidence', async () => {
  const state = startEpisode();
  const words = 'Answer me, or I’ll start breaking things. What do you count as a witness?';
  let answer;
  const actors = createCovelActors({}, { completeCharacter({ context, instructions, schema }) {
    expect(context.actor.id).toBe('martin');
    expect(context.words).toBe(words);
    expect(context.evidence.map(item => item.topic)).toEqual(['guild-witness-rule']);
    expect(context.reactToThreat).toBe(true);
    expect(schema.properties.reply.enum).toEqual(context.replyOptions.map(option => option.id));
    expect(schema.properties.reaction).toEqual({ type: ['string', 'null'], maxLength: 96 });
    expect(instructions).toContain('threat');
    expect(schema.properties.meetingId).toEqual({ type: 'null' });
    answer = context.replyOptions[0].text;
    return { reply: context.replyOptions[0].id, reaction: 'I won’t be spoken to that way.', meetingId: null };
  } });
  const result = await actors.respond(state, { actorId: 'martin', words });
  expect(result.reply).toBe('I won’t be spoken to that way. ' + answer);
  expect(result.commitment).toBeNull();
});

test('a spoken reaction does not cause the same recorded answer to repeat', async () => {
  const offered = [];
  const actors = createCovelActors({}, { completeCharacter({ context }) {
    offered.push(context.replyOptions.map(option => option.id));
    return { reply: context.replyOptions[0].id, reaction: 'I heard the threat.', meetingId: null };
  } });
  const action = 'I ask Martin, “I’ll start breaking things. What do you count as a witness?”';
  const { state } = await resolveTurn({ state: startEpisode() }, action, actors);
  await resolveTurn({ state }, action, actors);
  expect(offered).toEqual([['wording-1', 'wording-2'], ['wording-2']]);
});

test('a repeated record question offers unused wording for that speaker first', async () => {
  const choices = [];
  const actors = createCovelActors({}, { completeCharacter({ context }) {
    choices.push(context.replyOptions);
    return { reply: context.replyOptions[0].id, meetingId: null };
  } });
  const words = 'What do you count as an eyewitness?';
  const action = 'I ask Martin, “' + words + '”';
  let state = startEpisode();
  const delivered = [];
  for (let turn = 0; turn < 3; turn += 1) {
    ({ state } = await resolveTurn({ state }, action, actors));
    delivered.push(state.records.findLast(event => event.type === 'actor-exchange').reply);
  }
  expect(choices.map(options => options.map(option => option.id))).toEqual([
    ['wording-1', 'wording-2'], ['wording-2'], ['wording-1'],
  ]);
  expect(delivered).toEqual([choices[0][0].text, choices[0][1].text, choices[0][0].text]);
});

test('ordinary follow-ups receive the speaker’s recent delivery without the other actor’s words', async () => {
  let state = await afterActions(['Ask Alice about the proclamation', 'Ask Martin about the proclamation']);
  const alice = 'I’d give my word once I had heard it from the person who saw it.';
  const completions = [];
  const actors = createCovelActors({}, { completeCharacter({ context }) {
    completions.push(context);
    return { reply: alice, meetingId: null };
  } });
  ({ state } = await resolveTurn({ state }, 'I ask Alice, “What would make you trust someone?”', actors));
  await actors.respond(state, { actorId: 'alice', words: 'What about the man in the lane?' });
  await actors.respond(state, { actorId: 'martin', words: 'What about the man in the lane?' });
  expect(completions[1].recentSpeech).toEqual([...completions[0].recentSpeech, alice]);
  expect(completions[1].recentSpeech.join(' ')).toContain('Ink and a loud voice cost less than a witness.');
  expect(completions[2].recentSpeech.join(' ')).toContain('I take a sealed notice seriously.');
  expect(completions[2].recentSpeech).not.toContain(alice);
});

test('scripted dialogue uses a different delivery on repeat and after a disclosure', async () => {
  let state = await afterActions(['Ask Martin what brought Guenever to London']);
  const before = speakerHistory(state, 'martin').at(-1);
  ({ state } = await resolveTurn({ state }, 'Ask Martin what brought Guenever to London'));
  expect(speakerHistory(state, 'martin').at(-1)).not.toBe(before);
  for (const action of ['Promise Alice discretion', 'Ask Alice what brought Guenever to London',
    'Tell Martin what Alice said about the Queen', 'Ask Martin what brought Guenever to London']) {
    ({ state } = await resolveTurn({ state }, action));
  }
  expect(state.passages.at(-1).paragraphs.join(' ')).toContain('as the clerk’s account');
  expect(state.passages.at(-1).paragraphs.join(' ')).not.toContain(before);
  expect(speakerHistory(state, 'martin').at(-1)).toContain('Your name belongs with the account');
});

test('a written statement remains the scribe’s words and does not count as Alice’s delivery', async () => {
  const state = await afterActions(['Promise Alice discretion', 'Ask Alice what brought Guenever to London',
    'Keep Alice’s confidence', 'Go with Alice to the river', 'Read the carter’s sealed statement']);
  expect(state.passages.at(-1).paragraphs.join(' ')).toContain('I saw Mordred commission the letters');
  expect(speakerHistory(state, 'alice').join(' ')).not.toContain('I saw Mordred commission the letters');
});
