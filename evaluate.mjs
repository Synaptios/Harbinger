import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildContext, createGame, playTurn } from './engine.mjs';
import { makeProviders } from './providers.mjs';
import { makeServer } from './server.mjs';

const actions = [
  'Ask Ysra about the Reed Lantern. What does the pattern mean?',
  'Walk to the Salt Office.',
  'Ask Nera about the Reed Lantern. Did the keeper die there?',
  'Examine the Salt Office ledger for berth four.',
  'Give Nera Voss the red packet and keep a receipt if she offers one.',
  'Examine my receipt in the light by the stove.',
  'Look around the Salt Office and listen to the people waiting.',
  'Stand by the stove for a moment and watch the street.',
  'Walk out to the Salt Causeway.',
  'Examine the causeway stones closely.',
  'Return to Floodgate Quay.',
  'Ask Ysra what she said two short flashes and one long meant.',
  'Take the ferry to the Reed Lantern and offer my brass token as fare.',
  'Examine the lantern mechanism to find the source of the flashes.',
  'Call down from the lantern and wait for a reply.',
  'Return to Floodgate Quay.',
  'Take the ferry to the Reed Lantern. Try paying with the same brass ferry token again.',
  'Walk to the Salt Office.',
  'Ask Nera about the packet I brought earlier, and whether I still owe her anything.',
  'Ask Nera whether the lantern mechanism can tell us what happened to the keeper.',
];

const detours = [
  'Walk out to the Salt Causeway.',
  'Watch the tide around the causeway stones.',
  'Wait, and listen for signs of anyone coming.',
  'Walk to the Salt Office.',
  'Check my pockets for the brass ferry token and the red packet.',
  'Return to Floodgate Quay.',
  'Look around the quay for signs of the tide turning.',
  'Ask Ysra what two short flashes and one long meant, and how she knows.',
  'Walk to the Salt Office.',
  'Ask Nera whether the packet delivery is still outstanding.',
];

const options = parseArgs({
  options: {
    model: { type: 'string', multiple: true },
    turns: { type: 'string', default: '20' },
    trace: { type: 'boolean', default: false },
  },
}).values;
const total = Number(options.turns);
if (![20, 50, 100].includes(total)) throw new Error('Choose --turns 20, 50, or 100.');
const models = options.model ?? ['demo'];
const providers = makeProviders();
const catalog = providers.catalog();
for (const model of models) {
  if (!catalog.models.find((entry) => entry.id === model && entry.available)) {
    throw new Error(`Model ${model} is unavailable. Check the server credentials and model catalog.`);
  }
}

async function listen(dataDir) {
  const server = await makeServer({ dataDir, providers });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    async request(path, body, status = 200) {
      const init = body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      };
      const response = await fetch(base + path, init);
      const payload = await response.json();
      assert.equal(response.status, status, payload.error ?? path);
      return payload;
    },
  };
}

function checkpoints(game) {
  const has = (collection, id) => collection.some((entry) => entry.id === id);
  const resolved = (id) => game.threads.some((entry) => entry.id === id && entry.status === 'resolved');
  return {
    attributedSecondAccount: has(game.claims, 'ysra-lantern-claim')
      && game.claims.some((entry) => /nera/i.test(entry.speaker) && /death|died|dead|vacant/i.test(entry.text)),
    deliveryResolved: resolved('deliver-packet'),
    packetSpent: !has(game.inventory, 'red-packet'),
    tokenSpent: !has(game.inventory, 'ferry-token'),
    receiptHeld: game.inventory.some((entry) => /receipt/i.test(entry.name)),
    lanternMechanismObserved: game.facts.some((entry) => /shutter|lantern/i.test(entry.text)
      && /float|mechanism|wheel|pulley|counterweight|crank/i.test(entry.text)),
  };
}

