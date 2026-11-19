import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel suite with HARBINGER_TEST_COVEL=1.');

const resolveCli = promisify(execFile);
const privateFixtureDetail = 'A token from the private provider response';

async function verifyLineup({ requireLength = false, candidateOnly = false, badOpening = false, overlapThoughts = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-voyage-gate-'));
  let openingThoughts = 0;
  const { promise: bothThoughts, resolve: startThoughts } = Promise.withResolvers();
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(messages.at(-1).content);
    let object;
    if ('meetingOptions' in context) object = { reply: 'I have to mind the loaf before I can answer you.', meetingId: null };
    else if ('choices' in context) object = { intents: [{ type: 'speak', choice: null, words: context.text, actorId: 'alice' }] };
    else {
      if (overlapThoughts && openingThoughts < 2) {
        const order = ++openingThoughts;
        if (order === 2) startThoughts();
        await bothThoughts;
        // Force completions to arrive in the opposite order from their requests.
        await delay(order === 1 ? 120 : 60);
      }
      object = badOpening ? { thought: privateFixtureDetail } : { index: 0 };
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(object) }, finish_reason: 'stop' }] }));
  });
  let reportFiles;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
    const [candidate, previous] = await Promise.all(['candidate', 'previous'].map(async name => {
      const path = join(directory, `${name}.toml`);
      const slots = ['story', 'character', 'state'].map(slot =>
        `[covel.${slot}]\nprovider = "harbinger-startup"\nmodel = "fixture-${name}"\nbaseUrl = "${endpoint}"\nprotocol = "openai-chat-v1"`);
      await writeFile(path, slots.join('\n\n'));
      return path;
    }));
    const result = await resolveCli(process.execPath,
      ['scripts/covel-voyage-playtest.mjs', ...(candidateOnly ? ['--candidate-only'] : []), ...(requireLength ? ['--require-length'] : [])], {
        env: { ...process.env, HARBINGER_MODEL_URL: `${endpoint}/chat/completions`, HARBINGER_MODEL_NAME: 'fixture-previous',
          HARBINGER_MODEL_KEY: 'fixture-key', HARBINGER_VOYAGE_CANDIDATE_TOML: candidate, HARBINGER_VOYAGE_PREVIOUS_TOML: previous },
      }).then(({ stdout }) => ({ stdout, code: 0 }), ({ stdout, code }) => ({ stdout, code }));
    const printed = result.stdout.split('\n').find(line => line.startsWith('{"metrics":'));
    expect(printed).toBeTruthy();
    reportFiles = JSON.parse(printed);
    return { code: result.code, ...JSON.parse(await readFile(reportFiles.metrics, 'utf8')) };
  } finally {
    await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
    if (reportFiles) await Promise.all([unlink(reportFiles.metrics), unlink(reportFiles.prose)]);
  }
}

test('the optional length gate identifies short passages even when every turn saves', async () => {
  const result = await verifyLineup({ requireLength: true, candidateOnly: true });
  const [candidate] = result.arms;
  expect(candidate.measurements).toHaveLength(5);
  expect(candidate.measurements.map(turn => turn.checks.traceConfirmsCommit)).toEqual(Array(5).fill(true));
  expect(result.gatePassed).toBe(false);
  expect(result.code).toBe(1);
});

test('the grounded gate checks the distinct saves and no second Story call', async () => {
  const result = await verifyLineup();
  const [previous, candidate] = result.arms;
  expect(previous.measurements[0].words).toBeGreaterThanOrEqual(200);
  expect(previous.measurements[0].words).toBeLessThanOrEqual(300);
  expect(candidate.measurements).toHaveLength(5);
  expect(candidate.measurements.every(turn => turn.checks.groundedNarration)).toBe(true);
  expect(result.gatePassed).toBe(true);
  expect(result.code).toBe(0);
});

test('the test report identifies a failed provider envelope without storing its contents', async () => {
  const result = await verifyLineup({ candidateOnly: true, badOpening: true });
  const [opening] = result.arms[0].measurements;
  expect(opening.checks.traceConfirmsCommit).toBe(true);
  expect(opening.usage.gatewayFailures).toContainEqual({ method: 'generateObject', kind: 'schema' });
  expect(JSON.stringify(result)).not.toContain(privateFixtureDetail);
});

test('timings distinguish overlapping provider work from elapsed turn time', async () => {
  const result = await verifyLineup({ candidateOnly: true, overlapThoughts: true });
  const [opening] = result.arms[0].measurements;
  expect(result.gatePassed).toBe(true);
  const { calls, providerWallMs, providerWorkMs, overlapMs } = opening.criticalPath;
  const thoughts = calls.filter(call => call.stage === 'character');
  expect(thoughts).toHaveLength(2);
  expect(thoughts[0].startMs).toBeLessThan(thoughts[1].endMs);
  expect(thoughts[1].startMs).toBeLessThan(thoughts[0].endMs);
  expect(providerWorkMs).toBeGreaterThan(providerWallMs);
  expect(overlapMs).toBe(providerWorkMs - providerWallMs);
  expect(providerWallMs).toBeLessThanOrEqual(opening.ms + 10);
  expect(JSON.stringify(opening.criticalPath)).not.toContain('I need to watch the oven.');
});
