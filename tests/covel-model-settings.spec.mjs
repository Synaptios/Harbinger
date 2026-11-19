import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { storyModelProvider } from '../covel/model-settings.mjs';
import { requestStoryObject } from '../covel/narrator.mjs';

test('Harbinger preserves saved provider, model and reasoning choices from the previous Settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-model-settings-'));
  const path = join(directory, 'model-settings.json');
  const env = {
    HARBINGER_MODEL_URL: 'https://api.openai.com/v1/responses?token=private',
    HARBINGER_MODEL_NAME: 'gpt-6.2-sol',
    HARBINGER_MODEL_KEY: 'direct-api-key',
    HARBINGER_REASONING_EFFORT: 'medium',
    HARBINGER_OPENROUTER_API_KEY: 'router-api-key',
    HARBINGER_MODEL_SETTINGS_PATH: path,
  };
  try {
    expect(storyModelProvider(env)).toMatchObject({
      id: 'openai', url: env.HARBINGER_MODEL_URL, name: 'gpt-6.2-sol', key: 'direct-api-key',
    });
    const selection = { provider: 'openrouter', model: 'openai/gpt-6.2-sol', reasoningEffort: 'high' };
    await writeFile(path, JSON.stringify(selection));
    expect(storyModelProvider({ ...env })).toEqual({
      id: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions',
      name: 'openai/gpt-6.2-sol', key: 'router-api-key', reasoningEffort: 'high',
    });
    await writeFile(path, JSON.stringify({ provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: null }));
    expect(storyModelProvider(env)).toEqual({
      id: 'openai', url: 'https://api.openai.com/v1/responses',
      name: 'gpt-6.2-sol', key: 'direct-api-key', reasoningEffort: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Harbinger ignores invalid historical preferences and uses the startup endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-model-settings-'));
  const env = {
    HARBINGER_MODEL_URL: 'http://localhost:8080/chat/completions',
    HARBINGER_MODEL_NAME: 'local-model',
    HARBINGER_MODEL_KEY: 'local-api-key',
    HARBINGER_MODEL_SETTINGS_PATH: join(directory, 'model-settings.json'),
  };
  try {
    await writeFile(env.HARBINGER_MODEL_SETTINGS_PATH, JSON.stringify({
      provider: 'custom', model: 'local-model', reasoningEffort: null, url: 'https://different.example/completions',
    }));
    expect(storyModelProvider(env)).toMatchObject({ id: 'custom', url: env.HARBINGER_MODEL_URL, key: 'local-api-key' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Harbinger sends the selected OpenRouter effort in Chat Completions format', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    requests.push(JSON.parse(Buffer.concat(parts).toString()));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const provider = { id: 'openrouter', url: `http://127.0.0.1:${server.address().port}/chat/completions`, name: 'openai/gpt-6.2-sol' };
    const task = { instructions: 'Return a JSON object.', context: {} };
    expect(await requestStoryObject({ ...provider, reasoningEffort: 'high' }, task)).toEqual({ ok: true });
    expect(await requestStoryObject(provider, task)).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({ model: provider.name, reasoning: { effort: 'high' } });
    expect(requests[0]).not.toHaveProperty('reasoning_effort');
    expect(requests[1]).not.toHaveProperty('reasoning');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
