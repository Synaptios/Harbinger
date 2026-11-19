import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { actorContext } from '../app/knowledge.mjs';
import { providerFromEnvironment } from '../app/model.mjs';
import { launchCovel } from '../covel/runtime.mjs';
import { playerProfiles, profileAction } from './covel-player-profiles.mjs';

const worldId = 'bread-ledger';
const playerTurnsPerStyle = 10;
const length = { min: 200, max: 300 };
const latencyTargetMs = 5_000;
const shutterScenes = ['shutter', 'shutterNotice'];
const martinBefore = 'Ask Martin what brought Guenever to London';
const promise = 'Promise Alice discretion';
const disclose = 'Ask Alice what brought Guenever to London';
const landing = 'Go with Alice to the river';
const market = 'Ask the carters in the market';
const ledger = 'Take the ledger to Martin';
const flour = 'Help Alice load the flour';
const notice = 'Read the guild notice';
const unread = 'Leave the guild notice unread';

function ask(actor, question) {
  return 'I ask ' + actor + ', “' + question + '”';
}

function journal(view, title) {
  return view.observations.find(item => item.title === title);
}

function directAddress(actorId) {
  return ({ newRecords }) => newRecords.some(record => record.type === 'actor-exchange' && record.actorId === actorId);
}

function learnsInOrder(actorId, factId) {
  return ({ before, state }) => !actorContext(before, actorId).facts.some(fact => fact.id === factId)
    && actorContext(state, actorId).facts.some(fact => fact.id === factId);
}

function martinHasAccount(state) {
  return actorContext(state, 'martin').beliefs.some(item => item.topic === 'guenever-refuge' && item.stance === 'reported');
}

function clerkToldMartin({ before, state }) {
  return !martinHasAccount(before) && martinHasAccount(state)
    && !actorContext(state, 'martin').facts.some(fact => fact.id === 'guenever-refuge');
}

function aliceReports({ view, state }) {
  return journal(view, 'The reason for the flour')?.status === 'reported' && !martinHasAccount(state);
}

function stillPrivate({ state, prose }) {
  return !martinHasAccount(state) && !/Guenever.{0,60}Tower|Tower.{0,60}Guenever/isu.test(prose);
}

