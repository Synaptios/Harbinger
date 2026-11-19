import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { providerFromEnvironment } from '../app/model.mjs';

const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const presets = [
  {
    id: 'openai', label: 'OpenAI', origin: 'https://api.openai.com',
    url: 'https://api.openai.com/v1/responses', keyVariable: 'OPENAI_API_KEY',
  },
  {
    id: 'openrouter', label: 'OpenRouter', origin: 'https://openrouter.ai',
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
    providers.push({ id: 'custom', label: 'Custom endpoint', origin, url: startup.url, key: startup.key });
  }
  return { startup, startupId, providers, path: env.HARBINGER_MODEL_SETTINGS_PATH };
}

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalize(input, providers) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))) {
    throw failure('Send only a provider, model, and reasoning effort.');
  }
  if (!providers.some(provider => provider.id === input.provider)) {
    throw failure('Choose an available story provider.');
  }
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^[A-Za-z0-9@~][A-Za-z0-9_.+:/-]{0,199}$/u.test(model)) {
    throw failure('Enter a valid model ID for the selected provider.');
  }
  const effort = input.reasoningEffort ?? null;
  if (effort !== null && !reasoningEfforts.includes(effort)) {
    throw failure('Choose a valid reasoning effort.');
  }
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

function publicSettings(providers, selection) {
  return {
    ...selection,
    providers: providers.map(({ id, label, origin, key }) => ({
      id, label, origin, credentialConfigured: Boolean(key), reasoningEfforts: [...reasoningEfforts],
    })),
  };
}

export function getStoryModelSettings(env = process.env) {
  const config = configuration(env);
  return publicSettings(config.providers, savedSelection(config) ?? startupSelection(config));
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

export function updateStoryModelSettings(input, env = process.env) {
  const config = configuration(env);
  const selection = normalize(input, config.providers);
  const option = config.providers.find(provider => provider.id === selection.provider);
  if (option.id !== 'custom' && !option.key) {
    throw failure(`An API key for ${option.label} is required before switching to it.`, 422);
  }
  if (!config.path) throw failure('Harbinger cannot save settings in this installation.', 503);
  const temporary = `${config.path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(config.path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(selection, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, config.path);
  } catch {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve the save error if temporary-file cleanup also fails.
    }
    throw failure('Harbinger could not save the story model settings.', 500);
  }
  return publicSettings(config.providers, selection);
}
