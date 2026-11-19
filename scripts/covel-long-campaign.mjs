import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { providerFromEnvironment } from '../app/model.mjs';
import { launchCovel } from '../covel/runtime.mjs';
import { hydrateStoredStory, storyChunkNamespace } from '../covel/save-storage.mjs';
import { campaignPlayerAction } from './covel-campaign-profiles.mjs';
import { configureMemory, ready, startFixture } from './covel-novel-eval.mjs';
import { playerProfiles } from './covel-player-profiles.mjs';

const worldId = 'bread-ledger';
const openingVersion = 1;
const targetWords = { min: 200, max: 300 };
const targetLatencyMs = 5_000;
const substantive = passage => !['A moment to decide', 'The story closes'].includes(passage?.heading);
const wordCount = prose => prose.trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
const hash = value => createHash('sha256').update(value).digest('hex');

async function optionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

async function journalAt(path) {
  const text = await optionalText(path);
  const intact = text.slice(0, text.lastIndexOf('\n') + 1);
  const entries = intact.trim() ? intact.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
  const file = await open(path, 'a+');
  if (intact.length !== text.length) await file.truncate(Buffer.byteLength(intact));
  return {
    entries,
    async append(entry) {
      await file.appendFile(JSON.stringify(entry) + '\n');
      await file.sync();
      entries.push(entry);
    },
    close: () => file.close(),
  };
}

async function request(baseUrl, route, data) {
  const response = await fetch(baseUrl + route, {
    ...(route !== '/api/actions' && { signal: AbortSignal.timeout(30_000) }),
    ...(data && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (response.ok) return response;
  await response.body?.cancel();
  const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '1', 10);
  throw Object.assign(new Error(`${route} returned HTTP ${response.status}`), {
    status: response.status,
    retryAfterMs: Math.max(1, retryAfter || 1) * 1_000,
  });
}

async function submit(baseUrl, sessionId, intent) {
  const start = performance.now();
  const response = await request(baseUrl, '/api/actions', {
    sessionId, requestId: intent.requestId, type: intent.number ? 'submit_actions' : 'start_session',
    payload: intent.number ? {
      inputMessageId: intent.inputMessageId, actions: [{ kind: intent.input.actionKind, text: intent.input.action }],
    } : {},
  });
  let durationMs;
  let turnId;
  let roundCommits = 0;
  let executionCommits = 0;
  function inspect(line) {
    if (!line.startsWith('data: ')) return;
    const { type, payload } = JSON.parse(line.slice(6));
    if (type === 'execution.round.completed' && payload?.committed) {
      durationMs ??= Math.round(performance.now() - start);
      turnId ??= payload.turnId;
      roundCommits += 1;
    }
    if (type === 'execution.completed' && payload?.committed) executionCommits += 1;
  }
  let pending = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) inspect(line);
  }
  if (pending) inspect(pending);
  return { durationMs, turnId, roundCommits, executionCommits };
}

