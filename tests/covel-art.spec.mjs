import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel suite with HARBINGER_TEST_COVEL=1.');

test('first-reveal art appears after the story commits and reuses stable identities', async ({ page }) => {
  test.setTimeout(55_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-art-'));
  const prompts = [];
  let finishArt;
  const waitForArt = new Promise(resolve => { finishArt = resolve; });
  const fixture = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.end('{"data":[]}');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/images/generations')) {
      prompts.push(body.prompt);
      await waitForArt;
      if (body.prompt.includes('"Alice"') && prompts.filter(prompt => prompt.includes('"Alice"')).length === 1) {
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      res.end(JSON.stringify({ data: [{
        b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5J8AAAAASUVORK5CYII=',
      }] }));
      return;
    }
    const view = JSON.parse(body.messages.at(-1).content);
    const value = view.candidate ? { hardFailures: [], editorial: null }
      : typeof view.text === 'string' ? { intents: [{ type: 'observe' }] }
        : { thought: 'I wait to see where the clerk will look.' };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  });
  let child;
  let closed;
  try {
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const baseUrl = `http://127.0.0.1:${fixture.address().port}/v1`;
    const config = join(directory, 'models.toml');
    await writeFile(config, [
      '[covel.story]', 'provider = "test-text"', 'model = "story"', `baseUrl = "${baseUrl}"`,
      'protocol = "openai-chat-v1"', '[covel.image]', 'provider = "openai"', 'model = "gpt-image-2.5-flare"',
      `baseUrl = "${baseUrl}"`, 'protocol = "openai-chat-v1"', 'tag = "image"',
    ].join('\n'));
    const saved = { COVEL_LLM_TOML: process.env.COVEL_LLM_TOML, HARBINGER_OPENAI_API_KEY: process.env.HARBINGER_OPENAI_API_KEY, TEST_TEXT_API_KEY: process.env.TEST_TEXT_API_KEY };
    Object.assign(process.env, { COVEL_LLM_TOML: config, HARBINGER_OPENAI_API_KEY: 'fixture-art', TEST_TEXT_API_KEY: 'fixture-text' });
    try {
      child = launchCovel({
        databasePath: join(directory, 'studio.sqlite'), web: true,
        provider: { url: `${baseUrl}/chat/completions`, name: 'story', key: 'fixture-text' },
      });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    closed = new Promise(resolve => child.once('exit', resolve));
    const url = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Covel exited while starting (${code}).`)));
      child.on('message', message => { if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`); });
    });
    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(),
        entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US' },
      }));
    });
    await page.goto(url);
    await page.getByRole('article').filter({ hasText: 'The Bread Ledger' })
      .getByRole('button', { name: 'Enter', exact: true }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(/A crier’s voice carries/)).toBeVisible();
    const composer = page.getByTestId('game-composer-input');
    await expect(composer).toBeEditable();
    try {
      await expect.poll(() => prompts.length, { timeout: 6_000 }).toBeGreaterThan(0);
    } catch (error) {
      const sessionId = new URL(page.url()).searchParams.get('sid');
      const jobs = await page.request.get(`${url}/api/sessions/${sessionId}/runtime-jobs`);
      const details = await jobs.text();
      throw new Error(`The image provider received no requests. Background jobs: ${details}`, { cause: error });
    }
    finishArt();
    await page.getByRole('tab', { name: 'Illustrations' }).click();
    const art = page.getByRole('tabpanel', { name: 'Illustrations' });
    await expect(art.getByRole('img', { name: /Bakehouse lane/ })).toBeVisible();
    await expect(art.getByRole('img', { name: 'Martin', exact: true })).toBeVisible();
    expect(prompts).toHaveLength(3);
    await art.getByRole('button', { name: 'Retry illustration for Alice' }).click();
    await expect(art.getByRole('img', { name: 'Alice', exact: true })).toBeVisible();
    expect(prompts).toHaveLength(4);
    await expect(art.getByRole('img', { name: 'Alice', exact: true })).toHaveJSProperty('naturalWidth', 1);
    await page.reload();
    await page.getByRole('tab', { name: 'Illustrations' }).click();
    await expect(art.getByRole('img', { name: 'Alice', exact: true })).toBeVisible();
    expect(prompts).toHaveLength(4);
    await page.getByRole('button', { name: 'Stage', exact: true }).click();
    const backdrop = page.getByTestId('stage-backdrop').locator('img[src^="blob:"]');
    await expect(backdrop).toHaveJSProperty('naturalWidth', 1);
    const sprites = page.getByTestId('stage-sprites');
    await expect(sprites.getByRole('img', { name: 'Alice', exact: true })).toHaveJSProperty('naturalWidth', 1);
  } finally {
    finishArt();
    if (child?.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
