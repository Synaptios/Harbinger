import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

async function withStudio(run, {
  provider = { url: 'http://127.0.0.1:1/v1/chat/completions', name: 'fixture' },
  modelConfig,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-studio-'));
  let child;
  let closed;
  try {
    const priorConfig = process.env.COVEL_LLM_TOML;
    const priorKey = process.env.HARBINGER_OPENAI_API_KEY;
    if (modelConfig) {
      const path = join(directory, 'models.toml');
      await writeFile(path, modelConfig);
      process.env.COVEL_LLM_TOML = path;
      process.env.HARBINGER_OPENAI_API_KEY = 'studio-fixture-openai-key';
    }
    try {
      child = launchCovel({ databasePath: join(directory, 'story.sqlite'), provider, port: 0, web: true });
    } finally {
      if (priorConfig === undefined) delete process.env.COVEL_LLM_TOML;
      else process.env.COVEL_LLM_TOML = priorConfig;
      if (priorKey === undefined) delete process.env.HARBINGER_OPENAI_API_KEY;
      else process.env.HARBINGER_OPENAI_API_KEY = priorKey;
    }
    closed = new Promise(resolve => child.once('exit', resolve));
    const url = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Covel exited before starting (${code}).`)));
      child.on('message', message => {
        if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
      });
    });
    await run(url);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  }
}

test('Studio has a native narrator alongside the Bread Ledger narrator', async ({ request }) => {
  await withStudio(async (url) => {
    for (const id of ['narrator', 'harbinger']) {
      const reply = await request.get(`${url}/api/plugins/${id}`);
      expect(reply.ok(), id).toBe(true);
      expect(await reply.json()).toMatchObject({ id, source: 'builtin' });
    }
    const config = await (await request.get(`${url}/api/llm-config`)).json();
    expect(config.slots.planning).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai-responses-v1',
    });
  });
});

const originalLore = 'A bell above the harbour keeps a record of each incoming tide.';
const revisedLore = 'A red rope rings the harbour bell when the tide changes.';
const visibleCast = ['Betty', 'Hugh', 'Ada', 'Lina', 'Inez'];
const hiddenActor = 'Secret courier';
const nativePassage = `At the Harbour Bell, ${visibleCast.join(', ')} pause when the dock keeper puts one hand on the red bell rope.`;
const dialogue = 'Keep back from the bell rope.';
const rejected = 'The marked draft at the sealed pier must never appear.';
const rejectedAction = 'I look for the sealed pier.';
const fallback = 'The scene settles into a quiet pause.';
const castRecords = [...visibleCast, hiddenActor].map((name, index) =>
  `  - { schemaVersion: 1, id: harbour-cast-${index}, name: ${name}, role: npc, description: Disclosed only by the story. }`).join('\n');
const hooks = `1. Find the keeper outside the bell tower.
2. Read the outgoing tide in the old register.
3. Ask a ferryman why the rope was replaced.`;
const newWorld = `===WORLD_YAML===
id: harbour-bell
name: The Harbour Bell
summary: A harbour town listens for the changing tide.
defaultLocale: en-US
===WORLD_MD===
# The Harbour Bell

${originalLore}

${hooks}
===WORLD_PACKAGE_YAML===
dimensions:
  tone:
    name: tone
    schema: {}
    initialValue:
      genres: [mystery]
      contentRating: mature
characters:
${castRecords}
===END===`;

function studioProvider() {
  const received = [];
  const imageRequests = [];
  const speechRequests = [];
  const assessments = [];
  let finishMedia;
  const mediaRelease = new Promise(resolve => { finishMedia = resolve; });
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"data":[]}');
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url.endsWith('/images/generations')) {
      imageRequests.push(body);
      await mediaRelease;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5J8AAAAASUVORK5CYII=', 'base64');
      const bytes = Buffer.concat([png, Buffer.from(body.prompt)]);
      response.end(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
      return;
    }
    if (request.url.endsWith('/audio/speech')) {
      speechRequests.push(body);
      await mediaRelease;
      const pcm = Buffer.alloc(16_000);
      Buffer.from(body.input).copy(pcm);
      const waveHeader = Buffer.from('52494646a43e000057415645666d74201000000001000100401f0000803e00000200100064617461803e0000', 'hex');
      response.writeHead(200, { 'Content-Type': 'audio/wav' }).end(Buffer.concat([waveHeader, pcm]));
      return;
    }
    if (body.model === 'fixture-harbinger-safety') {
      const assessment = JSON.parse(body.messages.findLast(message => message.role === 'user').content);
      assessments.push(assessment);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{
        message: { content: JSON.stringify({ approved: !assessment.text.includes(rejected) }) },
        finish_reason: 'stop',
      }] }));
      return;
    }
    const story = body.tools?.some(tool => tool.function?.name === 'submit-output');
    received.push({ model: body.model, story: Boolean(story), key: request.headers.authorization });
    const revision = body.messages.some(message =>
      JSON.stringify(message.content).includes('Give the harbour bell a red rope.'));
    const text = revision
      ? `===WORLD_YAML===\nUNCHANGED\n===WORLD_MD===\n# The Harbour Bell\n\n${revisedLore}\n\n${hooks}\n===WORLD_PACKAGE_YAML===\nUNCHANGED\n===END===`
      : newWorld;
    const reject = story && body.messages.findLast(message => message.role === 'user')?.content.includes(rejectedAction);
    const submission = reject ? {
      segments: [{ kind: 'narration', text: rejected }],
      cues: { scene: 'Sealed pier', present: [hiddenActor] },
      yield: 'user',
    } : {
      segments: [{ kind: 'narration', text: nativePassage }, { kind: 'dialogue', speaker: 'Betty', text: dialogue }],
      cues: { scene: 'Harbour Bell', present: [...visibleCast, hiddenActor] },
      yield: 'user',
    };
    const delta = story ? {
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'story-submit',
        type: 'function',
        function: { name: 'submit-output', arguments: JSON.stringify(submission) },
      }],
    } : { role: 'assistant', content: text };
    const event = (value, finish_reason) => {
      const chunk = { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason }] };
      return `data: ${JSON.stringify(chunk)}\n\n`;
    };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(event(delta, null) + event({}, story ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
  });
  return { server, received, imageRequests, speechRequests, assessments, finishMedia };
}

