import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { providerFromEnvironment } from '../app/model.mjs';
import { launchCovel } from '../covel/runtime.mjs';

const route = [
  ['opening', null],
  ['voice', 'I ask Alice, “Will you come to supper after you’re finished here?”'],
  ['promise', 'Promise Alice discretion'],
  ['sourced-disclosure', 'Ask Alice what brought Guenever to London'],
  ['recall-and-agency', 'I ask Alice what I promised earlier, and tell her I will keep her confidence.'],
];

const requiredRoles = ['story', 'character', 'state'];
const requireLength = process.argv.includes('--require-length');
const diagnostics = ['gateway.calling', 'gateway.responded', 'gateway.failed', 'llm.calling', 'llm.responded'];
const children = [];

function launch(directory, label, provider, toml) {
  const savedToml = process.env.COVEL_LLM_TOML;
  let child;
  try {
    if (toml) process.env.COVEL_LLM_TOML = resolve(toml);
    else delete process.env.COVEL_LLM_TOML;
    child = launchCovel({ databasePath: join(directory, label, 'story.sqlite'), provider, web: true });
  } finally {
    if (savedToml === undefined) delete process.env.COVEL_LLM_TOML;
    else process.env.COVEL_LLM_TOML = savedToml;
  }
  children.push({ child, stopped: new Promise(resolveExit => child.once('close', resolveExit)) });
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} server did not become ready.`)), 20_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error(`${label} server could not start.`));
    });
    child.once('close', code => {
      clearTimeout(timer);
      reject(new Error(`${label} server exited (${code ?? 'signal'}).`));
    });
    child.on('message', message => {
      if (message?.type !== 'covel:ready') return;
      clearTimeout(timer);
      resolveReady(`http://127.0.0.1:${message.port}`);
    });
  });
}

async function request(url, path, data) {
  const response = await fetch(url + path, {
    signal: AbortSignal.timeout(125_000),
    ...(data && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (!response.ok) throw new Error(`${path.split('/').at(-1)} returned HTTP ${response.status}.`);
  return response;
}

async function submit(url, sessionId, text) {
  const started = performance.now();
  const response = await request(url, '/api/actions', {
    sessionId,
    requestId: randomUUID(),
    type: text ? 'submit_actions' : 'start_session',
    payload: text ? { actions: [{ kind: 'say', text }] } : {},
  });
  let remaining = '';
  let committed;
  let roundCommits = 0;
  let executionCommits = 0;
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    remaining += chunk;
    const lines = remaining.split('\n');
    remaining = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const { type, payload } = JSON.parse(line.slice(6));
      if (type === 'execution.round.completed' && payload.committed) {
        roundCommits++;
        committed = { turnId: payload.turnId, ms: Math.round(performance.now() - started) };
      }
      if (type === 'execution.completed' && payload.committed) executionCommits++;
    }
  }
  if (roundCommits !== 1 || executionCommits !== 1) throw new Error('Expected exactly one committed action round.');
  return committed;
}

function gatewayFailure(payload) {
  const method = ['generateObject', 'generateText', 'evaluate'].includes(payload.method) ? payload.method : 'other';
  const message = typeof payload.error === 'string' ? payload.error : '';
  const refusal = payload.diagnosticsSummary?.refusalReason;
  if (refusal === 'refusal' || refusal === 'content-filter') return { method, kind: refusal };
  if (/requested schema|invalid json|json parse/iu.test(message)) return { method, kind: 'schema' };
  if (/timed out|timeout/iu.test(message)) return { method, kind: 'timeout' };
  return { method, kind: 'provider-error' };
}

function callsFor(turn) {
  const requests = {};
  const responses = new Map();
  const gatewayFailures = [];
  for (const { type, payload } of turn?.events ?? []) {
    if (!diagnostics.includes(type)) continue;
    if (type.endsWith('.calling')) {
      const role = payload.presetId ?? payload.slot ?? 'unattributed';
      requests[role] = (requests[role] ?? 0) + 1;
      continue;
    }
    const failed = type.endsWith('.failed') || payload.finishReason === 'error';
    if (type === 'gateway.failed') gatewayFailures.push(gatewayFailure(payload));
    const key = JSON.stringify([payload.provider ?? null, payload.model ?? null]);
    const aggregate = responses.get(key) ?? {
      provider: payload.provider ?? null, model: payload.model ?? null, calls: 0, failures: 0,
      durationMs: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
    };
    aggregate.calls++;
    if (failed) aggregate.failures++;
    aggregate.durationMs += payload.durationMs ?? 0;
    for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens']) {
      aggregate[field] += payload.usage?.[field] ?? 0;
    }
    responses.set(key, aggregate);
  }
  return { requests, responses: [...responses.values()], gatewayFailures };
}

