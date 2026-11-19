import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel suite with HARBINGER_TEST_COVEL=1.');

test('a staged Voyage lineup boots the approved defaults and preserves Previous lineup', async ({ request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-profile-'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const models = ['inworld/models/GLM-5.3-Flash', 'inworld/models/gemma-4-31b-it', 'google-ai-studio/gemini-3-flash-preview'];
    res.end(JSON.stringify(req.url === '/inworld' ? { models: models.map(id => ({
      id, endpoints: ['/v1/chat/completions'], spec: { outputModalities: ['text'], supportedParameters: ['response_format'] },
      pricing: { promptToken: 0.0000001, completionToken: 0.0000005 },
    })) } : { data: ['mistralai/mistral-nemo', 'qwen/qwen3-14b'].map(id => ({
      id, architecture: { output_modalities: ['text'] }, supported_parameters: ['response_format'],
      pricing: { prompt: '0.0000001', completion: '0.0000003' },
    })) }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const database = join(directory, 'story.sqlite');
  const candidate = join(directory, 'candidate.toml');
  const environment = {
    HARBINGER_OPENAI_API_KEY: 'fixture-openai', HARBINGER_INWORLD_API_KEY: 'fixture-inworld',
    HARBINGER_OPENROUTER_API_KEY: 'fixture-router', HARBINGER_MODEL_NAME: 'previous-model',
    HARBINGER_MODEL_URL: `${origin}/v1/chat/completions`, HARBINGER_MODEL_KEY: 'fixture-previous',
    HARBINGER_INWORLD_CATALOG_URL: `${origin}/inworld`, HARBINGER_OPENROUTER_CATALOG_URL: `${origin}/router`,
  };
  const original = Object.fromEntries([...Object.keys(environment), 'COVEL_LLM_TOML'].map(key => [key, process.env[key]]));
  let covel;
  try {
    await promisify(execFile)(process.execPath, ['scripts/covel-stage-voyage.mjs', database, candidate], { env: { ...process.env, ...environment } });
    Object.assign(process.env, environment, { COVEL_LLM_TOML: candidate });
    covel = launchCovel({ databasePath: database, web: true,
      provider: { url: environment.HARBINGER_MODEL_URL, name: environment.HARBINGER_MODEL_NAME, key: environment.HARBINGER_MODEL_KEY } });
    const url = await covel.ready;
    const { slots } = await (await request.get(`${url}/api/llm-config`)).json();
    expect(slots).toMatchObject({
      story: { provider: 'inworld', model: 'inworld/models/GLM-5.3-Flash' },
      character: { provider: 'inworld', model: 'inworld/models/GLM-5.3-Flash' },
      state: { provider: 'inworld', model: 'inworld/models/gemma-4-31b-it' },
      'previous-lineup': { model: 'previous-model' },
      'harbinger-memory': { model: 'mistralai/mistral-nemo' },
      'harbinger-safety': { model: 'qwen/qwen3-14b' },
      image: { model: 'gpt-image-2.5-flare' }, speech: { model: 'inworld-tts-2' },
    });
    expect(JSON.stringify(slots)).not.toContain('fixture-inworld');
    expect(slots.fast.parameterOverrides?.reasoningEffort).toBeUndefined();
    expect(slots['harbinger-memory'].parameterOverrides?.reasoningEffort).toBeUndefined();
    expect(slots['harbinger-safety'].parameterOverrides?.reasoningEffort).toBe('disabled');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await covel?.stop();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(directory, { force: true, recursive: true });
  }
});
