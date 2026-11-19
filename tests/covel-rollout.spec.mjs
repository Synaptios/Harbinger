import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { adoptBreadLedgerMedia } from '../covel/rollout.mjs';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const openingLine = 'A crier’s voice carries through the flour dust.';
const rejectedLine = 'The marked draft should remain private.';

test('old Bread Ledger saves keep their settings and generate media from the next committed turn', async ({ page, request }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-rollout-'));
  const assessments = [];
  const images = [];
  const clips = [];
  const provider = createServer(async (incoming, response) => {
    if (incoming.method !== 'POST') return response.end('{"data":[]}');
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    if (incoming.url.endsWith('/images/generations')) {
      images.push(body);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5J8AAAAASUVORK5CYII=', 'base64');
      const bytes = Buffer.concat([png, Buffer.from(body.prompt)]);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
    }
    if (incoming.url.endsWith('/audio/speech')) {
      clips.push(body);
      const pcm = Buffer.alloc(16_000);
      Buffer.from(body.input).copy(pcm);
      const header = Buffer.from('52494646a43e000057415645666d74201000000001000100401f0000803e00000200100064617461803e0000', 'hex');
      return response.writeHead(200, { 'Content-Type': 'audio/wav' }).end(Buffer.concat([header, pcm]));
    }
    const context = JSON.parse(body.messages.findLast(message => message.role === 'user').content);
    let value;
    if (body.model === 'fixture-harbinger-safety') {
      assessments.push(context);
      value = { approved: !context.text.includes(rejectedLine) };
    } else if ('candidate' in context) {
      value = { hardFailures: [], editorial: null };
    } else if ('currentScene' in context) {
      value = { prose: rejectedLine };
    } else {
      value = { index: 0 };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
  });
  let covel;
  let stopped;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
    const config = join(directory, 'models.toml');
    const slots = [
      ['story', 'fixture-story'], ['harbinger-safety', 'fixture-harbinger-safety'],
      ['image', 'gpt-image-2.5-flare', 'tag = "image"\noutput = ["image"]'],
      ['speech', 'fixture-speech', 'tag = "speech"\noutput = ["audio"]'],
    ];
    await writeFile(config, slots.map(([role, model, modality = '']) =>
      `[covel.${role}]\nprovider = "harbinger-startup"\nmodel = "${model}"\nbaseUrl = "${baseUrl}"\nprotocol = "openai-chat-v1"\n${modality}\n`,
    ).join('\n'));
    const previousConfig = process.env.COVEL_LLM_TOML;
    try {
      process.env.COVEL_LLM_TOML = config;
      covel = launchCovel({
        databasePath: join(directory, 'story.sqlite'),
        provider: { url: `${baseUrl}/chat/completions`, name: 'fixture-story', key: 'fixture-key' },
        web: true,
      });
    } finally {
      if (previousConfig === undefined) delete process.env.COVEL_LLM_TOML;
      else process.env.COVEL_LLM_TOML = previousConfig;
    }
    stopped = once(covel, 'exit');
    const url = await new Promise((resolve, reject) => {
      covel.once('error', reject);
      covel.once('exit', code => reject(new Error(`Covel stopped before start (${code}).`)));
      covel.on('message', message => {
        if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
      });
    });
    const endpoint = `${url}/api/sessions`;
    const create = async (worldId, plugins, excludedPlugins = []) => {
      const result = await request.post(endpoint, { data: { worldId, plugins, excludedPlugins, locale: 'en-US' } });
      expect(result.status()).toBe(201);
      return result.json();
    };
    const media = ['harbinger-art', 'harbinger-voice'];
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const unrelated = catalog.items.map(({ id }) => id).filter(id => id !== 'harbinger' && !media.includes(id));
    const before = await create('bread-ledger', ['harbinger'], unrelated);
    const optedOut = await create('bread-ledger', ['harbinger'], [...unrelated, 'harbinger-art']);
    const outside = await create(undefined, ['narrator']);
    for (const plugin of media) expect(before.activePlugins).not.toContain(plugin);
    const rating = await request.post(`${url}/api/worlds/bread-ledger/dimensions/import`, {
      data: { dimensions: { tone: { name: 'tone', schema: {}, initialValue: { genres: ['historical'], contentRating: 'all-ages' } } } },
    });
    expect(rating.ok()).toBeTruthy();
    const bindings = { 'harbinger/story': 'slot-story' };
    const patched = await request.patch(`${endpoint}/${before.id}`, { data: { runtimeModelOverrides: bindings } });
    expect(patched.ok()).toBeTruthy();
    const opening = await request.post(`${url}/api/actions`, {
      data: { sessionId: before.id, type: 'start_session', requestId: randomUUID(), payload: {} },
    });
    expect(await opening.text()).toContain('"committed":true');
    const snapshot = async id => ({
      session: await (await request.get(`${endpoint}/${id}`)).json(),
      messages: await (await request.get(`${endpoint}/${id}/messages`)).json(),
    });
    const saved = await snapshot(before.id);
    expect(saved.messages.items.some(({ kind }) => kind === 'story')).toBeTruthy();
    expect(saved.session.runtimeModelOverrides).toEqual(bindings);
    expect(images).toHaveLength(0);
    expect(clips).toHaveLength(0);

    const adoption = await adoptBreadLedgerMedia(url);
    expect(adoption.failed).toEqual([]);
    expect(adoption.updated).toEqual(expect.arrayContaining([
      { sessionId: before.id, enabled: media },
      { sessionId: optedOut.id, enabled: ['harbinger-voice'] },
    ]));
    const after = await snapshot(before.id);
    expect(after.session.activePlugins).toEqual(expect.arrayContaining([...saved.session.activePlugins, ...media]));
    expect(after.session.runtimeModelOverrides).toEqual(saved.session.runtimeModelOverrides);
    expect(after.messages).toEqual(saved.messages);
    const preference = (await snapshot(optedOut.id)).session;
    expect(preference.metadata.pluginSelection.excluded).toContain('harbinger-art');
    expect(preference.activePlugins).not.toContain('harbinger-art');
    expect(preference.activePlugins).toContain('harbinger-voice');
    expect((await snapshot(outside.id)).session.activePlugins).toEqual(outside.activePlugins);
    expect(await adoptBreadLedgerMedia(url)).toEqual({ updated: [], failed: [] });

    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(),
        entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US' },
      }));
    });
    await page.goto(`${url}/session?sid=${encodeURIComponent(before.id)}`);
    await expect(page.getByText(openingLine, { exact: false })).toBeVisible();
    const composer = page.getByTestId('game-composer-input');
    await page.getByTestId('composer-mode-act').click();
    await composer.fill('Go with Alice to the river');
    await composer.press('Enter');
    await expect(page.getByText(/A carter folds a tarpaulin/u)).toBeVisible();
    await expect(composer).toBeEditable();
    expect(assessments).toEqual([]);
    await expect(page.getByText(rejectedLine, { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Illustrations', exact: true }).click();
    const art = page.getByRole('tabpanel', { name: 'Illustrations', exact: true });
    await expect(art.getByRole('img', { name: /Thames landing/u })).toHaveJSProperty('naturalWidth', 1);
    await expect(art.getByRole('img', { name: 'Alice', exact: true })).toHaveJSProperty('naturalWidth', 1);

    await page.getByRole('tab', { name: 'Narration', exact: true }).click();
    const narration = page.getByRole('tabpanel', { name: 'Narration', exact: true });
    await expect(narration.getByRole('button', { name: 'Replay passage 1' })).toBeEnabled();
    expect(clips).toContainEqual(expect.objectContaining({ input: 'Six sacks,', voice: 'Ashley' }));
    expect(clips.every(({ input }) => !input.includes(rejectedLine))).toBe(true);
    expect(images.every(({ prompt }) => !prompt.includes(rejectedLine))).toBe(true);
    const resumed = await snapshot(before.id);
    expect(resumed.messages.items.filter(({ kind }) => kind === 'story')).toHaveLength(2);
  } finally {
    if (covel && covel.exitCode === null) covel.kill();
    if (stopped) await stopped;
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
