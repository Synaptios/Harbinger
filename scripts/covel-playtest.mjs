import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { startApp } from '../tests/app-fixture.mjs';

const key = process.env.HARBINGER_MODEL_KEY || process.env.OPENAI_API_KEY;
if (!key) throw new Error('Set the OpenAI API key in the process environment.');

const model = 'gpt-6.2-sol';
const reasoningEffort = 'medium';
const direct = 'https://api.openai.com/v1/responses';
const relayKey = randomUUID();
const calls = [];
const drafts = new Map();
const pairs = [];
const comparisons = [];
const attempts = [];
const routes = [
  {
    name: 'River and closure order',
    moves: [
      ['Look around', 'Quiet exchange'],
      ['I ask Alice, “Will you come to supper after you’re finished here?”', 'Unexpected invitation'],
      ['Promise Alice discretion'],
      ['Ask Alice what brought Guenever to London'],
      ['Keep Alice’s confidence'],
      ['Go with Alice to the river'],
      ['Ask Alice about your promise', 'Delayed callback'],
      ['Help Alice load the flour'],
      ['Read the guild notice'],
      ['Offer to help Alice start again', 'Meaningful consequence'],
    ],
  },
  {
    name: 'Leave the guild with the ledger',
    moves: [
      ['Take the ledger to Martin'],
      ['Return to the bakehouse with the ledger', 'Refusal and departure'],
      ['Leave the guild notice unread'],
    ],
  },
];
const onlyRefusal = process.argv.includes('--refusal');
const onlyAftermath = process.argv.includes('--aftermath');
const checkpoint = onlyRefusal ? process.env.HARBINGER_PLAYTEST_REFUSAL_SAVE : process.env.HARBINGER_PLAYTEST_AFTERMATH_SAVE;
if (onlyAftermath && (!checkpoint || onlyRefusal)) throw new Error('Use --aftermath with a shutter checkpoint.');
if (checkpoint && !onlyRefusal && !onlyAftermath) throw new Error('Choose the route that corresponds to the checkpoint.');
let selectedRoutes = routes;
if (onlyRefusal) selectedRoutes = [{ ...routes[1], moves: routes[1].moves.slice(checkpoint ? 1 : 0) }];
if (onlyAftermath) selectedRoutes = [{ ...routes[0], moves: routes[0].moves.slice(-2) }];

function outputObject(envelope) {
  const output = (envelope.output ?? []).flatMap(item => item.type === 'message' ? item.content : [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('');
  try { return JSON.parse(output); } catch { return null; }
}

async function generate(payload, arm) {
  const started = performance.now();
  const response = await fetch(direct, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.text();
  const envelope = JSON.parse(body);
  const output = outputObject(envelope);
  const operation = payload.text?.format?.name;
  const call = {
    arm, operation, status: response.status, model: envelope.model,
    ms: Math.round(performance.now() - started), usage: envelope.usage,
    ...(response.ok ? {} : { code: envelope.error?.code ?? envelope.error?.type }),
    ...(operation === 'harbinger_review' && { findings: output?.hardFailures?.map(finding => finding.kind), editorial: output?.editorial?.kind }),
  };
  calls.push(call);
  console.log(JSON.stringify({ modelCall: operation, status: call.status, ms: call.ms, findings: call.findings, editorial: call.editorial }));
  return { body, output, status: response.status };
}

const relay = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses' || request.headers.authorization !== `Bearer ${relayKey}`) {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    if (payload.text?.format?.name === 'harbinger_passage') {
      const context = JSON.parse(payload.input);
      drafts.set(context.playerInput, payload);
    }
    const result = await generate(payload, 'covel');
    response.writeHead(result.status, { 'Content-Type': 'application/json' });
    response.end(result.body);
  } catch {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end('{"error":{"code":"playtest_relay_failed"}}');
  }
});