function stageFor(role, method) {
  switch (role.replace(/^slot-/u, '')) {
    case 'state': return 'state';
    case 'character': return 'character';
    case 'story': return method === 'generateText' ? 'story-draft' : 'story-structured';
    case 'harbinger-continuity': return 'continuity-review-or-edit';
    case 'harbinger-safety': return 'rating';
    default: return 'other';
  }
}

function providerSpans(turn, bindings) {
  const events = turn?.events ?? [];
  const startedAt = Date.parse(events.find(event => event.type === 'turn.started')?.timestamp ?? turn?.startedAt);
  const committedAt = Date.parse(events.find(event => event.type === 'turn.completed' && event.payload.committed)?.timestamp);
  if (!Number.isFinite(startedAt) || !Number.isFinite(committedAt) || committedAt < startedAt) return null;

  const pending = [];
  const calls = [];
  for (const { type, payload, timestamp } of events) {
    if (!type.startsWith('gateway.') || !diagnostics.includes(type)) continue;
    const at = Date.parse(timestamp);
    if (!Number.isFinite(at) || at > committedAt) continue;
    if (type === 'gateway.calling') {
      pending.push({ at, runtime: payload.runtimeId, method: payload.method, role: payload.presetId ?? 'unattributed' });
      continue;
    }
    if (!Number.isFinite(payload.durationMs) || payload.durationMs < 0) continue;
    const inferredStart = at - payload.durationMs;
    // Covel supplies a duration but no per-call correlation ID. Matching the
    // implied start and resolved route handles out-of-order parallel responses.
    let best = -1;
    let bestRoute = false;
    for (const [index, start] of pending.entries()) {
      if (start.runtime !== payload.runtimeId || start.method !== payload.method || start.at > at) continue;
      const binding = bindings[start.role.replace(/^slot-/u, '')];
      const hasRoute = Boolean(payload.provider && payload.model && binding?.provider === payload.provider && binding.model === payload.model);
      const closer = best < 0 || Math.abs(start.at - inferredStart) < Math.abs(pending[best].at - inferredStart);
      if (best < 0 || (hasRoute && !bestRoute) || (hasRoute === bestRoute && closer)) {
        best = index;
        bestRoute = hasRoute;
      }
    }
    const role = best < 0 ? 'unattributed' : pending.splice(best, 1)[0].role;
    calls.push({ stage: stageFor(role, payload.method), role, provider: payload.provider ?? null, model: payload.model ?? null,
      startMs: Math.max(startedAt, inferredStart) - startedAt, endMs: at - startedAt,
      outcome: type === 'gateway.failed' ? gatewayFailure(payload).kind : 'responded' });
  }
  calls.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let providerWallMs = 0;
  let providerWorkMs = 0;
  let providerEnd = 0;
  for (const { startMs, endMs } of calls) {
    providerWallMs += Math.max(0, endMs - Math.max(providerEnd, startMs));
    providerWorkMs += endMs - startMs;
    providerEnd = Math.max(providerEnd, endMs);
  }
  return { calls, providerWorkMs, providerWallMs, overlapMs: providerWorkMs - providerWallMs,
    otherWallMs: committedAt - startedAt - providerWallMs };
}

