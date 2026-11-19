import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');
test.use({ locale: 'en-US' });

test('Character tiers route requests by latency and the next turn uses the updated setting', async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-route-'));
  const calls = [];
  const opening = 'A crier’s voice carries through the flour dust.';
  const question = 'Is the oven ready, Alice?';
  const spokenAnswer = 'You’ll have to leave that with me.';
  const reply = 'Alice says, “' + spokenAnswer + '”';
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/inworld/catalog') {
      response.end(JSON.stringify({ models: [{
        id: 'inworld/models/GLM-5.3-Flash', endpoints: ['/v1/chat/completions'],
        spec: { outputModalities: ['text'], supportedParameters: ['response_format'] },
        pricing: { promptToken: 0.0000005, completionToken: 0.000001 },
      }, {
        id: 'inworld/models/gemma-4-31b-it', endpoints: ['/v1/chat/completions'],
        spec: { outputModalities: ['text'], supportedParameters: ['response_format'] },
        pricing: { promptToken: 0.0000004, completionToken: 0.0000004 },
      }] }));
      return;
    }
    if (request.url === '/router/catalog') {
      response.end(JSON.stringify({ data: [{
        id: 'z-ai/glm-5.3-flash', architecture: { output_modalities: ['text'] },
        supported_parameters: ['response_format', 'reasoning'], pricing: { prompt: '0.0000002', completion: '0.0000002' },
      }, {
        id: 'google/gemma-4-31b-it', architecture: { output_modalities: ['text'] },
        supported_parameters: ['response_format'], pricing: { prompt: '0.0000002', completion: '0.0000002' },
      }] }));
      return;
    }
    try {
      const parts = [];
      for await (const part of request) parts.push(part);
      const input = JSON.parse(Buffer.concat(parts).toString());
      const context = JSON.parse(input.messages.findLast(message => message.role === 'user').content);
      const operation = 'candidate' in context ? 'review' : 'currentScene' in context ? 'story'
        : 'words' in context ? 'dialogue' : 'situation' in context ? 'thought' : 'state';
      calls.push({ path: request.url, model: input.model, authorization: request.headers.authorization,
        operation, format: input.response_format, provider: input.provider });
      let result = { index: 0 };
      if (context.text?.includes(question)) {
        result = { intents: [{ type: 'speak', choice: null, words: question, actorId: 'alice' }] };
      } else if (context.words === question) {
        result = { reply: spokenAnswer, meetingId: null };
      }
      const content = JSON.stringify(result);
      response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
    } catch {
      response.writeHead(400).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const fixture = `http://127.0.0.1:${server.address().port}`;
  const latencyPath = join(directory, 'provider-latency.json');
  await writeFile(latencyPath, JSON.stringify({ routes: [
    { provider: 'inworld', modelId: 'inworld/models/GLM-5.3-Flash', baseUrl: `${fixture}/inworld/v1`, p50Ms: 40, p95Ms: 62 },
    { provider: 'openrouter', modelId: 'z-ai/glm-5.3-flash', baseUrl: `${fixture}/router/v1`, p50Ms: 120, p95Ms: 145 },
    { provider: 'inworld', modelId: 'inworld/models/gemma-4-31b-it', baseUrl: `${fixture}/inworld/v1`, p50Ms: 80, p95Ms: 100 },
    { provider: 'openrouter', modelId: 'google/gemma-4-31b-it', baseUrl: `${fixture}/router/v1`, p50Ms: 45, p95Ms: 60 },
  ] }));
  const env = {
    HARBINGER_OPENAI_API_KEY: 'fixture-openai',
    HARBINGER_INWORLD_API_KEY: 'fixture-inworld',
    HARBINGER_OPENROUTER_API_KEY: 'fixture-router',
    HARBINGER_INWORLD_CATALOG_URL: `${fixture}/inworld/catalog`,
    HARBINGER_OPENROUTER_CATALOG_URL: `${fixture}/router/catalog`,
    HARBINGER_INWORLD_BASE_URL: `${fixture}/inworld/v1`,
    HARBINGER_OPENROUTER_BASE_URL: `${fixture}/router/v1`,
    HARBINGER_ROUTE_LATENCY_PATH: latencyPath,
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  let covel;
  try {
    Object.assign(process.env, env);
    covel = launchCovel({ databasePath: join(directory, 'story.sqlite'), web: true,
      provider: { url: `${fixture}/legacy/v1/chat/completions`, name: 'legacy-test', key: 'legacy-test-key' } });
    const url = await covel.ready;
    const quote = data => page.request.post(`${url}/api/harbinger/model-route`, { data });
    expect(await (await quote({ model: 'glm-5.3-flash' })).json()).toMatchObject({
      provider: 'inworld', latency: { p50Ms: 40, p95Ms: 62 },
    });
    const withReasoning = await quote({ model: 'glm-5.3-flash', requiredParameters: ['reasoning'] });
    expect(await withReasoning.json()).toMatchObject({ provider: 'openrouter' });
    expect((await quote({ model: 'glm-5.3-flash', requiredParameters: ['reasoning'], provider: 'inworld' })).status()).toBe(422);
    expect((await quote({ model: 'glm-5.3-flash', requiredParameters: ['unsupported'] })).status()).toBe(422);
    const direct = await quote({ model: 'openai/gpt-5.6-luna', provider: 'openrouter' });
    const directRoute = await direct.json();
    expect(directRoute).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-luna', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses-v1' });
    expect(JSON.stringify(directRoute)).not.toContain('fixture-openai');
    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(), entries: { 'ui.appearance': 'panel' },
      }));
    });
    await page.goto(url);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI roles', exact: true }).click();
    const storyTier = settings.getByRole('combobox', { name: 'Story tier' });
    const characterTier = settings.getByRole('combobox', { name: 'Character tier' });
    await storyTier.selectOption({ label: 'Balanced' }, { timeout: 4_000 });
    await expect(settings.getByText(/Story uses Inworld/u)).toBeVisible();
    await characterTier.selectOption({ label: 'High' });
    await expect(settings.getByText(/Character uses Inworld/u)).toBeVisible();
    await expect(storyTier).toHaveValue('balanced');
    await expect(characterTier).toHaveValue('high');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    expect(calls).toContainEqual(expect.objectContaining({
      path: '/inworld/v1/chat/completions', model: 'inworld/models/GLM-5.3-Flash',
      authorization: 'Basic fixture-inworld', operation: 'thought', format: expect.objectContaining({ type: 'json_object' }),
    }));
    expect(calls.some(call => call.operation === 'thought' && call.model === 'z-ai/glm-5.3-flash')).toBe(false);
    expect(calls.some(call => ['story', 'review'].includes(call.operation))).toBe(false);

    async function openRoles() {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('group', { name: 'Menu', exact: true }).getByRole('button', { name: /^Settings/u }).click();
      await settings.getByRole('button', { name: 'AI roles', exact: true }).click();
    }
    await openRoles();
    await characterTier.selectOption({ label: 'Moderate' });
    await expect(settings.getByText(/Character uses OpenRouter/u)).toBeVisible();
    await expect(characterTier).toHaveValue('moderate');
    await page.keyboard.press('Escape');

    const afterOpening = calls.length;
    const composer = page.getByTestId('game-composer-input');
    await page.getByTestId('composer-mode-act').click();
    await composer.fill(`I ask Alice, “${question}”`);
    await composer.press('Enter');
    await expect(page.getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    const laterCalls = calls.slice(afterOpening);
    expect(laterCalls).toContainEqual(expect.objectContaining({
      path: '/router/v1/chat/completions', model: 'google/gemma-4-31b-it',
      authorization: 'Bearer fixture-router', operation: 'dialogue', provider: { sort: 'latency', require_parameters: true },
    }));
    expect(laterCalls.some(call => ['story', 'review'].includes(call.operation))).toBe(false);
    const sessionId = new URL(page.url()).searchParams.get('sid');
    const history = await (await page.request.get(`${url}/api/sessions/${sessionId}/messages`)).json();
    const stories = history.items.filter(message => message.kind === 'story');
    expect(stories).toHaveLength(2);
    expect(stories[0].content).toContain(opening);
    expect(stories[1].content).toContain(reply);

    await openRoles();
    const characterRole = settings.getByRole('group', { name: 'character', exact: true });
    await characterRole.getByRole('combobox', { name: 'Provider', exact: true }).selectOption({ label: 'harbinger-startup' });
    await expect(characterTier).toHaveValue('custom');
    await expect(storyTier).toHaveValue('balanced');
    await settings.getByRole('button', { name: 'Use Previous lineup' }).click();
    await expect(settings.getByText('Previous lineup applied to Story, Character, and State.')).toBeVisible();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await covel?.stop();
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(directory, { force: true, recursive: true });
  }
});
