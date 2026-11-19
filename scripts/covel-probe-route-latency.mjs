import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStoryRoute, routeLatencyFile, routingProviders } from '../covel/provider-routes.mjs';

const prose = {
  message: 'In a medieval London bakehouse, Alice waits by a table holding a cooled loaf as a clerk hears a crier outside. Write about 500 words based only on this small scene. The clerk observes and can choose what to do next. Return the passage without headings.',
  tokens: 2400,
  validate(content) {
    const words = content.trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
    return words >= 400 && words <= 700;
  },
};

function structured(message, check, disableThinking = false) {
  return {
    message,
    tokens: 400,
    disableThinking,
    format: { type: 'json_object' },
    validate(content) {
      return check(JSON.parse(content));
    },
  };
}

const action = structured('The clerk says “I look around.” Interpret the action. Return a JSON object with action set to observe, speak, take, or unclear.', value => value?.action === 'observe');
const profiles = {
  'glm-5.3-flash': prose,
  'deepseek-v3.2': prose,
  'gemma-4-31b': action,
  'gemma-4-26b': action,
  'sonnet-4.5': prose,
  'sonnet-4.6': structured(
    'A customer in a bakehouse asks Alice whether she can meet for supper. She is busy, so decline in one sentence. Return JSON with reply as a string and commitment as null.',
    value => typeof value?.reply === 'string' && value.commitment === null,
  ),
  'gemini-3-flash': structured(
    'The clerk says “I look around, then take the ledger.” Return JSON with actions, an array of up to two labels from observe, speak, take, and unclear, in order.',
    value => value?.actions?.length === 2 && value.actions[0] === 'observe' && value.actions[1] === 'take',
  ),
  'mistral-nemo': structured(
    'Summarize this passage: Alice heard the crier outside. She has not read its order. Return JSON with a nonempty summary string.',
    value => typeof value?.summary === 'string' && Boolean(value.summary.trim()),
  ),
  'qwen3-14b': structured(
    'This teen-rated story has no violence or explicit content: Alice hears a crier from inside the bakehouse and sets her warm bread down. Return exactly {"approved":true} for approval or {"approved":false} for denial.',
    value => value?.approved === true,
    true,
  ),
};

const attempts = 3;
const deadlineMs = 35_000;
const providers = routingProviders(process.env);

async function measure(route, profile) {
  const gateway = providers[route.provider];
  const start = performance.now();
  try {
    const model = route.modelId;
    const response = await fetch(`${route.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(deadlineMs),
      headers: { Authorization: `${route.provider === 'inworld' ? 'Basic' : 'Bearer'} ${gateway.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: profile.message }],
        max_tokens: profile.tokens,
        ...(profile.format && { response_format: profile.format }),
        ...(profile.disableThinking && (route.provider === 'openrouter'
          ? { reasoning: { enabled: false } } : { enable_thinking: false })),
        ...(route.provider === 'openrouter' && { provider: { sort: 'latency', require_parameters: true } }),
      }),
    });
    if (!response.ok) return deadlineMs;
    const { choices } = await response.json();
    const content = choices?.[0]?.message?.content;
    return typeof content === 'string' && profile.validate(content) ? Math.round(performance.now() - start) : deadlineMs;
  } catch {
    return deadlineMs;
  }
}

async function compareRoute(family, provider) {
  let route;
  try {
    route = await resolveStoryRoute({ model: family, provider });
  } catch (error) {
    if (error.status === 422) return null;
    throw error;
  }
  const samples = [];
  for (let index = 0; index < attempts; index += 1) samples.push(await measure(route, profiles[family]));
  const sort = [...samples].sort((left, right) => left - right);
  const { modelId, baseUrl } = route;
  return {
    family, provider, modelId, baseUrl, samples, successes: samples.filter(ms => ms < deadlineMs).length,
    p50Ms: sort[Math.ceil(sort.length * 0.5) - 1], p95Ms: sort[Math.ceil(sort.length * 0.95) - 1],
  };
}

const routes = (await Promise.all(Object.keys(profiles).flatMap(family => Object.keys(providers)
  .map(provider => compareRoute(family, provider))))).filter(Boolean);
if (routes.length === 0) throw new Error('No configured gateway returned a compatible Voyage model catalog.');
const destination = process.env.HARBINGER_ROUTE_LATENCY_PATH
  ? resolve(process.env.HARBINGER_ROUTE_LATENCY_PATH) : fileURLToPath(routeLatencyFile);
const pending = `${destination}.${process.pid}.tmp`;
await mkdir(dirname(destination), { recursive: true });
const snapshot = { measuredAt: new Date().toISOString(), deadlineMs, routes };
await writeFile(pending, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
await rename(pending, destination);
console.table(routes.map(({ family, provider, p50Ms, p95Ms, successes }) => ({ family, provider, p50Ms, p95Ms, successes })));