function ledger(databasePath, sessionId) {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 4_000 });
  const session = db.prepare('SELECT id, completed_player_turns FROM sessions WHERE id = ?');
  const metadata = db.prepare("SELECT value, updated_at FROM plugin_data WHERE session_id = ? AND plugin_id = 'harbinger' AND namespace = ? AND key = ?");
  const passageKeys = db.prepare("SELECT key FROM plugin_data WHERE session_id = ? AND plugin_id = 'harbinger' AND namespace = 'passages'");
  const message = db.prepare('SELECT role, content, metadata, created_at FROM messages WHERE session_id = ? AND id = ?');
  const opening = db.prepare("SELECT role, content, metadata, created_at FROM messages WHERE session_id = ? AND role = 'assistant' AND json_extract(metadata,'$.kind') = 'story' ORDER BY created_at, seq LIMIT 1");
  const messages = db.prepare("SELECT role, content, metadata, created_at FROM messages WHERE session_id = ? AND json_extract(metadata,'$.turnId') = ?");
  const turns = db.prepare('SELECT created_at, duration_ms, commit_status FROM turn_results WHERE session_id = ? AND turn_id = ?');
  const traces = db.prepare("SELECT type, payload FROM trace_events WHERE session_id = ? AND turn_id = ? AND type IN ('gateway.calling','gateway.failed','turn.completed')");
  const readPluginValue = (namespace, key) => JSON.parse(metadata.get(sessionId, namespace, key)?.value ?? 'null');
  const story = () => hydrateStoredStory(readPluginValue('_hidden.story', 'current'), key => readPluginValue(storyChunkNamespace, key));
  const view = () => JSON.parse(metadata.get(sessionId, 'story', 'view')?.value ?? 'null');
  return {
    session: () => session.get(sessionId),
    story, view,
    receipt(intent) {
      const row = intent.number ? message.get(sessionId, intent.inputMessageId) : opening.get(sessionId);
      const turnId = row && JSON.parse(row.metadata)?.turnId;
      if (!turnId) return null;
      const result = turns.all(sessionId, turnId).filter(turn => turn.commit_status === 'committed');
      if (!result.length) return null;
      return {
        turnId, artifacts: result, saved: story(), view: view(),
        messages: messages.all(sessionId, turnId).map(item => ({ ...item, ...JSON.parse(item.metadata) })),
        trace: traces.all(sessionId, turnId),
      };
    },
    passage: id => JSON.parse(metadata.get(sessionId, 'passages', id)?.value ?? 'null'),
    passageKeys: () => new Set(passageKeys.all(sessionId).map(row => row.key)),
    close: () => db.close(),
  };
}

function recentEvidence(observations) {
  const relevant = new Map();
  for (const item of observations) {
    const key = [item.topic ?? item.title, item.status, item.source, item.recipients?.join(',')].join('|');
    relevant.delete(key);
    relevant.set(key, item);
  }
  return [...relevant.values()].slice(-28);
}

function snapshot(state) {
  const { scene, minute, actors, relationships, facts, beliefs, turn, campaign, pacing } = state;
  const records = state.records.filter(record => ['fact-access', 'fact-report'].includes(record.type));
  records.push(...state.records.filter(record => record.type === 'actor-exchange').slice(-14));
  const observations = recentEvidence(state.observations);
  return { scene, minute, actors, relationships, facts, beliefs, turn, campaign, pacing,
    records, observations, directorTrace: state.directorTrace?.slice(-3) ?? [] };
}

function evidenceBoundary(state) {
  return { recordCount: state.records.length, observationCount: state.observations.length,
    directionCount: state.directorTrace?.length ?? 0, passageCount: state.passages.length };
}

function afterSnapshot(before, boundary, state) {
  const after = snapshot(state);
  after.records = [...before.records, ...state.records.slice(boundary.recordCount)];
  // A pacing report updates the old event's discovery status in place.
  if (state.records.at(-1)?.type === 'pacing-avenue' || state.observations.length > boundary.observationCount) {
    const discoveries = new Set(state.observations.slice(boundary.observationCount)
      .filter(item => item.status === 'reported' && item.topic?.startsWith('pacing:')).map(item => item.topic.slice(7)));
    for (const avenueId of discoveries) {
      const report = state.records.slice(0, boundary.recordCount).findLast(item =>
        item.type === 'pacing-avenue' && item.avenueId === avenueId && item.discovery === 'reported');
      if (report) after.records.push(report);
    }
  }
  after.observations = [...before.observations, ...state.observations.slice(boundary.observationCount)];
  after.directorTrace = [...before.directorTrace, ...(state.directorTrace ?? []).slice(boundary.directionCount)];
  return after;
}

