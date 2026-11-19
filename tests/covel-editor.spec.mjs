import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel suite with HARBINGER_TEST_COVEL=1.');

async function play(request, root, save, text, requestId = `turn-${save.revision}`) {
  const response = await request.post(`${root}/${save.id}/turns`, { data: { text, revision: save.revision, requestId } });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('the resolved guild scene still saves once when the provider is unavailable', async ({ request }) => {
  const app = await startApp({ engine: 'covel', provider: { url: 'http://127.0.0.1:1/v1/chat/completions', name: 'offline' } });
  try {
    const root = `${app.url}/api/saves`;
    const save = await (await request.post(root, { data: {} })).json();
    const action = 'Take the ledger to Martin';
    const turn = await play(request, root, save, action);
    const replay = await play(request, root, save, action);
    expect(replay.revision).toBe(turn.revision);

    const persisted = await (await request.get(`${root}/${save.id}`)).json();
    expect(persisted.passages).toHaveLength(2);
    const passage = persisted.passages.at(-1);
    expect(passage).toMatchObject({ heading: 'The last entry', playerText: action });
    expect(passage.paragraphs.join(' ')).toContain('Martin sets a finger beside the delivery column.');
    expect(persisted.observations).toContainEqual(expect.objectContaining({ title: 'The guild room', passageId: passage.id }));
  } finally {
    await app.close();
  }
});

test('a character receives shareable evidence and falls back when its reply requests an unavailable meeting', async ({ request }) => {
  const question = 'What do you have to tell me, Martin?';
  const secret = 'The blue loaf wakes at low tide.';
  const guessedConfidence = 'Martin says the blue bread comes alive at the lowest tide.';
  const unchosenAction = 'You tear the ledger page free while Martin watches.';
  const dialogue = [];
  const provider = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(payload.input ?? payload.messages.findLast(message => message.role === 'user').content);
    let result = { index: 0 };
    if (context.text?.includes(question)) {
      result = { intents: [{ type: 'speak', actorId: 'martin', words: question, choice: null }] };
    } else if (context.words === question) {
      dialogue.push(context);
      result = {
        meetingId: 'tower',
        reply: `${guessedConfidence} ${unchosenAction}`,
      };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: {
      url: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, name: 'fixture', key: 'fixture',
    } });
    const root = `${app.url}/api/saves`;
    let save = await (await request.post(root, { data: {} })).json();
    save = await play(request, root, save, 'Promise Alice discretion');
    save = await play(request, root, save, 'Ask Alice what brought Guenever to London');
    const resolved = await play(request, root, save, `I ask Martin, “${question}”`);

    expect(dialogue).toHaveLength(1);
    expect(dialogue[0].actor.id).toBe('martin');
    expect(JSON.stringify(dialogue[0])).not.toContain('carter-phrase');
    expect(JSON.stringify(dialogue[0])).not.toContain(secret);
    expect(JSON.stringify(dialogue[0])).not.toContain('The carter saw Guenever at the Tower.');
    expect(resolved.revision).toBe(save.revision + 1);
    expect(resolved.passages.at(-1).paragraphs.join(' ')).toContain('Put your question plainly, if you please.');
    expect(resolved.choices).not.toContain('Meet Martin at the Tower');
    const saved = await (await request.get(`${root}/${save.id}`)).json();
    expect(saved.passages).toHaveLength(resolved.passages.length);
    for (const invalid of [secret, guessedConfidence, unchosenAction]) expect(JSON.stringify(saved)).not.toContain(invalid);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
  }
});

test('a stalled Character provider still leaves one complete saved exchange', async ({ request }) => {
  let replies = 0;
  const provider = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    const context = JSON.parse(payload.input ?? payload.messages.at(-1).content);
    if (context.words) {
      replies++;
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '{"index":0}' }, finish_reason: 'stop' }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: {
      url: 'http://127.0.0.1:' + provider.address().port + '/v1/chat/completions', name: 'stalled', key: 'fixture',
    } });
    const root = app.url + '/api/saves';
    const save = await (await request.post(root, { data: {} })).json();
    const action = 'I ask Alice, “What do you need from me?”';
    const started = performance.now();
    const committed = await play(request, root, save, action);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(committed.passages.at(-1).paragraphs.join(' ')).toContain('Tell me what you need, plain as that.');
    expect(await play(request, root, save, action)).toEqual(committed);
    expect(replies).toBe(1);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
  }
});