test('Studio creates and revises a world with rated native play, art, and cast audio', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { server, received, imageRequests, speechRequests, assessments, finishMedia } = studioProvider();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  function slot(id, model) {
    return `[covel.${id}]\nprovider = "openai"\nmodel = "${model}"\nbaseUrl = "${baseUrl}"\nprotocol = "openai-chat-v1"\n`;
  }
  try {
    await withStudio(async (url) => {
      const override = Buffer.from(JSON.stringify({ slotBindings: { planning: { presetId: 'alternate' } } })).toString('base64');
      await page.route('**/api/ai/*-world', route => route.continue({
        headers: { ...route.request().headers(), 'x-slot-config': override },
      }));
      await page.addInitScript(() => {
        if (window !== window.top || localStorage.getItem('covel:settings')) return;
        localStorage.setItem('covel:settings', JSON.stringify({
          schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(),
          entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US' },
        }));
      });
      await page.goto(`${url}/session`);
      await page.getByRole('button', { name: /AI Create World/i }).first().click({ timeout: 5_000 });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /^Story Only/i }).click();
      for (const label of ['World Lorebook', 'World Rules', 'Opening Kit']) {
        await dialog.getByRole('button', { name: new RegExp('^' + label, 'i'), pressed: true }).click({ timeout: 5_000 });
      }
      for (const label of ['Character Profiles', 'Story Memory Topics']) {
        const supplement = dialog.getByRole('button', { name: new RegExp('^' + label, 'i'), pressed: true });
        if (await supplement.count()) await supplement.click();
      }
      await dialog.getByLabel('Core Direction').fill('A mystery about a harbour bell.');
      await dialog.getByRole('button', { name: 'Start Building' }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      const world = page.getByRole('article').filter({ hasText: 'The Harbour Bell' });
      await expect(world).toBeVisible();
      await world.getByRole('button', { name: 'View Details' }).click();
      const revision = page.getByRole('region', { name: 'Revise this world' });
      await expect(revision).toBeVisible();
      const readWorld = async () => (await request.get(`${url}/api/worlds/harbour-bell`)).json();
      expect((await readWorld()).lore).toContain(originalLore);
      await revision.getByRole('textbox', { name: 'What to change' }).fill('Give the harbour bell a red rope.');
      await revision.getByRole('button', { name: 'Apply the change' }).click();
      await expect(revision.getByText('The change is applied.')).toBeVisible({ timeout: 10_000 });
      const record = await readWorld();
      expect(record.lore).toContain(revisedLore);
      expect(record.dimensions.tone.initialValue.contentRating).toBe('mature');
      expect(received.length).toBeGreaterThanOrEqual(2);
      expect(new Set(received.map(item => item.model))).toEqual(new Set(['gpt-5.6-luna']));
      expect(new Set(received.map(item => item.key))).toEqual(new Set(['Bearer studio-fixture-openai-key']));

      await page.goto(`${url}/session`);
      await world.getByRole('button', { name: 'Enter', exact: true }).click();
      await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
      const composer = page.getByTestId('game-composer-input');
      await expect(composer).toBeEditable({ timeout: 10_000 });
      const rejectedTurn = page.waitForResponse(response => response.url() === `${url}/api/actions` &&
        response.request().method() === 'POST');
      await composer.fill(rejectedAction);
      await composer.press('Enter');
      await expect(page.getByText(fallback, { exact: true })).toBeVisible();
      expect(await (await rejectedTurn).text()).not.toContain(rejected);
      expect(assessments).toContainEqual({ rating: 'mature', text: expect.stringContaining(rejected) });
      await expect(page.getByText(rejected, { exact: true })).toHaveCount(0);

      await composer.fill('I look at the harbour bell.');
      await composer.press('Enter');
      await expect(page.getByText(nativePassage, { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(dialogue, { exact: true })).toBeVisible();
      expect(received.some(item => item.story && item.model === 'fixture-story')).toBe(true);
      expect(assessments.some(({ rating, text }) => rating === 'mature' &&
        text.includes(nativePassage) && text.includes(dialogue))).toBe(true);
      await expect(composer).toBeEditable();
      finishMedia();
      const narration = page.getByRole('tabpanel', { name: 'Narration', exact: true });
      await page.getByRole('tab', { name: 'Narration', exact: true }).click();
      await expect.poll(() => speechRequests.some(({ input, voice }) =>
        input === dialogue && Boolean(voice) && voice !== 'Dennis')).toBe(true);
      expect(speechRequests).toContainEqual(expect.objectContaining({ model: 'fixture-speech', input: nativePassage, voice: 'Dennis' }));
      expect(speechRequests.map(({ input }) => input).join(' ')).not.toContain(rejected);
      await expect(narration.getByText(/Passage \d+ · 2 clips/u)).toBeVisible();
      await narration.getByRole('button', { name: /Replay passage/ }).last().click();
      await expect(narration.getByText('Betty · Clip 2 of 2', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Illustrations' }).click();
      const illustrations = page.getByRole('tabpanel', { name: 'Illustrations' });
      await expect(illustrations.getByRole('img', { name: 'Harbour Bell', exact: true })).toHaveJSProperty('naturalWidth', 1);
      for (const name of visibleCast) {
        await expect(illustrations.getByRole('img', { name, exact: true })).toHaveJSProperty('naturalWidth', 1);
      }
      expect(imageRequests).toHaveLength(1 + visibleCast.length);
      expect(imageRequests.every(({ model, quality }) => model === 'gpt-image-2.5-flare' && quality === 'low')).toBe(true);
      expect(imageRequests.map(({ prompt }) => prompt).join(' ')).not.toContain(hiddenActor);
      expect(imageRequests.map(({ prompt }) => prompt).join(' ')).not.toContain('Sealed pier');

      await composer.fill('I walk around the same harbour bell.');
      await composer.press('Enter');
      await expect(page.getByText(nativePassage, { exact: true })).toHaveCount(2);
      await expect(composer).toBeEditable();
      const sessionId = new URL(page.url()).searchParams.get('sid');
      await expect.poll(async () => {
        const result = await request.get(url + '/api/sessions/' + sessionId + '/runtime-jobs');
        const data = await result.json();
        return (Array.isArray(data) ? data : data.items ?? []).some(job =>
          job.pluginId === 'harbinger-art' && ['queued', 'running'].includes(job.status));
      }).toBe(false);
      expect(imageRequests).toHaveLength(1 + visibleCast.length);
      await page.getByRole('button', { name: 'Stage', exact: true }).click();
      await expect(page.getByTestId('stage-backdrop').locator('img[src^="blob:"]')).toHaveJSProperty('naturalWidth', 1);
      await expect(page.getByTestId('stage-sprites').getByRole('img', { name: 'Betty', exact: true })).toHaveJSProperty('naturalWidth', 1);
    }, {
      provider: { url: `${baseUrl}/chat/completions`, name: 'fixture-story' },
      modelConfig: [
        slot('story', 'fixture-story'),
        slot('planning', 'gpt-5.6-luna'),
        slot('alternate', 'override-story'),
        slot('harbinger-safety', 'fixture-harbinger-safety'),
        slot('image', 'gpt-image-2.5-flare') + 'tag = "image"\n',
        slot('speech', 'fixture-speech') + 'tag = "speech"\noutput = ["audio"]\n',
      ].join('\n'),
    });
  } finally {
    finishMedia();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