async function compare(label, passage) {
  const original = drafts.get(passage.playerText);
  if (!original) return;
  const { sceneBrief, ...grounding } = JSON.parse(original.input);
  const input = JSON.stringify({ ...grounding, resolution: sceneBrief?.resolution ?? [] });
  const instructions = original.instructions.split('\n\nEditorial rubric')[0];
  const text = { format: { ...original.text.format, name: 'harbinger_single_pass' } };
  const result = await generate({ ...original, input, instructions, text }, 'baseline');
  pairs.push({ label, action: passage.playerText, covel: passage.paragraphs.join('\n\n'), baseline: result.output?.prose ?? null });
}

async function play(app, route, initial) {
  let save = initial;
  for (const [text, label] of route.moves) {
    const requestId = randomUUID();
    const started = performance.now();
    let advanced = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(`${app.url}/api/saves/${save.id}/turns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, revision: save.revision, requestId }),
      });
      const next = await response.json();
      advanced = response.ok && next.revision === save.revision + 1;
      const passage = advanced ? next.passages.at(-1) : null;
      const words = passage?.paragraphs.join(' ').trim().split(/\s+/u).length;
      const outcome = {
        route: route.name, text, attempt, status: response.status, advanced, words,
        ms: Math.round(performance.now() - started), clarification: next.clarification ?? next.message,
        scene: next.scene?.id,
      };
      attempts.push(outcome);
      console.log(JSON.stringify(outcome));
      if (advanced) {
        save = next;
        if (label) comparisons.push(compare(label, passage).catch(() => { pairs.push({ label, baseline: null }); }));
        break;
      }
      if (response.ok || response.status < 500) break;
    }
    if (!advanced) {
      const error = attempts.findLast(item => item.route === route.name);
      if (label !== 'Quiet exchange' && label !== 'Unexpected invitation') {
        return { name: route.name, ended: false, lastScene: save.scene.id, stoppedAt: error.text, passages: save.passages };
      }
    }
  }
  return { name: route.name, ended: save.ended, lastScene: save.scene.id, passages: save.passages, observations: save.observations };
}

relay.listen(0, '127.0.0.1');
await once(relay, 'listening');
let app;
try {
  app = await startApp({ engine: 'covel', provider: {
    url: `http://127.0.0.1:${relay.address().port}/v1/responses`, name: model, key: relayKey, reasoningEffort,
  } });
  const started = performance.now();
  const response = await fetch(app.url + (checkpoint ? '/api/saves/import' : '/api/saves'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: checkpoint ? await readFile(checkpoint) : '{}',
  });
  const opened = await response.json();
  if (!response.ok) throw Error('Covel opening failed with HTTP ' + response.status);
  const checkpointScene = onlyRefusal ? 'guildInspection' : 'shutter';
  if (checkpoint && opened.scene.id !== checkpointScene) throw Error('The checkpoint is from the wrong scene');
  const opening = {
    ms: Math.round(performance.now() - started), words: opened.passages[0].paragraphs.join(' ').trim().split(/\s+/u).length,
    restored: Boolean(checkpoint),
  };
  console.log(JSON.stringify({ opening }));

  const startingSaves = [opened];
  if (selectedRoutes.length === 2) {
    const forkResponse = await fetch(`${app.url}/api/saves/${opened.id}/duplicate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!forkResponse.ok) throw Error('Covel duplicate failed with HTTP ' + forkResponse.status);
    startingSaves.push(await forkResponse.json());
  }
  const played = await Promise.all(selectedRoutes.map((route, index) => play(app, route, startingSaves[index])));
  await Promise.all(comparisons);
  const directory = resolve('.harbinger', 'playtest');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `covel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(path, JSON.stringify({ model, reasoningEffort, opening, played, attempts, pairs, calls }, null, 2));
  console.log(`Playtest evidence saved to ${path}`);
  const expectedPairs = selectedRoutes.flatMap(route => route.moves).filter(([, label]) => label).length;
  if (played.some(route => !route.ended) || pairs.filter(pair => pair.baseline).length !== expectedPairs) process.exitCode = 1;
} finally {
  await Promise.allSettled(comparisons);
  if (app) await app.close();
  await new Promise(resolve => { relay.close(resolve); relay.closeAllConnections(); });
}