function capture(reader, intent, receipt, stream, startedAt, throttleMs, attempts) {
  const { saved, view, artifacts, trace, turnId } = receipt;
  const stories = receipt.messages.filter(item => item.role === 'assistant' && item.kind === 'story');
  const input = receipt.messages.filter(item => item.role === 'user');
  const prose = stories[0]?.content ?? '';
  const words = wordCount(prose);
  const passage = saved?.state.passages.at(-1);
  const publicPassage = passage && reader.passage(passage.id);
  const calls = {};
  let gatewayFailures = 0;
  let committedTraces = 0;
  for (const event of trace) {
    const payload = JSON.parse(event.payload);
    if (event.type === 'gateway.calling') calls[payload.presetId ?? 'unknown'] = (calls[payload.presetId ?? 'unknown'] ?? 0) + 1;
    if (event.type === 'gateway.failed') gatewayFailures += 1;
    if (event.type === 'turn.completed' && payload.committed) committedTraces += 1;
  }
  const durationMs = stream?.durationMs ?? Math.max(0, Date.parse(stories[0]?.created_at) - startedAt);
  const nativeProse = publicPassage?.paragraphs.map(paragraph => paragraph.replace(/\n{2,}/gu, '\n').trim()).join('\n\n');
  const passageKeys = reader.passageKeys();
  const checks = {
    exactlyOneCommit: artifacts.length === 1 && (!stream?.turnId
      || (stream.turnId === turnId && stream.roundCommits === 1 && stream.executionCommits === 1)),
    exactlyOneStory: stories.length === 1 && words > 0,
    exactlyOneAction: intent.number === 0 ? input.length === 0 : input.length === 1
      && input[0].content === intent.input.action && input[0].actions?.length === 1
      && input[0].actions[0].kind === intent.input.actionKind && input[0].actions[0].text === intent.input.action,
    savedPassageMatches: saved?.revision === intent.number && view?.revision === intent.number
      && publicPassage?.sequence === intent.number && nativeProse === prose,
    journalSourcesResolve: view?.observations.every(item => item.source && passageKeys.has(item.passageId)) ?? false,
    substantive: substantive(passage),
  };
  if (!saved?.state || !view || !Number.isFinite(durationMs)) throw new Error('Incomplete committed Covel turn');
  const result = {
    ...intent.input, campaignTurn: intent.number, turnId, durationMs, prose, words, scene: view.scene,
    saveCount: stories.length, actionSaveCount: input.length, checks, throttleMs, attempts,
    passageBytesMatch: publicPassage?.paragraphs.join('\n\n') === prose,
    timingSource: stream?.durationMs === undefined ? 'persisted-message' : 'turn-stream',
    gateway: { calls, failures: gatewayFailures }, committedTraces,
    providerWaits: saved.state.benchmarkWaits ?? [], providerStalls: saved.state.benchmarkStalls ?? [],
    pacing: saved.state.benchmarkPacing ?? null,
  };
  if (intent.number) {
    result.before = intent.before;
    result.after = afterSnapshot(intent.before, intent.boundary, saved.state);
    result.resolved = saved.state.passages.slice(intent.boundary.passageCount)
      .map(({ id, heading, minute, playerText, paragraphs }) => ({ id, heading, minute, playerText, paragraphs }));
  } else result.after = snapshot(saved.state);
  return result;
}

async function reconcile(baseUrl, sessionId, reader, intent) {
  while (true) {
    const receipt = reader.receipt(intent);
    if (receipt) return receipt;
    const status = await (await request(baseUrl, `/api/sessions/${sessionId}/execution`)).json();
    if (!['running', 'pending', 'paused', 'committing'].includes(status.state)) return reader.receipt(intent);
    await wait(1_000);
  }
}

