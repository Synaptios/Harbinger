import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const OPENAI = 'openai';
const OPENROUTER = 'openrouter';
const LABELS = { [OPENAI]: 'OpenAI', [OPENROUTER]: 'OpenRouter' };
const BASE_URLS = {
  [OPENAI]: 'https://api.openai.com/v1',
  [OPENROUTER]: 'https://openrouter.ai/api/v1',
};

function requestError(message, status) {
  return Object.assign(new Error(message), { status });
}

function readCredentials(path, optional = false) {
  let source;
  try {
    source = readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (optional && error.code === 'ENOENT') return {};
    throw new Error('Could not read the credentials file.');
  }

  try {
    const values = source.startsWith('{') ? JSON.parse(source) : parseEnv(source);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error();
    return values;
  } catch {
    throw new Error('The credentials file must contain dotenv assignments or a JSON object.');
  }
}

function keyFrom(env, file, name, alias) {
  const key = env[name] ?? env[alias] ?? file[name] ?? file[alias]
    ?? file[name.toLowerCase()] ?? file[alias.toLowerCase()];
  return typeof key === 'string' ? key.trim() : '';
}

function requiresDirectModel(id) {
  return typeof id === 'string' && /^~?(?:openai|openrouter)\//i.test(id);
}

function supportsChat(provider, model) {
  if (provider === OPENAI) {
    // The OpenAI model list supplies IDs but no capability metadata.
    const id = model.id.startsWith('ft:') ? model.id.split(':')[1] : model.id;
    return !/^(?:text-embedding|text-moderation|omni-moderation|tts-|whisper-|dall-e|sora|babbage-002|davinci-002|computer-use)|(?:-realtime|-transcribe|-deep-research|-image(?:-|$))/i.test(id);
  }

  const { input_modalities: input, output_modalities: output } = model.architecture ?? {};
  return (!Array.isArray(input) || input.includes('text'))
    && (!Array.isArray(output) || output.includes('text'))
    && (!Array.isArray(model.endpoints) || model.endpoints.includes('/api/v1/chat/completions'));
}

function upstreamError(provider, status) {
  const label = LABELS[provider];
  if (status === 401 || status === 403) {
    return requestError(`${label} denied the API key or model access.`, 502);
  }
  if (status === 402 || status === 429) {
    return requestError(`${label} reported a rate or billing limit.`, 503);
  }
  if (status === 400 || status === 404 || status === 422) {
    return requestError(`${label} rejected the request. Check model access, text chat support, and the length of the conversation.`, 502);
  }
  return requestError(`${label} is temporarily unavailable.`, 502);
}

function needsChatCompletions(status, error) {
  return (status === 400 || status === 404) && (
    error?.code === 'model_not_found'
    || /chat.completions|(?:not supported|does not support|not compatible).*(?:responses|endpoint)/i.test(error?.message ?? '')
  );
}

function replyText(payload, responses) {
  if (responses) {
    return (Array.isArray(payload.output) ? payload.output : [])
      .filter(item => item?.type === 'message' && Array.isArray(item.content))
      .flatMap(item => item.content)
      .map(part => part?.type === 'output_text' ? part.text : part?.refusal)
      .filter(text => typeof text === 'string')
      .join('');
  }

  const reply = payload.choices?.[0]?.message;
  if (Array.isArray(reply?.content)) {
    return reply.content.map(part => part?.text).filter(text => typeof text === 'string').join('');
  }
  return typeof reply?.content === 'string' ? reply.content : reply?.refusal;
}