const routes = [
  { id: 'guild-first', label: 'Guild-first clerk', steps: [
    ['Ask Martin about the proclamation', 'bakehouse'],
    [martinBefore, 'bakehouse', stillPrivate],
    ['Ask Martin whether Arthur has reached Dover', 'bakehouse', ({ state }) =>
      !actorContext(state, 'martin').facts.some(fact => fact.id === 'dover-landing')],
    [ask('Martin', 'What would you count as a witness?'), 'bakehouse', directAddress('martin')],
    ['Ask Alice about the proclamation', 'bakehouse'],
    [ask('Alice', 'What are you afraid he will write down?'), 'bakehouse', directAddress('alice')],
    [ledger, 'guildInspection'],
    [ask('Martin', 'Will you write something you have only heard?'), 'guildInspection', directAddress('martin')],
    [ask('Alice', 'Which names are you willing to have read out?'), 'guildInspection', directAddress('alice')],
    ['Give Martin the names', 'licensedOven', ({ newRecords, view }) => newRecords.some(record =>
      record.type === 'inspection' && record.outcome === 'oven-licensed') && Boolean(journal(view, 'Guild license on the shutter'))],
  ] },
  { id: 'loyal-confidante', label: 'Loyal confidante', steps: [
    ['Ask Alice about the proclamation', 'bakehouse'],
    [promise, 'bakehouse'],
    [disclose, 'bakehouse', aliceReports],
    ['Keep Alice’s confidence', 'bakehouse', ({ state }) => !martinHasAccount(state)
      && state.relationships.some(item => item.from === 'alice' && item.to === 'player' && item.trust > 0)],
    [landing, 'landing'],
    ['Ask Alice about your promise', 'landing', ({ prose }) => /kept your word/iu.test(prose)],
    ['Ask Alice about the carter’s words', 'landing', learnsInOrder('player', 'carter-phrase')],
    ['Read the carter’s sealed statement', 'landing', learnsInOrder('player', 'forged-letters')],
    [flour, shutterScenes, ({ newRecords }) => newRecords.some(record => record.type === 'flour-dispatched')],
    [unread, 'laneDepart', ({ view }) => !journal(view, 'Guild closure order')],
  ] },
  { id: 'skeptical-investigator', label: 'Skeptical investigator', steps: [
    ['Look around', 'bakehouse'],
    ['Ask Alice about the proclamation', 'bakehouse', ({ state }) =>
      actorContext(state, 'alice').beliefs.some(item => item.topic === 'arthur-death' && item.stance === 'doubts')],
    ['Ask Martin about the proclamation', 'bakehouse', ({ state }) =>
      actorContext(state, 'martin').beliefs.some(item => item.topic === 'arthur-death' && item.stance === 'believes')],
    [market, 'marketTally'],
    ['I say, “Market carter, how do you know where a cart went?”', 'marketTally', directAddress('market-carter')],
    ['Wait for the market tally', 'marketWarning', ({ view }) =>
      journal(view, 'Closure reported at the market')?.status === 'reported' && !journal(view, 'Guild closure order')],
    ['I say, “Guild runner, did you see the oven closed yourself?”', 'marketWarning', directAddress('guild-runner')],
    ['Read the market copy of the order', 'marketNotice', ({ view }) =>
      journal(view, 'Guild closure order')?.supersedes === journal(view, 'Closure reported at the market')?.id
      && journal(view, 'Guild closure order')?.status === 'firsthand'],
    ['I say, “Market baker, when would your oven be free?”', 'marketNotice', directAddress('market-baker')],
    ['Help Alice find another oven', 'marketOven', ({ view }) => Boolean(journal(view, 'Two hours at another oven'))],
  ] },
  { id: 'practical-helper', label: 'Practical helper', steps: [
    [ask('Alice', 'Where does the flour need to go?'), 'bakehouse', directAddress('alice')],
    [landing, 'landing'],
    ['Visit the riverside storehouse', 'guild-storehouse'],
    ['Help the porter sort the tally', 'guild-storehouse', ({ state }) =>
      state.relationships.some(item => item.from === 'guild-porter' && item.to === 'player' && item.trust > 0)],
    ['Ask the porter about the guild tally', 'guild-storehouse', learnsInOrder('player', 'storehouse-tally')],
    [view => {
      const porter = view.observations.find(item => item.source === 'Meeting at the storehouse');
      return ask(porter?.title ?? 'the porter', 'May I see where that mark is entered?');
    }, 'guild-storehouse', directAddress('guild-porter'), ask('the porter', 'May I see where that mark is entered?')],
    ['Return to the Thames landing', 'landing'],
    [flour, shutterScenes, ({ newRecords }) => newRecords.some(record => record.type === 'flour-dispatched')],
    [notice, 'notice', ({ view }) => journal(view, 'Guild closure order')?.status === 'firsthand'],
    ['Offer to help Alice start again', 'firstLight', ({ view }) => Boolean(journal(view, 'Return at first light'))],
  ] },
  { id: 'boundary-pushing', label: 'Boundary-pushing clerk', steps: [
    ['I try to take the ledger, then Go with Alice to the river', 'bakehouse', ({ newRecords, state }) =>
      state.turn?.kind === 'interrupted' && newRecords.some(record => record.type === 'ledger-interruption')
      && !newRecords.some(record => record.type === 'player-action')],
    [martinBefore, 'bakehouse', stillPrivate],
    [ask('Alice', 'Why did you stop me when I reached for the book?'), 'bakehouse', directAddress('alice')],
    [promise, 'bakehouse'],
    [disclose, 'bakehouse', aliceReports],
    ['Tell Martin what Alice said about the Queen', 'bakehouse', clerkToldMartin],
    [martinBefore, 'bakehouse', ({ state, prose }) => martinHasAccount(state) && /clerk[’']s account/iu.test(prose)],
    [ledger, 'guildInspection'],
    ['Return to the bakehouse with the ledger', shutterScenes, ({ newRecords }) => newRecords.some(record =>
      record.type === 'inspection' && record.outcome === 'oven-sealed')],
    [unread, 'laneDepart', ({ view }) => !journal(view, 'Guild closure order')],
  ] },
];

class BenchmarkError extends Error {}

export async function configureMemory() {
  if (!process.env.HINDSIGHT_URL) {
    process.env.HINDSIGHT_API_KEY = (await readFile(
      new URL('../.harbinger/hindsight/api-key', import.meta.url), 'utf8',
    ).catch(() => '')).trim();
    process.env.HINDSIGHT_URL = 'http://127.0.0.1:8888';
  }
  const url = URL.parse(process.env.HINDSIGHT_URL);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new BenchmarkError('Set HINDSIGHT_URL to a valid Hindsight HTTP endpoint.');
  }
  const key = process.env.HINDSIGHT_API_KEY;
  const response = await fetch(url.href.replace(/\/+$/u, '') + '/v1/default/banks', {
    headers: key ? { Authorization: 'Bearer ' + key } : {},
    redirect: 'error', signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!response?.ok) {
    throw new BenchmarkError('Hindsight is unavailable or rejected the configured credentials.');
  }
  await response.body?.cancel();
}

export async function startFixture(directory) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { messages } = JSON.parse(Buffer.concat(chunks));
      const context = JSON.parse(messages.at(-1).content);
      let result;
      if (context.campaignReaction) {
        result = { speech: 'This is what I can answer for, if you will leave the rest with the person who was there. The mark only takes us this far.' };
      } else if (context.campaignNarration) {
        const turn = context.turn ?? context.campaignTurn ?? context.scene?.minute ?? context.chapter ?? 'continuation';
        const line = ['The', 'lantern', 'shines', 'on', 'the', 'ledge', 'while', 'the', 'clerk', 'listens.'];
        const words = count => ['Turn', String(turn), ...Array.from({ length: count }, (_, index) => line[index % line.length])]
          .slice(0, count);
        if (context.parts) {
          const keys = Object.keys(context.parts);
          result = Object.fromEntries(keys.map(key => [key, words(Math.ceil(context.targetWords / keys.length)).join(' ')]));
        } else {
          const body = words(context.targetWords ?? 235);
          result = { paragraphs: Array.from({ length: Math.ceil(body.length / 55) }, (_, index) =>
            body.slice(index * 55, (index + 1) * 55).join(' ')) };
        }
      } else if (context.porterNames && context.signs) {
        result = { porterName: 'Edith', sign: 'Anchor' };
      } else if (context.proposals) {
        result = { avenueId: context.proposals[0]?.id ?? null };
      } else if (context.availableAvenues) {
        result = { avenues: context.availableAvenues.slice(0, 2).map(avenue => ({
          id: avenue.id, trajectory: avenue.premise,
        })) };
      } else if (context.meetingOptions) {
        result = {
          reply: context.replyOptions?.[0]?.id ?? 'Ask me about what I saw, and I will tell you what I can.',
          meetingId: null, ...(context.reactToThreat && { reaction: null }),
        };
      } else if (context.text) {
        result = { intents: [{ type: 'speak', choice: null, actorId: null,
          words: context.text.match(/“([^”]+)”/u)?.[1] ?? context.text }] };
      } else {
        result = { index: 0 };
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }],
      }));
    } catch {
      response.writeHead(400).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const toml = join(directory, 'fixture.toml');
  try {
    await writeFile(toml, ['story', 'state', 'character', 'pacing-director'].map(role => [
      '[covel.' + role + ']', 'provider = "harbinger-startup"', 'model = "fixture"',
      'protocol = "openai-chat-v1"', 'baseUrl = "' + baseUrl + '"',
    ].join('\n')).join('\n\n'));
  } catch (error) {
    server.close();
    throw error;
  }
  return { server, toml, provider: { url: baseUrl + '/chat/completions', name: 'fixture', key: 'fixture' } };
}