async function commitIntent(baseUrl, sessionId, reader, journal, intent) {
  const attempts = journal.entries.filter(entry => entry.kind === 'submit' && entry.number === intent.number);
  let startedAt = attempts.at(-1)?.startedAt ?? intent.startedAt;
  let throttleMs = attempts.at(-1)?.throttleMs ?? 0;
  let retryCount = attempts.length;
  let settledFailures = 0;
  let receipt = await reconcile(baseUrl, sessionId, reader, intent);
  if (receipt) return capture(reader, intent, receipt, null, startedAt, throttleMs, retryCount);
  while (true) {
    startedAt = Date.now();
    await journal.append({ kind: 'submit', number: intent.number, startedAt, throttleMs });
    retryCount += 1;
    let stream;
    let failure;
    try {
      stream = await submit(baseUrl, sessionId, intent);
    } catch (error) {
      if (error.status === 429) {
        throttleMs += error.retryAfterMs;
        process.stderr.write(`${intent.profile} native action limit. Waiting ${error.retryAfterMs / 1000}s before turn ${intent.number}.\n`);
        await wait(error.retryAfterMs);
        continue;
      }
      failure = error;
    }
    receipt = await reconcile(baseUrl, sessionId, reader, intent);
    if (receipt) return capture(reader, intent, receipt, stream, startedAt, throttleMs, retryCount);
    if (stream?.turnId) throw new Error('Covel signalled a commit without its durable receipt');
    // A resume can retry a previously failed, uncommitted input after a runtime fix.
    settledFailures += 1;
    if (settledFailures >= 3) throw failure ?? new Error('Covel saved no turn after three settled native attempts in this run');
    await wait(1_000);
  }
}

function intentFor(sessionId, profile, reader, history, number) {
  const requestId = hash(sessionId + ':' + number).slice(0, 32);
  const intent = { kind: 'intent', profile: profile.id, number, requestId, startedAt: Date.now(),
    inputMessageId: hash(sessionId + '\0' + requestId) };
  if (!number) return intent;
  const state = reader.story()?.state;
  const view = reader.view();
  if (!state || !view || view.ended) throw new Error('The campaign has no playable continuation at turn ' + number);
  return {
    ...intent, input: campaignPlayerAction(profile, { view, turn: number, history }),
    before: snapshot(state), boundary: evidenceBoundary(state),
  };
}

async function playProfile(profile, directory, target, first, provider, campaignFlow) {
  const profileDir = join(directory, profile.id);
  await mkdir(profileDir, { recursive: true });
  const journal = await journalAt(join(profileDir, 'turns.ndjson'));
  let child;
  let reader;
  let closed;
  try {
    let header = journal.entries[0];
    if (!header) {
      header = { kind: 'profile', version: openingVersion, profile: profile.id, sessionId: randomUUID() };
      await journal.append(header);
    }
    if (header.profile !== profile.id || header.version !== openingVersion) throw new Error('Incompatible campaign journal.');
    const { sessionId } = header;
    const previous = journal.entries.filter(entry => entry.kind === 'result').map(entry => entry.turn);
    if (previous.some((turn, index) => turn.campaignTurn !== index)) throw new Error('Invalid committed turn sequence.');
    const pending = journal.entries.filter(entry => entry.kind === 'intent').at(-1);
    const existingRoles = journal.entries.find(entry => entry.kind === 'roles')?.roles;
    let roles = existingRoles;
    if (previous.length <= target) {
      const databasePath = join(profileDir, 'playtest.sqlite');
      child = launchCovel({ databasePath, provider, web: true, reportStalls: true, waitForProviders: true });
      closed = new Promise(resolveClose => child.once('close', resolveClose));
      const baseUrl = await ready(child);
      reader = ledger(databasePath, sessionId);
      if (!reader.session()) {
        if (previous.length) throw new Error('The durable campaign database is missing its saved session.');
        const catalog = await (await request(baseUrl, '/api/plugins')).json();
        await request(baseUrl, '/api/sessions', {
          id: sessionId, worldId, locale: 'en-US', plugins: ['harbinger'],
          excludedPlugins: catalog.items.filter(plugin => plugin.id !== 'harbinger').map(plugin => plugin.id),
        });
      }
      const { slots } = await (await request(baseUrl, '/api/llm-config')).json();
      roles = Object.fromEntries(['character', 'state', 'story', 'pacing-director'].map(role => [role, {
        provider: slots[role]?.provider ?? null, model: slots[role]?.model ?? null,
      }]));
      if (!existingRoles) await journal.append({ kind: 'roles', roles });
      if (previous.length && !reader.story()) throw new Error('The durable campaign story was not saved.');
      for (let number = previous.length; number <= target; number++) {
        if (campaignFlow && number === 1 && !reader.view()?.campaign) {
          throw new Error('The native opening did not enter the requested campaign flow.');
        }
        const intent = pending?.number === number ? pending : intentFor(sessionId, profile, reader, previous, number);
        if (intent !== pending) await journal.append(intent);
        const turn = await commitIntent(baseUrl, sessionId, reader, journal, intent);
        await journal.append({ kind: 'result', turn });
        previous.push(turn);
        if (number === 0 || number % 10 === 0) {
          process.stderr.write(`${profile.id} committed turn ${number}/${target} (${turn.words} words, ${turn.durationMs} ms).\n`);
        }
      }
    }
    return {
      id: profile.id, label: profile.label, sessionId, roles, opening: previous[0],
      history: previous.slice(1, first).map(({ campaignTurn, prose, scene }) => ({ number: campaignTurn, prose, scene })),
      turns: previous.slice(first, target + 1).map((turn, index) => ({ ...turn, number: index + 1 })),
    };
  } finally {
    reader?.close();
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (closed) await closed;
    await journal.close();
  }
}

