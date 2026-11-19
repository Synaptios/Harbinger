import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { storyModelProvider } from './model-settings.mjs';
import { additionalTextSlots, fixedDirectionSlots } from './native-role-defaults.mjs';
import { routingProviders } from './provider-routes.mjs';

const reasoningEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const providerKeys = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', custom: 'HARBINGER_STARTUP_API_KEY' };

function nativeTarget(provider) {
  const endpoint = URL.parse(provider?.url ?? '');
  if (!endpoint || !['http:', 'https:'].includes(endpoint.protocol)
      || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) return;
  const suffix = endpoint.pathname.endsWith('/responses') ? '/responses' : '/chat/completions';
  if (!endpoint.pathname.endsWith(suffix)) return;
  return {
    provider: provider.id === 'custom' ? 'harbinger-startup' : provider.id,
    model: provider.name,
    baseUrl: endpoint.origin + endpoint.pathname.slice(0, -suffix.length),
    protocol: suffix === '/responses' ? 'openai-responses-v1' : 'openai-chat-v1',
    reasoningEffort: reasoningEfforts.has(provider.reasoningEffort) ? provider.reasoningEffort : undefined,
  };
}

export function sectionToml(id, values) {
  const fields = Object.entries(values).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${JSON.stringify(value).replaceAll('$', '\\u0024')}`);
  return [`[${id}]`, ...fields].join('\n');
}

export function configureNativeStory(sqlitePath, env) {
  const previous = storyModelProvider(env);
  const target = nativeTarget(previous);
  const keys = {};
  const routeProviders = routingProviders(env);
  const startupOrigin = URL.parse(env.HARBINGER_MODEL_URL)?.origin;
  const configuredKeys = {
    openai: env.HARBINGER_OPENAI_API_KEY || env.OPENAI_API_KEY || (startupOrigin === 'https://api.openai.com' && env.HARBINGER_MODEL_KEY),
    openrouter: env.HARBINGER_OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || (startupOrigin === 'https://openrouter.ai' && env.HARBINGER_MODEL_KEY),
    custom: previous?.id === 'custom' ? previous.key : undefined,
  };
  for (const [provider, key] of Object.entries(configuredKeys)) {
    if (key) keys[providerKeys[provider]] = key;
  }
  if (routeProviders.inworld.key) keys.INWORLD_API_KEY = routeProviders.inworld.key;
  const explicitPath = env.COVEL_LLM_TOML;
  if (explicitPath) return { ...keys, COVEL_LLM_TOML: resolve(explicitPath), HARBINGER_NATIVE_STORY_ROLE: '1' };
  if (!target) return keys;

  const configPath = `${sqlitePath}.llm.toml`;
  mkdirSync(dirname(configPath), { recursive: true });
  const sections = {
    ...Object.fromEntries(['story', 'previous-lineup', ...additionalTextSlots].map(slot => [`covel.${slot}`, target])),
    'covel.image': {
      provider: 'openai', model: 'gpt-image-2.5-flare', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-chat-v1', tag: 'image',
    },
    'covel.speech': {
      provider: 'inworld', model: 'inworld-tts-2', baseUrl: routeProviders.inworld.baseUrl,
      protocol: 'openai-chat-v1', tag: 'speech', output: ['audio'],
    },
    ...fixedDirectionSlots(routeProviders, keys),
    'covel.planning': {
      provider: 'openai', model: 'gpt-5.6-luna', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses-v1',
    },
    ...Object.fromEntries(Object.entries(routeProviders).map(([provider, { baseUrl }]) => [`covel.routing-${provider}`, {
      provider, baseUrl, protocol: 'openai-chat-v1',
      model: provider === 'inworld' ? 'inworld/models/GLM-5.3-Flash' : 'z-ai/glm-5.3-flash',
    }])),
  };
  try {
    const config = Object.entries(sections).map(([id, values]) => sectionToml(id, values)).join('\n\n');
    writeFileSync(configPath, `${config}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = readFileSync(configPath, 'utf8');
    const missing = Object.entries(sections).filter(([id]) => !current.includes(`[${id}]`));
    if (missing.length) appendFileSync(configPath, `\n${missing.map(([id, values]) => sectionToml(id, values)).join('\n\n')}\n`);
  }
  return { ...keys, COVEL_LLM_TOML: configPath, HARBINGER_NATIVE_STORY_ROLE: '1' };
}
