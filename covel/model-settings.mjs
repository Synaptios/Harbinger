import { readFileSync } from 'node:fs';
import { providerFromEnvironment } from '../app/model.mjs';

const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const presets = [
  {
    id: 'openai', origin: 'https://api.openai.com',
    url: 'https://api.openai.com/v1/responses', keyVariable: 'OPENAI_API_KEY',
  },
  {
    id: 'openrouter', origin: 'https://openrouter.ai',
    url: 'https://openrouter.ai/api/v1/chat/completions', keyVariable: 'OPENROUTER_API_KEY',
  },
];

function configuration(env) {
  const startup = providerFromEnvironment(env);
  const endpoint = URL.parse(startup?.url ?? '');
  const origin = endpoint && ['http:', 'https:'].includes(endpoint.protocol) ? endpoint.origin : null;
  const startupId = origin ? presets.find(provider => provider.origin === origin)?.id ?? 'custom' : null;
  const providers = presets.map(preset => ({
    ...preset,
    key: env[`HARBINGER_${preset.keyVariable}`] || env[preset.keyVariable]
      || (startupId === preset.id ? startup?.key : undefined),
  }));
  if (startupId === 'custom') {
    providers.push({ id: 'custom', origin, url: startup.url, key: startup.key });
  }
  return { startup, startupId, providers, path: env.HARBINGER_MODEL_SETTINGS_PATH };
}

function normalize(input, providers) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))
      || !providers.some(provider => provider.id === input.provider)) return;
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^[A-Za-z0-9@~][A-Za-z0-9_.+:/-]{0,199}$/u.test(model)) return;
  const effort = input.reasoningEffort ?? null;
  if (effort !== null && !reasoningEfforts.includes(effort)) return;
  return { provider: input.provider, model, reasoningEffort: effort };
}

function savedSelection({ path, providers }) {
  if (!path) return;
  try {
    return normalize(JSON.parse(readFileSync(path, 'utf8')), providers);
  } catch {
    // An absent or invalid local override leaves the startup configuration in use.
  }
}

function startupSelection({ startup, startupId }) {
  return {
    provider: startupId,
    model: startup?.name || null,
    reasoningEffort: startup?.reasoningEffort || null,
  };
}

export function storyModelProvider(env = process.env) {
  const config = configuration(env);
  const saved = savedSelection(config);
  const { provider, model, reasoningEffort } = saved ?? startupSelection(config);
  const option = config.providers.find(item => item.id === provider);
  if (!option || !model || (saved && provider !== 'custom' && !option.key)) return;
  return {
    id: provider,
    url: saved ? option.url : config.startup.url,
    name: model,
    key: option.key,
    reasoningEffort,
  };
}