function summarize(turns) {
  const durations = turns.map(turn => turn.durationMs).sort((a, b) => a - b);
  const endToEnd = turns.map(turn => turn.durationMs + turn.throttleMs).sort((a, b) => a - b);
  const failedChecks = {};
  for (const turn of turns) for (const [check, passed] of Object.entries(turn.checks)) {
    if (!passed) failedChecks[check] = (failedChecks[check] ?? 0) + 1;
  }
  return {
    turns: turns.length, minWords: Math.min(...turns.map(turn => turn.words)), maxWords: Math.max(...turns.map(turn => turn.words)),
    turnsInWordRange: turns.filter(turn => turn.words >= targetWords.min && turn.words <= targetWords.max).length,
    p50Ms: durations[Math.ceil(durations.length / 2) - 1], p95Ms: durations[Math.ceil(durations.length * .95) - 1],
    maxMs: durations.at(-1), throttledMs: turns.reduce((total, turn) => total + turn.throttleMs, 0),
    p95WithThrottleMs: endToEnd[Math.ceil(endToEnd.length * .95) - 1],
    waitedTurns: turns.filter(turn => turn.providerWaits.length).length,
    stalledTurns: turns.filter(turn => turn.providerStalls.length).length,
    recoveredTimings: turns.filter(turn => turn.timingSource !== 'turn-stream').length,
    pacingCalls: turns.reduce((sum, turn) => sum + (turn.gateway.calls['slot-pacing-director'] ?? 0), 0),
    failedChecks,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    directory: { type: 'string' }, round: { type: 'string' }, profiles: { type: 'string' },
    fixture: { type: 'boolean' }, 'turns-per-round': { type: 'string' },
    'campaign-flow': { type: 'boolean' },
  } });
  const round = Number(values.round);
  const size = values['turns-per-round'] === undefined ? 100 : Number(values['turns-per-round']);
  const campaignFlow = Boolean(values['campaign-flow']);
  if (!Number.isSafeInteger(round) || round < 1 || round > 5) throw new Error('Choose --round 1–5.');
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new Error('Choose --turns-per-round 1–100.');
  if (!values.directory) throw new Error('Choose an explicit --directory for this durable campaign.');
  const profileNames = values.profiles?.split(',').map(name => name.trim());
  const selected = profileNames ? playerProfiles.filter(profile => profileNames.includes(profile.id)) : playerProfiles;
  if (!selected.length || (profileNames && selected.length !== profileNames.length)) throw new Error('Choose unique known player profiles.');
  const directory = resolve(values.directory);
  await mkdir(directory, { recursive: true });
  const settingsPath = join(directory, 'campaign.json');
  const settings = { formatVersion: openingVersion, fixture: Boolean(values.fixture), turnsPerRound: size,
    ...(campaignFlow && { campaignFlow }) };
  const existing = await optionalText(settingsPath);
  if (!existing) await writeFile(settingsPath, JSON.stringify(settings) + '\n', { flag: 'wx' });
  else if (JSON.stringify(JSON.parse(existing)) !== JSON.stringify(settings)) throw new Error('Campaign settings changed on resume.');
  const roundName = 'round-' + String(round).padStart(2, '0');
  const suffix = selected.length === playerProfiles.length ? '' : '.' + selected.map(profile => profile.id).join('.');
  const output = join(directory, roundName + suffix + '.json');
  const prior = await optionalText(output);
  if (prior) {
    const report = JSON.parse(prior);
    console.log(JSON.stringify({ transcripts: output, summary: report.summary, resumed: true }));
    return;
  }
  const first = (round - 1) * size + 1;
  const target = round * size;
  if (first > 1) {
    for (const profile of selected) {
      const data = await optionalText(join(directory, profile.id, 'turns.ndjson'));
      const committed = data.split('\n').slice(0, -1).map(line => JSON.parse(line))
        .filter(entry => entry.kind === 'result');
      if (committed.length < first) throw new Error(profile.id + ' has not finished the preceding round.');
    }
  }
  let mocked;
  try {
    process.env.HARBINGER_LONG_PROFILE = '1';
    process.env.HARBINGER_CAMPAIGN_FLOW = campaignFlow ? '1' : '';
    if (values.fixture) {
      mocked = await startFixture(directory);
      process.env.COVEL_LLM_TOML = mocked.toml;
      process.env.HINDSIGHT_URL = '';
      delete process.env.HINDSIGHT_API_KEY;
    } else await configureMemory();
    const provider = mocked?.provider ?? providerFromEnvironment();
    const rounds = await Promise.allSettled(selected.map(profile => playProfile(profile, directory, target, first, provider, campaignFlow)));
    const failures = rounds.flatMap((result, index) => result.status === 'rejected'
      ? [{ styleId: selected[index].id, message: result.reason?.message ?? String(result.reason) }] : []);
    if (failures.length) {
      console.error(JSON.stringify({ failures, journalDirectory: directory }));
      process.exitCode = 1;
      return;
    }
    const styles = rounds.map(result => ({ ...result.value, summary: summarize(result.value.turns) }));
    const summary = summarize(styles.flatMap(style => style.turns));
    const report = {
      formatVersion: 1, worldId, generatedAt: new Date().toISOString(), fixture: Boolean(values.fixture),
      campaign: { round, first, target, turnsPerProfile: size, ...(campaignFlow && { campaignFlow }) },
      parallel: true, reportStalls: true,
      styles, summary, failures: [], targets: { length: targetWords, p95Ms: targetLatencyMs, turns: size * styles.length },
    };
    const temporaryOutput = output + '.' + process.pid + '.tmp';
    const outputFile = await open(temporaryOutput, 'wx');
    try {
      await outputFile.writeFile(JSON.stringify(report) + '\n');
      await outputFile.sync();
    } finally {
      await outputFile.close();
    }
    await rename(temporaryOutput, output);
    console.log(JSON.stringify({ transcripts: output, summary }));
  } finally {
    if (mocked) {
      mocked.server.closeAllConnections();
      await new Promise(close => mocked.server.close(close));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
