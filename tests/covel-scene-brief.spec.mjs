import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the native Covel suite with HARBINGER_TEST_COVEL=1.');

test('the saved story preserves the order and attribution of a private conversation', async ({ request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-scene-brief-'));
  const promise = 'Promise Alice discretion';
  const disclosure = 'Ask Alice what brought Guenever to London';
  const confidence = 'Between the two of us, then.';
  const report = 'The carter saw Guenever at the Tower.';
  const provider = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const context = JSON.parse(body.messages.findLast(message => message.role === 'user').content);
    const result = 'text' in context
      ? { intents: [promise, disclosure].map(choice => ({ type: 'choice', choice, words: null, actorId: null })) }
      : { index: 0 };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const origin = `http://127.0.0.1:${provider.address().port}`;
  let covel;
  let stopped;
  try {
    covel = launchCovel({ databasePath: join(directory, 'story.sqlite'), web: true,
      provider: { url: `${origin}/v1/chat/completions`, name: 'scene-brief-fixture', key: 'test-key' } });
    stopped = once(covel, 'exit');
    const url = await new Promise((resolve, reject) => {
      covel.once('error', reject);
      covel.once('exit', code => reject(new Error(`Covel exited (${code})`)));
      covel.on('message', message => {
        if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
      });
    });
    const plugins = ['harbinger'];
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const excludedPlugins = catalog.items.map(plugin => plugin.id).filter(id => !plugins.includes(id));
    async function turn(sessionId, text) {
      const response = await request.post(`${url}/api/actions`, { data: { sessionId, requestId: randomUUID(),
        type: text ? 'submit_actions' : 'start_session', payload: text ? { actions: [{ kind: 'say', text }] } : {} } });
      expect(await response.text()).toContain('"committed":true');
      const { items } = await (await request.get(`${url}/api/sessions/${sessionId}/messages`)).json();
      return items.filter(message => message.kind === 'story');
    }
    async function start() {
      const response = await request.post(`${url}/api/sessions`, {
        data: { worldId: 'bread-ledger', locale: 'en-US', plugins, excludedPlugins },
      });
      expect(response.ok()).toBe(true);
      const { id } = await response.json();
      await turn(id);
      return id;
    }

    const promiseOnly = await turn(await start(), promise);
    expect(promiseOnly).toHaveLength(2);
    expect(promiseOnly[1].content).toContain(confidence);
    expect(promiseOnly[1].content).not.toContain(report);

    const sessionId = await start();
    const compound = await turn(sessionId, `${promise}, then ${disclosure}`);
    expect(compound).toHaveLength(2);
    const passage = compound[1].content;
    expect(passage).toContain(confidence);
    expect(passage).toContain(report);
    expect(passage.indexOf(confidence)).toBeLessThan(passage.indexOf(report));
    expect(passage).not.toMatch(/ledger|inspection/u);

    const { items } = await (await request.get(`${url}/api/sessions/${sessionId}/plugin-data/harbinger`)).json();
    const currentPassage = items.find(item => item.namespace === 'passages' && item.value.sequence === 1).value;
    const view = items.find(item => item.namespace === 'story' && item.key === 'view').value;
    expect(view.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining(confidence), status: 'firsthand', passageId: currentPassage.id }),
      expect.objectContaining({ text: expect.stringContaining(report), source: 'Alice', status: 'reported', passageId: currentPassage.id }),
    ]));
  } finally {
    if (covel && covel.exitCode === null && covel.signalCode === null) covel.kill();
    await stopped;
    await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
});