function clientAt(url, reportStalls) {
  return async (path, data) => {
    const response = await fetch(url + path, {
      signal: AbortSignal.timeout(reportStalls && path === '/api/actions' ? 310_000 : 120_000),
      ...(data && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    if (!response.ok) {
      const endpoint = path.split('/').at(-1);
      throw new BenchmarkError(endpoint + ' returned HTTP ' + response.status + '.');
    }
    return response;
  };
}

async function submit(call, sessionId, input) {
  const start = performance.now();
  const response = await call('/api/actions', {
    sessionId, requestId: randomUUID(), type: input ? 'submit_actions' : 'start_session',
    payload: input ? { actions: [{ kind: input.actionKind, text: input.action }] } : {},
  });
  let partial = '';
  let commit;
  let roundCommits = 0;
  let executionCommits = 0;
  function inspect(line) {
    if (!line.startsWith('data: ')) return;
    const { type, payload } = JSON.parse(line.slice(6));
    if (type === 'execution.round.completed' && payload?.committed) {
      commit ??= { turnId: payload.turnId, durationMs: Math.round(performance.now() - start) };
      roundCommits += 1;
    }
    if (type === 'execution.completed' && payload?.committed) executionCommits += 1;
  }
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    partial += chunk;
    const lines = partial.split('\n');
    partial = lines.pop();
    for (const line of lines) inspect(line);
  }
  if (partial) inspect(partial);
  if (!commit?.turnId) throw new BenchmarkError('No committed round appeared in the turn stream.');
  return { ...commit, roundCommits, executionCommits };
}

function snapshot(state) {
  const { scene, minute, actors, records, relationships, facts, beliefs, observations, directorTrace, turn } = state;
  return { scene, minute, actors, records, relationships, facts, beliefs, observations, directorTrace, turn };
}

function countWords(prose) {
  return prose.trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

function compactGateway(trace) {
  const calls = {};
  let failures = 0;
  for (const event of trace?.events ?? []) {
    if (event.type === 'gateway.calling') {
      const role = event.payload.presetId ?? 'unknown';
      calls[role] = (calls[role] ?? 0) + 1;
    }
    if (event.type === 'gateway.failed') failures += 1;
  }
  return { calls, failures };
}

async function capture(call, sessionId, commit, input, expectedRevision) {
  const base = '/api/sessions/' + encodeURIComponent(sessionId);
  const [publicData, history, saveReply, trace] = await Promise.all([
    call(base + '/plugin-data/harbinger').then(response => response.json()),
    call(base + '/messages').then(response => response.json()),
    call(base + '/plugin-rpc', { kind: 'action', pluginId: 'harbinger', action: 'capture-save' }).then(response => response.json()),
    call('/api/traces/' + encodeURIComponent(sessionId) + '/turns').then(response => response.json()),
  ]);
  const bundle = saveReply.result?.ok && saveReply.result.data;
  const view = publicData.items.find(item => item.namespace === 'story' && item.key === 'view')?.value;
  if (!bundle?.state || !view) throw new BenchmarkError('Covel did not expose the committed save and its public view.');
  const passages = new Set(publicData.items.filter(item => item.namespace === 'passages').map(item => item.key));
  const stories = history.items.filter(item => item.role === 'assistant' && item.kind === 'story' && item.turnId === commit.turnId);
  const playerActions = history.items.filter(item => item.role === 'user' && item.turnId === commit.turnId);
  const storedActions = playerActions[0]?.actions ?? [];
  const prose = stories[0]?.content ?? '';
  const words = countWords(prose);
  const traced = trace.turns.find(item => item.turnId === commit.turnId);
  const checkedCommit = traced?.events.filter(event => event.type === 'turn.completed' && event.payload.committed).length;
  const savedPassage = bundle.passages.at(-1);
  const checks = {
    exactlyOneCommit: commit.roundCommits === 1 && commit.executionCommits === 1 && checkedCommit === 1,
    exactlyOneStory: stories.length === 1 && words > 0,
    exactlyOneAction: input === null ? playerActions.length === 0
      : playerActions.length === 1 && playerActions[0].content === input.action
        && storedActions.length === 1 && storedActions[0].text === input.action && storedActions[0].kind === input.actionKind,
    savedPassageMatches: view.revision === expectedRevision && bundle.revision === expectedRevision
      && bundle.passages.length === expectedRevision + 1 && savedPassage?.sequence === expectedRevision
      && savedPassage?.paragraphs.join('\n\n') === prose,
    journalSourcesResolve: view.observations.every(item => item.source && passages.has(item.passageId)),
  };
  return { view, state: bundle.state, captured: { ...commit, words, prose, scene: view.scene,
    providerStalls: bundle.state.benchmarkStalls ?? [],
    providerWaits: bundle.state.benchmarkWaits ?? [],
    pacing: bundle.state.benchmarkPacing ?? null,
    saveCount: stories.length, actionSaveCount: playerActions.length, gateway: compactGateway(traced), checks } };
}

async function play(call, plugins, route, profile) {
  const { id, label, steps } = route;
  const style = { id, label, turns: [], ended: false };
  let nextTurn = 0;
  try {
    const { id: sessionId } = await (await call('/api/sessions', {
      worldId, locale: 'en-US', plugins: ['harbinger'],
      excludedPlugins: plugins.filter(plugin => plugin.id !== 'harbinger').map(plugin => plugin.id),
    })).json();
    style.sessionId = sessionId;
    let previous = await capture(call, sessionId, await submit(call, sessionId, null), null, 0);
    style.opening = { ...previous.captured, after: snapshot(previous.state) };
    for (const [index, [input, expectedScene, check, stableAction]] of steps.entries()) {
      const number = index + 1;
      nextTurn = number;
      if (previous.view.ended) throw new BenchmarkError('The story ended before player turn ' + number + '.');
      const originalAction = typeof input === 'function' ? input(previous.view) : input;
      const submitted = profileAction(profile, id, number, originalAction);
      const current = await capture(call, sessionId, await submit(call, sessionId, submitted), submitted, number);
      const newRecords = current.state.records.slice(previous.state.records.length);
      const scenes = Array.isArray(expectedScene) ? expectedScene : [expectedScene];
      const checks = current.captured.checks;
      checks.expectedScene = scenes.includes(current.view.scene.id);
      checks.expectedTerminal = current.view.ended === (number === playerTurnsPerStyle);
      checks.noClarification = !['A moment to decide', 'The story closes'].includes(current.state.passages.at(-1)?.heading);
      checks.routeOutcome = check ? Boolean(check({ state: current.state, view: current.view, before: previous.state,
        newRecords, prose: current.captured.prose })) : true;
      style.turns.push({ ...current.captured, number, scenarioAction: stableAction ?? originalAction, ...submitted,
        before: snapshot(previous.state), after: snapshot(current.state) });
      style.ended = current.view.ended;
      process.stderr.write(profile.id + ' ' + id + ' ' + number + '/' + playerTurnsPerStyle + ' ' + current.captured.words
        + ' words ' + current.captured.durationMs + ' ms\n');
      previous = current;
    }
  } catch (error) {
    style.failure = { turn: nextTurn, message: error instanceof BenchmarkError ? error.message : 'Could not read a committed turn.' };
  }
  style.summary = summarize(style.turns);
  return style;
}

function summarize(turns) {
  const timings = turns.map(turn => turn.durationMs).sort((a, b) => a - b);
  const percentile = ratio => timings.length ? timings[Math.ceil(timings.length * ratio) - 1] : null;
  const checks = {};
  for (const turn of turns) {
    for (const [check, passed] of Object.entries(turn.checks)) if (!passed) checks[check] = (checks[check] ?? 0) + 1;
  }
  return {
    turns: turns.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: timings.at(-1) ?? null,
    minWords: turns.length ? Math.min(...turns.map(turn => turn.words)) : null,
    maxWords: turns.length ? Math.max(...turns.map(turn => turn.words)) : null,
    turnsInWordRange: turns.filter(turn => turn.words >= length.min && turn.words <= length.max).length,
    stalledTurns: turns.filter(turn => turn.providerStalls?.length).length,
    waitedTurns: turns.filter(turn => turn.providerWaits?.length).length,
    pacingCalls: turns.reduce((sum, turn) => sum + (turn.gateway.calls['slot-pacing-director'] ?? 0), 0),
    speechOverlays: turns.filter(turn => turn.speechOverlay).length,
    failedChecks: checks,
  };
}

async function playIsolated(temporary, route, profile, provider, reportStalls) {
  const directory = join(temporary, route.id);
  await mkdir(directory);
  // Covel permits 30 action and 30 plugin RPC posts per minute per server.
  // Each ten-turn playthrough gets an independent game process and database.
  const runtime = launchCovel({ databasePath: join(directory, 'playtest.sqlite'), provider, web: true, reportStalls });
  try {
    const url = await runtime.ready.catch(() => { throw new BenchmarkError('Isolated Covel did not start.'); });
    const call = clientAt(url, reportStalls);
    const [catalog, config] = await Promise.all(['/api/plugins', '/api/llm-config'].map(path =>
      call(path).then(response => response.json())));
    const style = await play(call, catalog.items, route, profile);
    const roles = Object.fromEntries(['character', 'state', 'story', 'pacing-director'].map(role => {
      const slot = config.slots[role];
      return [role, { provider: slot?.provider ?? null, model: slot?.model ?? null }];
    }));
    return { ...style, roles };
  } catch (error) {
    return { id: route.id, label: route.label, turns: [], ended: false,
      failure: { turn: 0, message: error instanceof BenchmarkError ? error.message : 'Could not initialize an isolated style.' } };
  } finally {
    await runtime.stop();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    fixture: { type: 'boolean' }, style: { type: 'string' }, output: { type: 'string' }, parallel: { type: 'boolean' },
    profile: { type: 'string', default: 'active-control' }, 'list-profiles': { type: 'boolean' }, 'report-stalls': { type: 'boolean' },
  } });
  if (values['list-profiles']) {
    console.log(JSON.stringify(playerProfiles.map(({ id, label }) => ({ id, label }))));
    return;
  }
  const profile = playerProfiles.find(item => item.id === values.profile);
  if (!profile) throw new BenchmarkError('Unknown profile. Run with --list-profiles to see the available player styles.');
  const selected = values.style ? routes.filter(route => route.id === values.style) : routes;
  if (!selected.length) throw new BenchmarkError('Unknown style. Choose ' + routes.map(route => route.id).join(', ') + '.');
  if (selected.some(route => route.steps.length !== playerTurnsPerStyle)) throw new BenchmarkError('Each style needs ten player actions.');
  const temporary = await mkdtemp(join(tmpdir(), 'harbinger-novelos-'));
  let localFixture;
  try {
    if (values.fixture) {
      localFixture = await startFixture(temporary);
      process.env.COVEL_LLM_TOML = localFixture.toml;
      process.env.HINDSIGHT_URL = '';
      delete process.env.HINDSIGHT_API_KEY;
    } else await configureMemory();
    const provider = localFixture?.provider ?? providerFromEnvironment();
    if (!provider?.url || !provider?.name) throw new BenchmarkError('Configure HARBINGER_MODEL_URL and HARBINGER_MODEL_NAME.');
    let styles;
    const run = route => playIsolated(temporary, route, profile, provider, values['report-stalls']);
    if (values.parallel) styles = await Promise.all(selected.map(run));
    else {
      styles = [];
      for (const route of selected) styles.push(await run(route));
    }
    const summary = summarize(styles.flatMap(style => style.turns));
    const failures = styles.flatMap(style => style.failure ? [{ styleId: style.id, ...style.failure }] : []);
    const routesPassed = !failures.length && styles.every(style => style.ended && style.turns.length === playerTurnsPerStyle
      && Object.values(style.opening.checks).every(Boolean)) && Object.keys(summary.failedChecks).length === 0;
    const meetsLength = summary.turnsInWordRange === selected.length * playerTurnsPerStyle;
    const meetsLatency = summary.p95Ms !== null && summary.p95Ms <= latencyTargetMs;
    const gatePassed = routesPassed && meetsLatency;
    const roles = styles.find(style => style.roles)?.roles ?? {};
    const generatedAt = new Date().toISOString();
    const report = { formatVersion: 1, generatedAt, worldId, profile: { id: profile.id, label: profile.label }, fixture: Boolean(values.fixture),
      parallel: Boolean(values.parallel), reportStalls: Boolean(values['report-stalls']), hindsightAvailable: !values.fixture, roles, styles, failures,
      summary, targets: { length, p95Ms: latencyTargetMs, turns: selected.length * playerTurnsPerStyle },
      routesPassed, meetsLength, meetsLatency, gatePassed };
    const output = resolve(values.output ?? join('.harbinger', 'playtest', 'novelos-' + profile.id + '-'
      + generatedAt.replace(/[:.]/gu, '-') + '.json'));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ transcripts: output, profile: profile.id, summary, failures, routesPassed, meetsLength, meetsLatency, gatePassed }));
    if (values.fixture ? !routesPassed : !gatePassed) process.exitCode = 1;
  } finally {
    if (localFixture) {
      localFixture.server.closeAllConnections();
      await new Promise(resolveClose => localFixture.server.close(resolveClose));
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof BenchmarkError ? error.message : 'NovelOS playtest harness failed.');
    process.exitCode = 1;
  }
}