async function play(label, url) {
  const get = async path => (await request(url, path)).json();
  const bindings = (await get('/api/llm-config')).slots;
  const roles = Object.fromEntries(requiredRoles.map(role => [role, {
    provider: bindings[role]?.provider ?? null,
    model: bindings[role]?.model ?? null,
    protocol: bindings[role]?.protocol ?? null,
    reasoningEffort: bindings[role]?.parameterOverrides?.reasoningEffort ?? null,
  }]));
  const plugins = (await get('/api/plugins')).items;
  const { id } = await (await request(url, '/api/sessions', {
    worldId: 'bread-ledger', locale: 'en-US', plugins: ['harbinger'],
    excludedPlugins: plugins.filter(plugin => plugin.id !== 'harbinger').map(plugin => plugin.id),
  })).json();
  const base = `/api/sessions/${id}`;
  const measurements = [];
  const prose = [];
  for (const [scene, action] of route) {
    try {
      const committed = await submit(url, id, action);
      const [journal, history, trace] = await Promise.all([
        get(`${base}/plugin-data/harbinger`), get(`${base}/messages`), get(`/api/traces/${id}/turns`),
      ]);
      const stories = history.items.filter(message =>
        message.role === 'assistant' && message.kind === 'story' && message.turnId === committed.turnId);
      const inputs = history.items.filter(message => message.role === 'user' && message.turnId === committed.turnId);
      const story = stories[0]?.content ?? '';
      const words = story.trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
      const passageIds = new Set(journal.items.filter(item => item.namespace === 'passages').map(item => item.key));
      const view = journal.items.find(item => item.namespace === 'story' && item.key === 'view')?.value;
      const observations = view?.observations ?? [];
      const traced = trace.turns.find(turn => turn.turnId === committed.turnId);
      const usage = callsFor(traced);
      const checks = {
        oneSavedStory: stories.length === 1 && words > 0,
        oneSavedPlayerAction: action === null ? inputs.length === 0 : inputs.length === 1 && inputs[0].content === action,
        journalSourcesResolve: Boolean(view) && observations.every(item => item.source && passageIds.has(item.passageId)),
        disclosureStaysReported: scene !== 'sourced-disclosure' || observations.some(item =>
          item.title === 'The reason for the flour' && item.source === 'Alice' && item.status === 'reported'),
        traceConfirmsCommit: traced?.events.filter(event => event.type === 'turn.completed' && event.payload.committed).length === 1,
        groundedNarration: !Object.keys(usage.requests).some(role => ['story', 'harbinger-continuity', 'harbinger-safety']
          .includes(role.replace(/^slot-/u, ''))),
        ...(requireLength && label === 'candidate' && { wordsInTarget: words >= 400 && words <= 700 }),
      };
      measurements.push({ scene, action, ...committed, words,
        location: view?.scene?.heading ?? null, journalEntries: observations.length, checks,
        usage, criticalPath: providerSpans(traced, bindings) });
      prose.push({ scene, action, story });
    } catch (error) {
      const expected = /^(?:\w+[\w/-]* returned HTTP \d+\.|Expected exactly one committed action round\.)$/u;
      measurements.push({ scene, action, error: expected.test(error.message) ? error.message : 'Could not read a committed turn.' });
      break;
    }
  }
  const timings = measurements.flatMap(turn => turn.ms === undefined ? [] : [turn.ms]).sort((a, b) => a - b);
  const percentile = ratio => timings.length ? timings[Math.ceil(timings.length * ratio) - 1] : null;
  return { label, roles, measurements, timing: { samples: timings.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) }, prose };
}

async function main() {
  const candidate = process.env.HARBINGER_VOYAGE_CANDIDATE_TOML;
  const provider = providerFromEnvironment();
  if (!candidate || !provider?.url || !provider?.name) {
    throw new Error('Set HARBINGER_VOYAGE_CANDIDATE_TOML, HARBINGER_MODEL_URL, and HARBINGER_MODEL_NAME.');
  }
  const temporary = await mkdtemp(join(tmpdir(), 'harbinger-voyage-playtest-'));
  try {
    const configs = [['candidate', candidate]];
    if (!process.argv.includes('--candidate-only')) configs.unshift(['previous', process.env.HARBINGER_VOYAGE_PREVIOUS_TOML]);
    const results = await Promise.allSettled(configs.map(async ([label, config]) =>
      play(label, await launch(temporary, label, provider, config))));
    const arms = results.map((result, index) => result.status === 'fulfilled' ? result.value
      : { label: configs[index][0], error: 'Could not initialize the isolated playtest.', measurements: [], prose: [] });
    const directory = resolve('.harbinger', 'playtest');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const metrics = join(directory, `voyage-${stamp}.json`);
    const prose = join(directory, `voyage-${stamp}-prose.json`);
    await mkdir(directory, { recursive: true });
    const gatePassed = arms.every(arm => arm.measurements.length === route.length
      && new Set(arm.measurements.map(turn => turn.turnId)).size === route.length
      && arm.measurements.every(turn => turn.checks && Object.values(turn.checks).every(Boolean)));
    const report = { measuredAt: new Date().toISOString(), parallel: configs.length > 1, gatePassed,
      arms: arms.map(({ prose: _prose, ...arm }) => arm) };
    await Promise.all([
      writeFile(metrics, JSON.stringify(report, null, 2)),
      writeFile(prose, JSON.stringify(arms.map(arm => ({ label: arm.label, turns: arm.prose })), null, 2)),
    ]);
    console.log(JSON.stringify({ metrics, prose, gatePassed }));
    if (!gatePassed) process.exitCode = 1;
  } finally {
    await Promise.all(children.map(async ({ child, stopped }) => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await stopped;
    }));
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
