import { readFile } from 'node:fs/promises';

const families = {
  'glm-5.3-flash': { name: 'GLM 5.3 Flash', inworld: 'inworld/models/GLM-5.3-Flash', openrouter: 'z-ai/glm-5.3-flash' },
  'deepseek-v3.2': { name: 'DeepSeek V3.2', inworld: 'inworld/models/deepseek-v3.2', openrouter: 'deepseek/deepseek-v3.2' },
  'gemma-4-31b': { name: 'Gemma 4 31B', inworld: 'inworld/models/gemma-4-31b-it', openrouter: 'google/gemma-4-31b-it' },
  'gemma-4-26b': { name: 'Gemma 4 26B', inworld: 'inworld/models/gemma-4-26b-a4b-it', openrouter: 'google/gemma-4-26b-a4b-it' },
  'sonnet-4.5': { name: 'Claude Sonnet 4.5', openrouter: 'anthropic/claude-sonnet-4.5' },
  'sonnet-4.6': { name: 'Claude Sonnet 4.6', inworld: 'anthropic/claude-sonnet-4-6', openrouter: 'anthropic/claude-sonnet-4.6' },
  'gemini-3-flash': { name: 'Gemini 3 Flash', inworld: 'google-ai-studio/gemini-3-flash-preview', openrouter: 'google/gemini-3-flash-preview' },
  'mistral-nemo': { name: 'Mistral NeMo', inworld: 'mistral/mistral-nemo', openrouter: 'mistralai/mistral-nemo' },
  'qwen3-14b': { name: 'Qwen3 14B', inworld: 'qwen/qwen3-14b', openrouter: 'qwen/qwen3-14b' },
};

// Average request mix from the existing paired Covel playtest.
const requestMix = { input: 1966, output: 235 };
const stockOrigins = { inworld: 'https://api.inworld.ai/v1', openrouter: 'https://openrouter.ai/api/v1' };
export const routeLatencyFile = new URL('../.harbinger/provider-latency.json', import.meta.url);

export function routingProviders(env) {
  return {
    inworld: {
      name: 'Inworld', baseUrl: env.HARBINGER_INWORLD_BASE_URL || stockOrigins.inworld,
      key: env.HARBINGER_INWORLD_API_KEY || env.INWORLD_API_KEY,
      catalog: env.HARBINGER_INWORLD_CATALOG_URL || 'https://api.inworld.ai/llm/v1alpha/models',
    },
    openrouter: {
      name: 'OpenRouter', baseUrl: env.HARBINGER_OPENROUTER_BASE_URL || stockOrigins.openrouter,
      key: env.HARBINGER_OPENROUTER_API_KEY || env.OPENROUTER_API_KEY,
      catalog: env.HARBINGER_OPENROUTER_CATALOG_URL || 'https://openrouter.ai/api/v1/models',
    },
  };
}

function readRate(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}

async function catalogRoute(provider, connection, model, required) {
  if (!connection.key || !model) return;
  const authorization = `${provider === 'inworld' ? 'Basic' : 'Bearer'} ${connection.key}`;
  const response = await fetch(connection.catalog, {
    headers: { Authorization: authorization }, signal: AbortSignal.timeout(4500), redirect: 'error',
  });
  if (!response.ok) return;
  const data = await response.json();
  const inworld = provider === 'inworld';
  const entry = (inworld ? data.models : data.data)?.find(item => item.id === model);
  if (!entry || (inworld && !entry.endpoints?.includes('/v1/chat/completions'))) return;
  const modalities = inworld ? entry.spec?.outputModalities : entry.architecture?.output_modalities;
  const parameters = inworld ? entry.spec?.supportedParameters : entry.supported_parameters;
  const input = readRate(inworld ? entry.pricing?.promptToken : entry.pricing?.prompt);
  const output = readRate(inworld ? entry.pricing?.completionToken : entry.pricing?.completion);
  if (!modalities?.includes('text') || !required.every(parameter => parameters?.includes(parameter))) return;
  return {
    provider, providerName: connection.name, modelId: model, baseUrl: connection.baseUrl,
    protocol: 'openai-chat-v1', estimatedCost: input === undefined || output === undefined
      ? null : input * requestMix.input + output * requestMix.output,
  };
}

async function readRouteLatencies(env) {
  try {
    const { routes } = JSON.parse(await readFile(env.HARBINGER_ROUTE_LATENCY_PATH || routeLatencyFile, 'utf8'));
    return Array.isArray(routes) ? routes.filter(sample => sample
      && typeof sample.baseUrl === 'string' && Number.isFinite(sample.p50Ms) && sample.p50Ms > 0
      && Number.isFinite(sample.p95Ms) && sample.p95Ms >= sample.p50Ms) : [];
  } catch {
    return [];
  }
}

function routeKey({ provider, modelId, baseUrl }) {
  return JSON.stringify([provider, modelId, baseUrl.replace(/\/$/u, '')]);
}

function compareRoutes(first, second) {
  const unknown = Infinity;
  return (first.latency?.p95Ms ?? unknown) - (second.latency?.p95Ms ?? unknown)
    || (first.latency?.p50Ms ?? unknown) - (second.latency?.p50Ms ?? unknown)
    || (first.estimatedCost ?? unknown) - (second.estimatedCost ?? unknown);
}

export async function resolveStoryRoute({ model, provider, requiredParameters = [] }, env = process.env) {
  const direct = model.startsWith('openai/') || /^(?:gpt-|o[134](?:-|$)|chatgpt-)/u.test(model);
  if (direct) {
    if (!env.HARBINGER_OPENAI_API_KEY && !env.OPENAI_API_KEY && !(URL.parse(env.HARBINGER_MODEL_URL)?.origin === 'https://api.openai.com' && env.HARBINGER_MODEL_KEY)) {
      throw Object.assign(new Error('The direct OpenAI credential is unavailable.'), { status: 422 });
    }
    return {
      provider: 'openai', providerName: 'OpenAI', name: model.replace(/^openai\//u, ''),
      modelId: model.replace(/^openai\//u, ''), baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai-responses-v1', estimatedCost: null,
    };
  }
  const family = Object.hasOwn(families, model) ? families[model] : undefined;
  if (!family) throw Object.assign(new Error('Choose a supported Harbinger model.'), { status: 400 });
  const candidates = Object.entries(routingProviders(env)).filter(([name]) => !provider || name === provider);
  const required = [...new Set(['response_format', ...requiredParameters])];
  const [routes, measurements] = await Promise.all([
    Promise.allSettled(candidates.map(([name, connection]) => catalogRoute(name, connection, family[name], required))),
    readRouteLatencies(env),
  ]);
  const latencyByRoute = new Map(measurements.map(({ p50Ms, p95Ms, ...sample }) => [routeKey(sample), { p50Ms, p95Ms }]));
  const chosen = routes.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    .map(route => ({ ...route, latency: latencyByRoute.get(routeKey(route)) ?? null }))
    .sort(compareRoutes)[0];
  if (!chosen) throw Object.assign(new Error('No configured provider supports this model and its required parameters.'), { status: 422 });
  return { ...chosen, name: family.name };
}
