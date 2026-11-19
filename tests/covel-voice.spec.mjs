import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');
test.use({ locale: 'en-US' });

const opening = 'A crier’s voice carries through the flour dust.';
const action = 'I ask Alice about tomorrow.';
const workLine = 'Not while the oven needs minding. Ask again when the last loaf is out.';
const privateThought = 'I can let them take the flour. I cannot let them read the names.';
const rejected = 'This rejected draft is held for assessment.';
const nativeOpening = 'A lantern shivers on the old pier.';
function testWave() {
  const wave = Buffer.alloc(32_044);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8_000, 24);
  wave.writeUInt32LE(16_000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  return wave;
}

test('committed Bread Ledger speech is detached, cast-voiced, and opt-in for playback', async ({ page, request }) => {
  test.setTimeout(65_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-voice-'));
  const requests = [];
  let rejectNext = false;
  let failClip = true;
  let releaseSpeech;
  const waitForRelease = new Promise(resolve => { releaseSpeech = resolve; });
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === '/v1/audio/speech') {
      requests.push(input);
      await waitForRelease;
      if (input.input === workLine && failClip) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end('{"error":{"message":"Fixture could not render this clip"}}');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'audio/wav' }).end(testWave());
      return;
    }

    const submit = input.tools?.find(tool => tool.function?.name === 'submit-output');
    if (submit) {
      const args = JSON.stringify({ segments: [{ kind: 'narration', text: nativeOpening },
        { kind: 'dialogue', speaker: 'Unrevealed speaker', text: 'Is anyone there?' }] });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [delta, finish_reason] of [
        [{ role: 'assistant', tool_calls: [{ index: 0, id: 'narrated-scene', type: 'function', function: { name: submit.function.name, arguments: args } }] }, null],
        [{}, 'tool_calls'],
      ]) {
        response.write(`data: ${JSON.stringify({
          id: 'speech-story-fixture', object: 'chat.completion.chunk', created: 0, model: input.model,
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
      return;
    }
    const context = JSON.parse(input.messages.findLast(message => message.role === 'user').content);
    let output;
    if (input.model === 'fixture-harbinger-safety') output = { approved: !context.text.includes(rejected) };
    else if ('candidate' in context) output = { hardFailures: [], editorial: null };
    else if ('currentScene' in context) output = { prose: rejected };
    else if ('words' in context) output = rejectNext ? { reply: rejected, meetingId: 'invalid' } : { reply: workLine, meetingId: null };
    else if ('situation' in context) output = { index: 0 };
    else output = { intents: [{ type: 'speak', choice: null, words: context.text, actorId: 'alice' }] };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }));
  });

  let covel;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const origin = `http://127.0.0.1:${provider.address().port}`;
    const config = join(directory, 'models.toml');
    await writeFile(config, ['story', 'character', 'state', 'harbinger-safety', 'speech'].map(slot => [
      `[covel.${slot}]`, 'provider = "harbinger-startup"', `model = "fixture-${slot}"`,
      `baseUrl = "${origin}/v1"`, 'protocol = "openai-chat-v1"',
      ...(slot === 'speech' ? ['tag = "speech"', 'output = ["audio"]'] : []),
    ].join('\n')).join('\n\n'));
    const previousConfig = process.env.COVEL_LLM_TOML;
    process.env.COVEL_LLM_TOML = config;
    try {
      covel = launchCovel({
        databasePath: join(directory, 'story.sqlite'),
        provider: { url: `${origin}/v1/chat/completions`, name: 'fixture-story', key: 'fixture-key' },
        web: true,
      });
    } finally {
      if (previousConfig === undefined) delete process.env.COVEL_LLM_TOML;
      else process.env.COVEL_LLM_TOML = previousConfig;
    }
    const url = await covel.ready;
    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(),
        entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US' },
      }));
    });
    await page.goto(url);
    const world = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'The Bread Ledger', exact: true }) });
    await world.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(opening, { exact: false })).toBeVisible();
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    await expect.poll(() => requests.find(input => input.input.includes(opening)))
      .toMatchObject({ model: 'fixture-speech', voice: 'Dennis', response_format: 'wav' });
    releaseSpeech();

    const composer = page.getByTestId('game-composer-input');
    await composer.fill(action);
    await composer.press('Enter');
    await expect(page.getByText(workLine, { exact: false })).toBeVisible();
    await expect.poll(() => requests.find(input => input.input === workLine)).toMatchObject({ voice: 'Ashley' });
    expect(requests.every(input => !input.input.includes(privateThought))).toBe(true);
    expect(requests.some(input => input.voice === 'Dennis' && input.input.includes('Alice says,'))).toBe(true);

    await page.getByRole('tab', { name: 'Narration', exact: true }).click();
    const narrator = page.getByRole('tabpanel', { name: 'Narration', exact: true });
    const retry = narrator.getByRole('button', { name: 'Retry narration for passage 2' });
    await expect(narrator.getByText('Passage 2 · 3 clips', { exact: true })).toBeVisible();
    await expect(retry).toBeVisible();
    failClip = false;
    const beforeRetry = requests.length;
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(requests.slice(beforeRetry).map(({ input }) => input)).toEqual([workLine]);
    await expect(narrator.getByRole('button', { name: 'Enable continuous narration' })).toBeVisible();
    await expect.poll(() => narrator.locator('audio').evaluateAll(players =>
      players.every(player => player.paused),
    )).toBe(true);
    await narrator.getByRole('button', { name: 'Enable continuous narration' }).click();
    await expect.poll(() => narrator.locator('audio').evaluateAll(players =>
      players.some(player => !player.paused),
    )).toBe(true);
    await expect(narrator.getByText('Narrator · Clip 1 of 3', { exact: true })).toBeVisible();
    await expect(narrator.getByText('Alice · Clip 2 of 3', { exact: true })).toBeVisible();
    await narrator.getByRole('button', { name: 'Disable continuous narration' }).click();
    await expect.poll(() => narrator.locator('audio').evaluateAll(players =>
      players.every(player => player.paused),
    )).toBe(true);
    await page.reload();
    await page.getByRole('tab', { name: 'Narration', exact: true }).click();
    await expect(narrator.getByRole('button', { name: 'Enable continuous narration' })).toBeVisible();
    await expect(narrator.getByRole('button', { name: 'Replay passage 2' })).toBeEnabled();
    await expect(narrator.locator('audio')).toHaveCount(0);

    rejectNext = true;
    await composer.fill('I ask Alice if the flour got wet.');
    await composer.press('Enter');
    await expect(narrator.getByRole('button', { name: 'Replay passage 3' })).toBeEnabled();
    expect(requests.every(input => !input.input.includes(rejected) && !input.input.includes(privateThought))).toBe(true);

    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    await page.getByRole('group', { name: 'Menu', exact: true }).getByRole('button', { name: /^Settings/u }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'Narration', exact: true }).click();
    const automatic = settings.getByRole('switch', { name: 'Generate narration automatically' });
    await expect(automatic).toHaveAttribute('aria-checked', 'true');
    await automatic.click();
    await expect(automatic).toHaveAttribute('aria-checked', 'false');
    const narratorVoice = settings.getByRole('textbox', { name: 'Narrator voice' });
    await narratorVoice.fill('Olivia');
    await narratorVoice.press('Enter');
    await page.keyboard.press('Escape');

    const sessionId = new URL(page.url()).searchParams.get('sid');
    async function finishedAutomaticJobs() {
      const response = await request.get(`${url}/api/sessions/${sessionId}/runtime-jobs`);
      const jobs = (await response.json()).items;
      return jobs.filter(job => job.runtimeId === 'harbinger-voice/synthesize' && job.status === 'succeeded').length;
    }
    const jobsBefore = await finishedAutomaticJobs();
    const callsBefore = requests.length;
    await composer.fill('I ask Alice where she leaves the bread.');
    await composer.press('Enter');
    await expect.poll(finishedAutomaticJobs).toBe(jobsBefore + 1);
    expect(requests).toHaveLength(callsBefore);
    await narrator.getByRole('button', { name: 'Generate latest passage' }).click();
    await expect.poll(() => requests.slice(callsBefore).some(input => input.voice === 'Olivia')).toBe(true);
    await expect(narrator.getByRole('button', { name: 'Replay passage 4' })).toBeEnabled();

    const worldResponse = await request.post(`${url}/api/worlds`, {
      data: { name: 'Harbor Lights', description: 'A quiet harbor at nightfall.', locale: 'en-US' },
    });
    expect(worldResponse.ok()).toBeTruthy();
    const { id: worldId } = await worldResponse.json();
    const catalog = await (await request.get(`${url}/api/plugins`)).json();
    const plugins = ['narrator', 'harbinger-voice'];
    const sessionResponse = await request.post(`${url}/api/sessions`, {
      data: { worldId, locale: 'en-US', plugins, excludedPlugins: catalog.items.map(plugin => plugin.id).filter(id => !plugins.includes(id)) },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const { id: nativeSessionId } = await sessionResponse.json();
    const nativeTurn = await request.post(`${url}/api/actions`, {
      data: { sessionId: nativeSessionId, type: 'start_session', requestId: randomUUID(), payload: {} },
    });
    expect(await nativeTurn.text()).toContain('"committed":true');
    await expect.poll(() => requests.find(input => input.input.includes(nativeOpening))).toMatchObject({
      voice: 'Dennis', input: `${nativeOpening}\n\nIs anyone there?`,
    });
  } finally {
    releaseSpeech();
    await covel?.stop();
    await new Promise(resolve => provider.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