export function createProviders({ env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
  const file = env.CREDENTIALS_FILE
    ? readCredentials(resolve(cwd, env.CREDENTIALS_FILE))
    : { ...readCredentials(resolve(cwd, '.env'), true), ...readCredentials(resolve(cwd, '.credentials'), true) };
  const keys = {
    [OPENAI]: keyFrom(env, file, 'OPENAI_API_KEY', 'OPEN_AI_API_KEY'),
    [OPENROUTER]: keyFrom(env, file, 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'),
  };
  let cachedCatalog;
  let expiresAt = 0;
  let pendingCatalog;

  async function call(provider, path, body) {
    const signal = AbortSignal.timeout(body ? 120_000 : 12_000);
    const headers = { Accept: 'application/json' };
    if (keys[provider]) headers.Authorization = `Bearer ${keys[provider]}`;
    if (body) headers['Content-Type'] = 'application/json';

    try {
      const response = await fetchImpl(BASE_URLS[provider] + path, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal,
      });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    } catch {
      if (signal.aborted) throw requestError(`${LABELS[provider]} took too long to respond.`, 504);
      throw upstreamError(provider);
    }
  }

  async function list(provider) {
    const available = Boolean(keys[provider]);
    const missingKey = `Set ${provider === OPENAI ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'} to use ${LABELS[provider]}.`;
    if (provider === OPENAI && !available) return { models: [], error: missingKey };

    try {
      const { ok, status, data } = await call(provider, '/models');
      if (!ok || !Array.isArray(data?.data)) throw upstreamError(provider, status);
      const models = new Map();
      for (const model of data.data) {
        const id = model?.id;
        if (typeof id !== 'string' || !id) continue;
        if (provider === OPENROUTER && (
          requiresDirectModel(id) || requiresDirectModel(model.canonical_slug) || model.architecture?.tokenizer === 'Router'
        )) continue;
        models.set(id, {
          id,
          label: typeof model.name === 'string' && model.name ? model.name : id,
          provider,
          available,
          chat: supportsChat(provider, model),
        });
      }
      return {
        models: [...models.values()].sort((left, right) => left.label.localeCompare(right.label)),
        error: available ? undefined : missingKey,
      };
    } catch (error) {
      return { models: [], error: error.message };
    }
  }

  async function catalog() {
    if (cachedCatalog && Date.now() < expiresAt) return cachedCatalog;
    pendingCatalog ??= Promise.all([list(OPENAI), list(OPENROUTER)])
      .then(([openai, openrouter]) => {
        const errors = {};
        if (openai.error) errors.openai = openai.error;
        if (openrouter.error) errors.openrouter = openrouter.error;
        cachedCatalog = { models: [...openai.models, ...openrouter.models], errors };
        expiresAt = Date.now() + (Object.keys(errors).length ? 20_000 : 300_000);
        return cachedCatalog;
      })
      .finally(() => { pendingCatalog = undefined; });
    return pendingCatalog;
  }

  async function chat({ provider, model, system, messages }) {
    if (provider !== OPENAI && provider !== OPENROUTER) throw requestError('Choose a model provider.', 400);
    if (provider === OPENROUTER && requiresDirectModel(model)) {
      throw requestError('Choose a direct OpenAI model or a specific OpenRouter model.', 400);
    }
    if (!keys[provider]) throw requestError(`Configure a ${LABELS[provider]} API key to send messages.`, 503);

    const { models, errors } = await catalog();
    if (errors[provider]) throw requestError(errors[provider], 503);
    const selected = models.find(entry => entry.provider === provider && entry.id === model);
    if (!selected) throw requestError('Choose a model from this provider’s catalog.', 400);
    if (!selected.chat) throw requestError('This model is unavailable for text chat.', 400);

    const chatMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const audioChat = provider === OPENAI && /^(?:gpt-audio|gpt-4o(?:-mini)?-audio)(?:-|$)/.test(model);
    let responses = provider === OPENAI && !audioChat;
    let result = responses
      ? await call(provider, '/responses', { model, input: messages, store: false, ...(system && { instructions: system }) })
      : await call(provider, '/chat/completions', {
        model, messages: chatMessages, ...(audioChat && { modalities: ['text'], store: false }),
      });
    if (responses && !result.ok && needsChatCompletions(result.status, result.data?.error)) {
      responses = false;
      result = await call(provider, '/chat/completions', { model, messages: chatMessages, store: false });
    }

    if (!result.ok || result.data?.error) {
      throw upstreamError(provider, result.ok ? Number(result.data?.error?.code) : result.status);
    }
    const text = result.data && replyText(result.data, responses);
    if (typeof text !== 'string' || !text.trim()) {
      throw requestError(`${LABELS[provider]} returned no text for this request.`, 502);
    }
    return text;
  }

  return { catalog, chat };
}
