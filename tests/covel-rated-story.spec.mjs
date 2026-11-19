import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');
test.use({ locale: 'en-US' });

const authoredOpening = 'A crier’s voice carries through the flour dust.';
const rejected = 'The marked draft must never appear.';
const authoredLanding = 'A carter folds a tarpaulin over the last sack.';
const nativeFallback = 'The scene settles into a quiet pause.';
const reportedBell = 'The ferryman reports a brass bell at the east pier.';
const recentTide = 'The tide reaches the next mooring post.';
const recall = 'The ferryman’s report placed the brass bell at the east pier.';
const thought = 'I should check the sacks before we leave.';
const privateLore = 'Mordred commissioned the letters that reported Arthur’s death.';

function streamNativeStory(response, { model }, name, text) {
  const args = JSON.stringify({ segments: [{ kind: 'narration', text }] });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => {
    response.write(`data: ${JSON.stringify({
      id: 'native-story-reply', object: 'chat.completion.chunk', created: 0, model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
  };
  chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'submit-story', type: 'function', function: { name, arguments: args.slice(0, 87) } }] });
  chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(87) } }] });
  chunk({}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

async function withRatedCovel(run, { memory = false, approvedNativeText, ratingDelay = 0, ratingReply, openRouterRating = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-rated-covel-'));
  const assessments = [];
  const observed = { memory: [], story: [], review: [], actor: [], native: [], rating: [] };
  const ratingModel = openRouterRating ? 'qwen/qwen3-14b' : 'fixture-rating';
  let nativeUnavailable = false;
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const submit = input.tools?.find(tool => tool.function?.name === 'submit-output');
    if (submit) {
      if (nativeUnavailable) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end('{"error":{"message":"Fixture storyteller is unavailable"}}');
        return;
      }
      observed.native.push(JSON.stringify(input.messages));
      const text = approvedNativeText ?? (memory ? (observed.native.length === 1 ? reportedBell : recentTide) : `${rejected} A lantern burns on the pier.`);
      streamNativeStory(response, input, submit.function.name, text);
      return;
    }
    const context = JSON.parse(input.messages.findLast(message => message.role === 'user').content);
    let result;
    if (input.model === ratingModel) {
      assessments.push(context);
      observed.rating.push({
        reasoning: input.reasoning, provider: input.provider, enableThinking: input.enable_thinking,
        effort: input.reasoning_effort, thinking: input.thinking,
      });
      if (ratingDelay) await delay(ratingDelay);
      result = ratingReply?.(assessments.length) ?? { approved: !JSON.stringify(context).includes(rejected) };
    } else if (input.model === 'fixture-memory') {
      observed.memory.push(context);
      result = { summary: recall };
    } else if ('candidate' in context) {
      observed.review.push(context);
      result = { hardFailures: [], editorial: null };
    } else if ('currentScene' in context) {
      observed.story.push(context);
      result = { prose: rejected };
    } else {
      observed.actor.push(context);
      result = { thought };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });

  let covel;
  let stopped;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
    const ratingEndpoint = openRouterRating ? `${endpoint}/router` : endpoint;
    const config = join(directory, 'llm.toml');
    await writeFile(config, `
[covel.story]
provider = "harbinger-startup"
model = "fixture-story"
baseUrl = "${endpoint}"
protocol = "openai-chat-v1"

[covel.harbinger-safety]
provider = "${openRouterRating ? 'openrouter' : 'harbinger-startup'}"
model = "${ratingModel}"
baseUrl = "${ratingEndpoint}"
protocol = "openai-chat-v1"
${openRouterRating ? 'reasoningEffort = "disabled"' : ''}
${memory ? `
[covel.harbinger-memory]
provider = "harbinger-startup"
model = "fixture-memory"
baseUrl = "${endpoint}"
protocol = "openai-chat-v1"
` : ''}
`);
    const environment = {
      COVEL_LLM_TOML: config,
      ...(openRouterRating && {
        HARBINGER_OPENROUTER_API_KEY: 'fixture-router-key',
        HARBINGER_OPENROUTER_BASE_URL: ratingEndpoint,
      }),
    };
    const original = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, environment);
      covel = launchCovel({
        databasePath: join(directory, 'story.sqlite'),
        provider: { url: `${endpoint}/chat/completions`, name: 'fixture-story', key: 'fixture-key' },
        web: true,
      });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    stopped = new Promise(resolve => covel.once('exit', resolve));
    const url = await new Promise((resolve, reject) => {
      covel.once('error', reject);
      covel.once('exit', code => reject(new Error(`Covel exited before starting (${code}).`)));
      covel.on('message', message => {
        if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
      });
    });
    await run(url, assessments, () => { nativeUnavailable = true; }, observed);
  } finally {
    if (covel && covel.exitCode === null && covel.signalCode === null) covel.kill();
    await stopped;
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
}

test('Bread Ledger saves its resolved move and Journal without dispatching another story draft', async ({ page, request }) => {
  test.setTimeout(60_000);
  await withRatedCovel(async (url, assessments, _disableProvider, observed) => {
    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(), entries: { 'ui.appearance': 'panel' },
      }));
    });
    const sessionResponse = await request.post(`${url}/api/sessions`, {
      data: {
        worldId: 'bread-ledger', locale: 'en-US', plugins: ['harbinger', 'harbinger-opening'],
        excludedPlugins: ['narrator', 'pregame', 'char-creator', 'guide', 'world-init', 'world-time', 'memory', 'codex', 'npc-graph', 'living-world-rules'],
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const { id } = await sessionResponse.json();
    const worldUpdate = await request.post(`${url}/api/worlds/bread-ledger/dimensions/import`, {
      data: { dimensions: { tone: { name: 'tone', schema: {}, initialValue: { genres: ['historical'], contentRating: 'all-ages' } } } },
    });
    expect(worldUpdate.ok()).toBeTruthy();
    await page.goto(`${url}/session?sid=${encodeURIComponent(id)}`);
    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(authoredOpening)).toBeVisible({ timeout: 20_000 });

    const composer = page.getByTestId('game-composer-input');
    await page.getByTestId('composer-mode-act').click();
    await composer.fill('Go with Alice to the river');
    await composer.press('Enter');
    await expect(page.getByText(authoredLanding)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText(authoredLanding)).toHaveCount(1);
    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    const journal = page.getByRole('tabpanel', { name: 'Journal', exact: true });
    await expect(journal.getByText('Seen at the landing', { exact: true })).toBeVisible();

    const history = await (await request.get(`${url}/api/sessions/${id}/messages`)).json();
    const passages = history.items.filter(message => message.kind === 'story');
    expect(passages).toHaveLength(2);
    expect(passages[0].content).toContain(authoredOpening);
    expect(passages[1].content).toContain(authoredLanding);
    for (const inaccessible of [rejected, privateLore, thought]) {
      expect(JSON.stringify(history)).not.toContain(inaccessible);
      await expect(journal.getByText(inaccessible)).toHaveCount(0);
    }
    expect(observed.story).toHaveLength(0);
    expect(observed.review).toHaveLength(0);
    expect(observed.native).toHaveLength(0);
    expect(assessments).toHaveLength(0);
  });
});

test('a native Covel story holds rejected drafts and continues when its story provider fails', async ({ request }) => {
  test.setTimeout(60_000);
  await withRatedCovel(async (url, assessments, disableProvider) => {
    const world = await request.post(`${url}/api/worlds`, {
      data: { name: 'Harbor Lights', description: 'A quiet harbor at nightfall.', locale: 'en-US' },
    });
    expect(world.ok()).toBeTruthy();
    const { id: worldId } = await world.json();
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const session = await request.post(`${url}/api/sessions`, {
      data: { worldId, locale: 'en-US', plugins: ['narrator'], excludedPlugins: catalog.items.map(plugin => plugin.id).filter(id => id !== 'narrator') },
    });
    expect(session.ok()).toBeTruthy();
    const { id: sessionId } = await session.json();

    const opening = await request.post(`${url}/api/actions`, {
      data: { sessionId, type: 'start_session', requestId: randomUUID(), payload: {} },
    });
    const openingStream = await opening.text();
    expect(openingStream).not.toContain(rejected);
    expect(openingStream).toContain(nativeFallback);
    expect(assessments.filter(check => check.rating === 'teen' && check.text.includes(rejected))).toHaveLength(1);

    disableProvider();
    const move = 'I look across the water.';
    const turn = await request.post(`${url}/api/actions`, {
      data: { sessionId, type: 'submit_actions', requestId: randomUUID(), payload: { actions: [{ kind: 'say', text: move }] } },
    });
    const turnStream = await turn.text();
    expect(turnStream).toContain('"committed":true');
    expect(turnStream).not.toContain(rejected);
    const messages = await (await request.get(`${url}/api/sessions/${sessionId}/messages`)).json();
    expect(messages.items.filter(message => message.kind === 'story').map(message => message.content)).toEqual([nativeFallback, nativeFallback]);
    expect(messages.items.filter(message => message.role === 'user').map(message => message.content)).toContain(move);
  });
});

test('a delayed rating approval keeps the native passage', async ({ request }) => {
  await withRatedCovel(async (url, assessments) => {
    const world = await request.post(`${url}/api/worlds`, {
      data: { name: 'Harbor at Noon', description: 'A quiet harbor at noon.', locale: 'en-US' },
    });
    expect(world.ok()).toBeTruthy();
    const { id: worldId } = await world.json();
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const session = await request.post(`${url}/api/sessions`, {
      data: { worldId, locale: 'en-US', plugins: ['narrator'], excludedPlugins: catalog.items.map(plugin => plugin.id).filter(id => id !== 'narrator') },
    });
    expect(session.ok()).toBeTruthy();
    const { id: sessionId } = await session.json();
    const opening = await request.post(`${url}/api/actions`, {
      data: { sessionId, type: 'start_session', requestId: randomUUID(), payload: {} },
    });
    const stream = await opening.text();
    expect(assessments).toContainEqual(expect.objectContaining({ text: expect.stringContaining(reportedBell) }));
    expect(stream).toContain('"committed":true');
    const messages = await (await request.get(`${url}/api/sessions/${sessionId}/messages`)).json();
    expect(messages.items.filter(message => message.kind === 'story').map(message => message.content)).toEqual([reportedBell]);
  }, { approvedNativeText: reportedBell, ratingDelay: 5500 });
});

test('a malformed native story rating gets one retry before accepting or falling back', async ({ request }) => {
  await withRatedCovel(async (url, assessments, _disableProvider, observed) => {
    const world = await request.post(`${url}/api/worlds`, {
      data: { name: 'Hearth at the Pier', description: 'A cold harbor in the morning.', locale: 'en-US' },
    });
    expect(world.ok()).toBeTruthy();
    const { id: worldId } = await world.json();
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const plugins = ['narrator'];
    const excludedPlugins = catalog.items.map(plugin => plugin.id).filter(id => !plugins.includes(id));
    async function start() {
      const session = await request.post(`${url}/api/sessions`, {
        data: { worldId, locale: 'en-US', plugins, excludedPlugins },
      });
      expect(session.ok()).toBeTruthy();
      const { id } = await session.json();
      const action = await request.post(`${url}/api/actions`, {
        data: { sessionId: id, type: 'start_session', requestId: randomUUID(), payload: {} },
      });
      expect(await action.text()).toContain('"committed":true');
      const messages = await (await request.get(`${url}/api/sessions/${id}/messages`)).json();
      const stories = messages.items.filter(message => message.kind === 'story');
      expect(stories).toHaveLength(1);
      return stories[0].content;
    }
    expect(await start()).toBe(reportedBell);
    expect(assessments).toHaveLength(2);
    expect(assessments[1]).toEqual(assessments[0]);
    expect(await start()).toBe(nativeFallback);
    expect(assessments).toHaveLength(4);
    for (const request of observed.rating) {
      expect(request).toEqual({
        reasoning: { enabled: false }, provider: { sort: 'latency', require_parameters: true },
        enableThinking: undefined, effort: undefined, thinking: undefined,
      });
    }
  }, { approvedNativeText: reportedBell, openRouterRating: true, ratingReply: attempt => ({ approved: attempt === 2 ? true : 'true' }) });
});

test('older public story stays useful in both engines without granting it to characters', async ({ page, request }) => {
  test.setTimeout(60_000);
  await withRatedCovel(async (url, _assessments, _disableProvider, observed) => {
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const nativeWorld = await request.post(`${url}/api/worlds`, {
      data: { name: 'Tides at Ember Pier', description: 'A quiet harbor at nightfall.', locale: 'en-US' },
    });
    expect(nativeWorld.ok()).toBeTruthy();
    const { id: nativeWorldId } = await nativeWorld.json();

    for (const [worldId, engine] of [[nativeWorldId, 'narrator'], ['bread-ledger', 'harbinger']]) {
      const session = await request.post(`${url}/api/sessions`, {
        data: { worldId, locale: 'en-US', plugins: [engine], excludedPlugins: catalog.items.map(plugin => plugin.id).filter(id => id !== engine) },
      });
      expect(session.ok()).toBeTruthy();
      const { id: sessionId } = await session.json();
      async function action(type, words) {
        const response = await request.post(`${url}/api/actions`, {
          data: { sessionId, type, requestId: randomUUID(), payload: words ? { actions: [{ kind: 'say', text: words }] } : {} },
        });
        expect(await response.text()).toContain('"committed":true');
      }
      const history = async () => (await (await request.get(`${url}/api/sessions/${sessionId}/messages`)).json()).items;
      await action('start_session');
      const first = (await history()).find(message => message.kind === 'story');
      const openingLine = engine === 'narrator' ? reportedBell : authoredOpening;
      expect(first.content).toContain(openingLine);
      for (let index = 0; index < 3; index++) await action('submit_actions', 'Look around');
      if (engine === 'narrator') {
        await expect.poll(() => observed.memory.find(input => input.passages?.some(passage => passage.turnId === first.turnId))).toBeDefined();
        const source = observed.memory.find(input => input.passages.some(passage => passage.turnId === first.turnId));
        expect(source.passages.find(passage => passage.turnId === first.turnId).text).toContain(reportedBell);
        expect(JSON.stringify(source)).not.toContain(recentTide);
        expect(JSON.stringify(source)).not.toContain(thought);
      }

      await page.goto(`${url}/session?sid=${encodeURIComponent(sessionId)}`);
      await page.reload();
      await action('submit_actions', 'Look around');
      if (engine === 'harbinger') {
        expect(observed.story).toHaveLength(0);
        expect((await history()).at(-1).content).not.toContain(recall);
      } else {
        const prompt = observed.native.at(-1);
        expect(prompt).toContain(recall);
        expect(prompt).toContain(first.turnId);
        expect(prompt).toContain(recentTide);
      }
      expect((await history()).find(message => message.id === first.id).content).toContain(openingLine);
    }
    expect(observed.actor.some(context => context.actor)).toBe(true);
    expect(JSON.stringify(observed.actor)).not.toContain(recall);
    expect(JSON.stringify(observed.actor)).not.toContain(privateLore);
  }, { memory: true });
});