async function replay(model) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bellwether-replay-'));
  let api;
  try {
    api = await listen(dataDir);
    let { game } = await api.request('/api/games', {}, 201);
    const path = `/api/games/${game.id}`;
    for (let index = 0; index < total; index += 1) {
      const action = actions[index] ?? detours[(index - actions.length) % detours.length];
      const turn = { action, model, revision: index, requestId: randomUUID() };
      ({ game } = await api.request(`${path}/turns`, turn));
      assert.equal(game.revision, index + 1);
      if (index === 0 && model === 'demo') {
        const replayed = await api.request(`${path}/turns`, turn);
        assert.deepEqual(replayed.game, game);
        const stale = await api.request(`${path}/turns`, { ...turn, requestId: randomUUID() }, 409);
        assert.equal(stale.code, 'revision_conflict');
      }
      if (index === 10) {
        await api.close();
        api = await listen(dataDir);
        const resumed = await api.request(path);
        assert.deepEqual(resumed.game, game, 'Save survives server restart');
        const persisted = JSON.parse(await readFile(join(dataDir, `${game.id}.json`), 'utf8'));
        const context = buildContext(persisted, actions[11]);
        if (model === 'demo') {
          assert(context.relevantEarlierTurns.some((entry) => entry.number === 1),
            'The old signal explanation is retrieved after leaving the recent window');
          assert(context.reportedClaims.some(({ id, sourceTurn }) => id === 'ysra-berth-code' && sourceTurn === 1));
        }
      }
    }

    const checks = checkpoints(game);
    if (model === 'demo') {
      for (const [name, passed] of Object.entries(checks)) assert(passed, name);
      assert.match(game.turns[17].narration, /number four in the box/i);
      assert.match(game.turns[19].narration, /you owe me nothing/i);
      assert.equal(game.turns.length, total + 1);
    }
    const metrics = game.turns.slice(1).map((turn) => turn.metrics);
    const report = {
      model, turns: total, checks,
      reviewTurns: { signalCallback: 12, repeatedFare: 17, deliveryCallback: 19 },
      retries: metrics.reduce((sum, turn) => sum + turn.attempts - 1, 0),
      recordedTokens: metrics.flatMap((turn) => turn.usage ?? []).reduce((sum, usage) => sum + usage.totalTokens, 0),
      medianMs: metrics.map((metric) => metric.durationMs).sort((a, b) => a - b)[Math.floor(total / 2)],
    };
    if (options.trace || model !== 'demo') {
      const dir = new URL('./eval-results/', import.meta.url);
      await mkdir(dir, { recursive: true });
      const trace = new URL(`${game.id}.json`, dir);
      await writeFile(trace, JSON.stringify({ report, game }, null, 2), { mode: 0o600 });
      report.trace = trace.pathname;
    }
    return report;
  } finally {
    if (api) await api.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function verifyRejectedChanges() {
  const game = createGame();
  const original = structuredClone(game);
  const empty = { narration: 'A gull lands.', suggestions: [], scene: null,
    facts: [], claims: [], threads: [], cast: [], gain: [], spend: [] };
  const request = { action: 'I look around.', model: 'fixture', requestId: randomUUID() };
  let attempts = 0;
  const result = await playTurn(game, request, { generate: async ({ input }) => {
    attempts += 1;
    if (attempts === 1) return { output: { ...empty, spend: ['unheld-crown'] } };
    assert.match(JSON.parse(input).repair, /Cannot spend unheld item/);
    return { output: empty };
  } });
  assert.equal(result.revision, 1);
  assert.equal(result.turns.at(-1).metrics.attempts, 2);
  await assert.rejects(playTurn(game, request, {
    generate: async () => ({ output: { ...empty,
      claims: [{ id: 'unattributed', speaker: 'absent-person', text: 'The gates are closed.' }] } }),
  }), { code: 'invalid_turn' });
  assert.deepEqual(game, original, 'Rejected changes leave the save untouched');
}

await verifyRejectedChanges();
for (const model of models) {
  try {
    console.log(JSON.stringify(await replay(model)));
  } catch (error) {
    console.error(`${model}: ${error.message}`);
    process.exitCode = 1;
  }
}
