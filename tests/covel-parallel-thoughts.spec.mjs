import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the native Covel suite with HARBINGER_TEST_COVEL=1.');

test('the cast chooses private thoughts in parallel and the public passage contains only the scene', async ({ request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-parallel-thoughts-'));
  const privateThoughts = {
    alice: 'I’ll count the cost after I know whose bread I can still bake. I still remember what the carter said. “The blue loaf wakes at low tide.”',
    martin: 'I can answer for what I’ve seen. I’ll keep a separate line for everything I’ve only heard.',
  };
  let thoughtGate = Promise.withResolvers();
  const thoughtActors = new Set();
  const storyPrompts = [];
  const fixture = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const envelope = JSON.parse(Buffer.concat(chunks));
    const context = JSON.parse(envelope.messages.findLast(message => message.role === 'user').content);
    let reply;
    if ('situation' in context) {
      thoughtActors.add(context.actor.id);
      await thoughtGate.promise;
      reply = { index: 1 };
    } else if ('candidate' in context) {
      reply = { hardFailures: [], editorial: null };
    } else {
      storyPrompts.push(context);
      reply = { prose: 'A detail the world never supplied.' };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }));
  });
  let covel;
  try {
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const origin = `http://127.0.0.1:${fixture.address().port}`;
    covel = launchCovel({ databasePath: join(directory, 'story.sqlite'), web: true,
      provider: { url: `${origin}/v1/chat/completions`, name: 'thought-overlap-fixture', key: 'fixture-key' } });
    const url = await covel.ready;
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const plugins = ['harbinger'];
    const excludedPlugins = catalog.items.map(plugin => plugin.id).filter(id => !plugins.includes(id));
    async function createSession() {
      const session = await request.post(`${url}/api/sessions`, {
        data: { worldId: 'bread-ledger', locale: 'en-US', plugins, excludedPlugins },
      });
      expect(session.ok()).toBe(true);
      return (await session.json()).id;
    }
    function startOpening(sessionId) {
      return request.post(`${url}/api/actions`, {
        data: { sessionId, requestId: randomUUID(), type: 'start_session', payload: {} },
        timeout: 9_000,
      });
    }
    async function verifySavedOpening(id, response) {
      expect(await response.text()).toContain('"committed":true');
      const history = await (await request.get(`${url}/api/sessions/${id}/messages`)).json();
      const story = history.items.filter(message => message.kind === 'story').map(message => message.content).join(' ');
      expect(story).toContain('Martin, the guild officer, rests the delivery book beside the scales.');
      for (const thought of Object.values(privateThoughts)) expect(story).not.toContain(thought);
      const testing = await request.post(`${url}/api/sessions/${id}/plugin-rpc`, {
        data: { kind: 'action', pluginId: 'harbinger', action: 'testing-view' },
      });
      return (await testing.json()).result.data.thoughts;
    }

    const id = await createSession();
    const openingWork = startOpening(id);
    let opening;
    try {
      await expect.poll(() => [...thoughtActors].sort(), { timeout: 4_000 }).toEqual(['alice', 'martin']);
    } finally {
      thoughtGate.resolve();
      opening = await openingWork;
    }
    expect(storyPrompts).toEqual([]);
    expect(await verifySavedOpening(id, opening)).toEqual(expect.arrayContaining(
      Object.entries(privateThoughts).map(([actorId, text]) => expect.objectContaining({ actorId, text, turn: 0 })),
    ));

    await test.step('a provider that never answers cannot hold the completed passage open', async () => {
      thoughtGate = Promise.withResolvers();
      const id = await createSession();
      const thoughts = await verifySavedOpening(id, await startOpening(id));
      expect(thoughts).toEqual(expect.arrayContaining([
        expect.objectContaining({ actorId: 'alice', text: expect.stringContaining('I can let them take the flour.'), turn: 0 }),
        expect.objectContaining({ actorId: 'martin', text: 'I need an account I can put my name to. A blank line is better than a false sum.', turn: 0 }),
      ]));
    });
  } finally {
    thoughtGate.resolve();
    await covel?.stop();
    await new Promise(resolve => { fixture.close(resolve); fixture.closeAllConnections(); });
    await rm(directory, { force: true, recursive: true });
  }
});
