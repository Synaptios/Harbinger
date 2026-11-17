import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const OPENAI = 'openai';
const OPENROUTER = 'openrouter';
const MODELS = [
  {
    id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', provider: OPENAI,
    description: 'Default game master for natural dialogue and distinct voices.',
    effort: 'low',
  },
  {
    id: 'google/gemini-4-argon', label: 'Gemini 4 Argon', provider: OPENROUTER,
    description: 'Creative-writing comparison for narration and worldbuilding.',
    effort: 'low',
  },
  {
    id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', provider: OPENROUTER,
    description: 'Alternative game master for dialogue and action resolution.',
    effort: 'low',
  },
  {
    id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: OPENAI,
    description: 'Low-cost baseline for action resolution and narration.',
    effort: 'low',
  },
];

const DEMO = {
  id: 'demo', label: 'Offline demo', provider: 'demo', available: true,
  description: 'Play the opening with a scripted game master.',
};

const ENDPOINTS = {
  [OPENAI]: 'https://api.openai.com/v1/responses',
  [OPENROUTER]: 'https://openrouter.ai/api/v1/chat/completions',
};

const PROVIDER_LABELS = { [OPENAI]: 'OpenAI', [OPENROUTER]: 'OpenRouter' };
const TIMEOUT_MS = 55_000;
const MAX_OUTPUT_TOKENS = 4_096;

function error(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function readCredentials(file) {
  if (!file) return {};
  let source;
  try {
    source = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  } catch {
    throw new Error('Could not read CREDENTIALS_FILE. Check that the server can access the file.');
  }

  try {
    const credentials = source.startsWith('{') ? JSON.parse(source) : parseEnv(source);
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      throw new Error();
    }
    return credentials;
  } catch {
    throw new Error('CREDENTIALS_FILE must contain JSON key/value pairs or dotenv assignments.');
  }
}

function setting(env, file, name, alias = name) {
  const value = env[name] ?? env[alias] ?? file[name] ?? file[alias]
    ?? file[name.toLowerCase()] ?? file[alias.toLowerCase()];
  return typeof value === 'string' ? value.trim() : '';
}

function configuredModel(id, provider) {
  if (!id) return null;
  if (provider === OPENAI && !/^(?:gpt-[a-z0-9]|o[1-9])[a-z0-9.-]*$/.test(id)) {
    throw new Error('OPENAI_MODEL must be a direct OpenAI text model ID.');
  }
  if (provider === OPENROUTER) {
    const publisher = id.split('/')[0];
    if (!/^[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(?::[a-z0-9-]+)?$/.test(id)
      || publisher === 'openai' || publisher === 'openrouter') {
      throw new Error('OPENROUTER_MODEL must identify a non-OpenAI model by publisher and model ID.');
    }
  }

  return MODELS.find(model => model.id === id) ?? {
    id, label: id, provider, description: 'Model configured on the game server.',
  };
}

function makeRequest({ model, system, input, schema }) {
  const format = { name: 'bellwether_turn', strict: true, schema };
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);
  if (model.provider === OPENAI) {
    return {
      model: model.id,
      instructions: system,
      input: prompt,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: { format: { type: 'json_schema', ...format } },
      ...(model.effort && { reasoning: { effort: model.effort } }),
    };
  }

  return {
    model: model.id,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: format },
    ...(model.effort && { reasoning: { effort: model.effort, exclude: true } }),
  };
}

function requestError(provider, status) {
  if (status === 401 || status === 403) {
    return error(`${provider} rejected the key or model access. Check your API account.`, 'provider_auth', 502);
  }
  if (status === 402 || status === 429) {
    return error(`${provider} reported a rate limit or a billing limit. Check your API account before retrying.`, 'provider_limit', 503);
  }
  if (status === 404) {
    return error(`${provider} could not find an available route for this model. Choose another model.`, 'provider_model', 502);
  }
  if (status === 400 || status === 422) {
    return error(`${provider} rejected this model request. Check model compatibility with structured output.`, 'provider_request', 502);
  }
  return error(`${provider} could not answer this turn. Try again.`, 'provider_unavailable', 502);
}

function invalidOutput(provider) {
  return error(`${provider} did not return a complete structured turn. Try a different action or model.`, 'invalid_output', 502);
}

function parseResult(payload, model) {
  const provider = PROVIDER_LABELS[model.provider];
  if (payload?.error) {
    const code = payload.error.code;
    throw requestError(provider, typeof code === 'string' ? Number(code) : code);
  }

  let outputText;
  let inputTokens;
  let outputTokens;
  if (model.provider === OPENAI) {
    if (payload?.status === 'completed' && Array.isArray(payload.output)) {
      const parts = payload.output.filter(item => item?.type === 'message' && Array.isArray(item.content))
        .flatMap(item => item.content);
      if (!parts.some(part => part?.type === 'refusal')) {
        outputText = parts.filter(part => part?.type === 'output_text' && typeof part.text === 'string')
          .map(part => part.text).join('');
      }
    }
    inputTokens = payload?.usage?.input_tokens;
    outputTokens = payload?.usage?.output_tokens;
  } else {
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === 'stop' && !choice.message?.refusal) {
      outputText = choice.message?.content;
    }
    inputTokens = payload?.usage?.prompt_tokens;
    outputTokens = payload?.usage?.completion_tokens;
  }

  let output;
  try {
    output = typeof outputText === 'string' ? JSON.parse(outputText) : null;
  } catch {
    output = null;
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw invalidOutput(provider);
  }

  const usage = Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    : undefined;
  return { output, usage };
}

export function makeProviders({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const file = readCredentials(env.CREDENTIALS_FILE);
  const keys = {
    [OPENAI]: setting(env, file, 'OPENAI_API_KEY', 'OPEN_AI_API_KEY'),
    [OPENROUTER]: setting(env, file, 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'),
  };
  const overrides = [
    configuredModel(setting(env, file, 'OPENAI_MODEL'), OPENAI),
    configuredModel(setting(env, file, 'OPENROUTER_MODEL'), OPENROUTER),
  ].filter(Boolean);
  const models = new Map([...overrides, ...MODELS].map(model => [model.id, model]));

  function catalog() {
    const availableModels = [...models.values()].map(({ id, label, provider, description }) => ({
      id, label, provider, description, available: Boolean(keys[provider]),
    }));
    return {
      models: [...availableModels, { ...DEMO }],
      defaultModel: availableModels.find(model => model.available)?.id ?? DEMO.id,
    };
  }

  async function generate({ model, system, input, schema }) {
    const entry = models.get(model);
    if (!entry) throw error('Choose an available model.', 'unknown_model', 400);
    const provider = PROVIDER_LABELS[entry.provider];
    const key = keys[entry.provider];
    if (!key) throw error(`${provider} needs an API key on the game server.`, 'provider_not_configured', 503);

    const body = JSON.stringify(makeRequest({ model: entry, system, input, schema }));
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(ENDPOINTS[entry.provider], {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      if (signal.aborted) {
        throw error(`${provider} took too long to answer. Try again or choose another model.`, 'provider_timeout', 504);
      }
      throw requestError(provider);
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw requestError(provider, response.status);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      if (signal.aborted) {
        throw error(`${provider} took too long to answer. Try again or choose another model.`, 'provider_timeout', 504);
      }
      if (cause instanceof SyntaxError) throw invalidOutput(provider);
      throw requestError(provider);
    }

    return parseResult(payload, entry);
  }

  return { catalog, generate };
}
