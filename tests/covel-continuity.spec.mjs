import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the native Covel suite with HARBINGER_TEST_COVEL=1.');

test('native dialogue uses separate memory banks and scoped speaker prompts', async ({ request }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-hindsight-native-'));
  const words = 'I ask Martin what brought Guenever to London, in his own words.';
  const counterfeit = 'I watched Arthur land at Dover this morning.';
  const hiddenAside = 'Ask Martin about the hidden goose, then wait.';
  const tallyReply = 'Wedding supplies are the only errand in my book.';
  const reportReply = 'I can enter what you told me under your name. The carter must put his own mark to it.';
  const slowQuestion = 'What else would you need from me?';
  const slowReply = 'Give me a moment to put it plainly. I will hear you out.';
  const banks = new Map();
  const actorPrompts = [];
  const storyPrompts = [];
  let malformedReply = false;
  const fixture = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    const bank = incoming.url.match(/^\/v1\/default\/banks\/([^/]+)\/memories(\/recall)?$/u);
    function send(body) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    }
    if (bank) {
      const [_, id, recall] = bank;
      if (!banks.has(id)) banks.set(id, new Map());
      const records = banks.get(id);
      if (recall) {
        return send({ results: [{ document_id: 'another-character', text: counterfeit },
          ...[...records.keys()].reverse().map(document_id => ({ document_id, text: counterfeit }))] });
      }
      for (const record of input.items) records.set(record.document_id, record.content);
      return send({ success: true });
    }
    const context = JSON.parse(input.messages.at(-1).content);
    let result;
    if ('currentScene' in context || 'candidate' in context || 'rating' in context) {
      storyPrompts.push(context);
      result = { prose: counterfeit };
    } else if ('meetingOptions' in context) {
      actorPrompts.push(context);
      if (context.words === slowQuestion) {
        await delay(3_400);
        return send({ choices: [{ message: { content: JSON.stringify({ reply: slowReply, meetingId: null }) }, finish_reason: 'stop' }] });
      }
      const report = context.evidence.find(({ topic, status }) => topic === 'guenever-refuge' && status === 'reported');
      const tally = context.evidence.find(({ topic }) => topic === 'wedding-supplies');
      const reply = report ? reportReply : tally ? tallyReply : 'Tell me a little more so I know what you mean.';
      result = malformedReply ? { reply: counterfeit, meetingId: null, fabricatedField: true } : { reply, meetingId: null };
    } else if ('text' in context) {
      const intent = context.text === 'Look toward the chimney' ?
        { type: 'choice', choice: 'Tell Martin what Alice said about the Queen', words: null, actorId: null } :
        { type: 'speak', choice: null, words: context.text, actorId: 'martin' };
      result = { intents: [intent] };
    } else {
      result = { index: 0 };
    }
    send({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] });
  });

  let covel;
  try {
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const origin = 'http://127.0.0.1:' + fixture.address().port;
    const oldUrl = process.env.HINDSIGHT_URL;
    try {
      process.env.HINDSIGHT_URL = origin;
      covel = launchCovel({
        databasePath: join(directory, 'story.sqlite'), web: true, reportStalls: true,
        provider: { url: origin + '/v1/chat/completions', name: 'memory-fixture', key: 'fixture-key' },
      });
    } finally {
      if (oldUrl === undefined) delete process.env.HINDSIGHT_URL;
      else process.env.HINDSIGHT_URL = oldUrl;
    }
    const url = await covel.ready;
    const catalog = await (await request.get(url + '/api/plugins')).json();
    const excludedPlugins = catalog.items.filter(plugin => plugin.id !== 'harbinger').map(plugin => plugin.id);
    async function turn(sessionId, text) {
      const response = await request.post(url + '/api/actions', { data: {
        sessionId, requestId: randomUUID(), type: text ? 'submit_actions' : 'start_session',
        payload: text ? { actions: [{ kind: 'say', text }] } : {},
      } });
      expect(response.ok()).toBe(true);
      const stream = await response.text();
      expect(stream).toContain('"committed":true');
      expect(stream).not.toContain(counterfeit);
      const messages = await (await request.get(url + '/api/sessions/' + sessionId + '/messages')).json();
      return messages.items.filter(message => message.kind === 'story');
    }
    async function start() {
      const response = await request.post(url + '/api/sessions', {
        data: { worldId: 'bread-ledger', locale: 'en-US', plugins: ['harbinger'], excludedPlugins },
      });
      expect(response.ok()).toBe(true);
      const { id } = await response.json();
      expect(await turn(id)).toHaveLength(1);
      return id;
    }

    const session = await start();
    expect((await turn(session, words)).at(-1).content).toContain(tallyReply);
    await turn(session, 'Promise Alice discretion');
    const confidence = await turn(session, 'Ask Alice what brought Guenever to London');
    expect(confidence.at(-1).content).toContain('The carter saw Guenever at the Tower.');
    const inventedTransfer = await turn(session, 'Look toward the chimney');
    expect(inventedTransfer.at(-1).content).toContain('What would you like to say here?');
    expect((await turn(session, words)).at(-1).content).toContain(tallyReply);
    expect(JSON.stringify(actorPrompts.at(-1))).not.toMatch(/Tower|blue loaf|Dover/u);
    expect(banks.size).toBe(1);

    await turn(session, 'Tell Martin what Alice said about the Queen');
    const after = await turn(session, words);
    expect(after).toHaveLength(8);
    expect(after.at(-1).content).toContain(reportReply);
    expect(actorPrompts.at(-1).evidence).toContainEqual(expect.objectContaining({
      text: expect.stringContaining('The clerk says'), status: 'reported',
    }));
    await expect.poll(() => [...banks.values()].flatMap(rows => [...rows.values()]).join(' ')).toContain('The clerk says');

    malformedReply = true;
    const rejected = await turn(session, words);
    expect(rejected).toHaveLength(9);
    expect(rejected.at(-1).content).toContain('Put your question plainly');
    expect(JSON.stringify(actorPrompts)).not.toContain(counterfeit);

    malformedReply = false;
    const separate = await start();
    expect((await turn(separate, words)).at(-1).content).toContain(tallyReply);
    expect(JSON.stringify(actorPrompts.at(-1))).not.toContain('Tower');
    expect(banks.size).toBe(2);

    await turn(separate, 'I whisper to Alice, “' + hiddenAside + '”');
    expect(actorPrompts.at(-1).actor.id).toBe('alice');
    expect(actorPrompts.at(-1).words).toBe(hiddenAside);
    expect(JSON.stringify(actorPrompts.at(-1).evidence)).not.toMatch(/Tower|blue loaf|Dover/u);
    await turn(separate, words);
    expect(actorPrompts.at(-1).actor.id).toBe('martin');
    expect(JSON.stringify(actorPrompts.at(-1))).not.toContain(hiddenAside);
    expect(banks.size).toBe(3);

    const priorPrompts = actorPrompts.length;
    await turn(separate, 'I turn to Martin and silently wonder what Alice is hiding.');
    await turn(separate, 'I ask Martin to wait while I silently wonder what Alice is hiding.');
    expect(actorPrompts).toHaveLength(priorPrompts);
    const action = 'I ask Alice, “' + slowQuestion + '”';
    const slow = await turn(separate, action);
    expect(slow.filter(message => message.content.includes(slowReply))).toHaveLength(1);
    const capture = await request.post(url + '/api/sessions/' + separate + '/plugin-rpc', {
      data: { kind: 'action', pluginId: 'harbinger', action: 'capture-save' },
    });
    const state = (await capture.json()).result.data.state;
    expect(state.benchmarkStalls).toEqual([]);
    expect(state.benchmarkWaits).toContainEqual({
      operation: 'harbinger_actor_reply', thresholdMs: 3_150, durationMs: expect.any(Number), outcome: 'completed',
    });
    expect(state.benchmarkWaits.find(wait => wait.operation === 'harbinger_actor_reply').durationMs).toBeGreaterThanOrEqual(3_150);
    expect(storyPrompts).toEqual([]);
  } finally {
    await covel?.stop();
    await new Promise(resolve => { fixture.close(resolve); fixture.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
});
