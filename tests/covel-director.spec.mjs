import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');
test.use({ locale: 'en-US' });

test('State Ultra bounds extra proposals and the director stages a missed inspection from eligible choices', async ({ page, request }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-director-'));
  const received = [];
  let rejectDecision = false;
  const provider = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    received.push(body);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (incoming.url.endsWith('/decisions')) {
      const choice = rejectDecision ? 'unlisted' : 'inspection-sealed-shutter';
      response.end(JSON.stringify({ model: 'fixture-jev', answers: {
        opportunity: { type: 'choice', choice },
      } }));
      return;
    }
    const input = body.messages.findLast(message => message.role === 'user')?.content;
    const context = typeof input === 'string' && input.startsWith('{') ? JSON.parse(input) : {};
    const result = body.model === 'fixture-gemma' ? { focus: 'evidence' }
      : 'porterNames' in context ? { porterName: 'Edith', sign: body.model === 'fixture-quoted-gemini' ? 'Anchor' : 'Willow' }
        : 'situation' in context ? { thought: 'I will count the sacks before dusk.' } : {};
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });
  let covel;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const origin = `http://127.0.0.1:${provider.address().port}`;
    const configPath = join(directory, 'llm.toml');
    const slots = {
      story: 'fixture-story', character: 'fixture-character', state: 'fixture-state', 'state-ultra': 'fixture-state',
      staging: 'fixture-gemma', 'state-complex': 'fixture-gemini', triggers: 'fixture-jev',
      'quoted-complex': 'fixture-quoted-gemini',
    };
    await writeFile(configPath, Object.entries(slots).map(([slot, model]) =>
      `[covel.${slot}]\nprovider = "harbinger-startup"\nmodel = "${model}"\nbaseUrl = "${origin}/v1"\nprotocol = "${slot === 'triggers' ? 'openrouter-decisions-v1' : 'openai-chat-v1'}"\n`,
    ).join('\n'));
    const priorConfig = process.env.COVEL_LLM_TOML;
    process.env.COVEL_LLM_TOML = configPath;
    try {
      covel = launchCovel({ databasePath: join(directory, 'story.sqlite'),
        provider: { url: `${origin}/v1/chat/completions`, name: 'fixture-story', key: 'fixture-key' }, web: true });
    } finally {
      if (priorConfig === undefined) delete process.env.COVEL_LLM_TOML;
      else process.env.COVEL_LLM_TOML = priorConfig;
    }
    const url = await covel.ready;
    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({ schemaVersion: 2, revision: 0,
        savedAt: new Date().toISOString(), entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US' } }));
    });
    async function session() {
      await page.goto(`${url}/session`);
      const world = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'The Bread Ledger', exact: true }) });
      await world.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 6_000 });
      await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
      await expect(page).toHaveURL(/sid=/u);
      const id = new URL(page.url()).searchParams.get('sid');
      await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
      await expect.poll(async () => (await request.get(`${url}/api/sessions/${id}/plugin-data/harbinger/story/view`)).status()).toBe(200);
      return id;
    }
    async function action(sessionId, text, headers) {
      const response = await request.post(`${url}/api/actions`, { headers, data: {
        sessionId, requestId: randomUUID(), type: 'submit_actions', payload: { actions: [{ kind: 'say', text }] },
      } });
      const events = await response.text();
      expect(response.ok(), events).toBe(true);
      expect(events).toMatch(/"committed":true/u);
    }
    async function read(id) {
      const response = await request.get(`${url}/api/sessions/${id}/plugin-data/harbinger/story/view`);
      expect(response.ok()).toBe(true);
      return (await response.json()).value;
    }

    const id = await session();
    await action(id, 'Go with Alice to the river');
    expect(received.some(body => body.model === 'fixture-jev')).toBe(false);
    const ultra = Buffer.from(JSON.stringify({ slotBindings: {
      state: { presetId: 'slot-state-ultra' }, 'state-complex': { presetId: 'slot-quoted-complex' },
    } })).toString('base64');
    await action(id, 'Visit the riverside storehouse', { 'X-Slot-Config': ultra });
    expect((await read(id)).scene.heading).toBe('Anchor Storehouse');
    expect(received.some(body => body.model === 'fixture-quoted-gemini')).toBe(true);

    await action(id, 'Return to the Thames landing');
    await action(id, 'Help Alice load the flour');
    const view = await read(id);
    expect(view.scene.heading).toBe('The sealed shutter');
    expect(view.choices).toContain('Read the guild notice');
    expect(view.observations.some(note => note.title === 'Guild closure order')).toBe(false);
    const decision = received.find(body => body.model === 'fixture-jev');
    expect(Object.keys(decision.questions.opportunity.criteria)).toEqual(['inspection-at-bakehouse', 'inspection-sealed-shutter']);
    expect(received.some(body => body.model === 'fixture-gemma')).toBe(true);

    rejectDecision = true;
    const fallback = await session();
    await action(fallback, 'Go with Alice to the river');
    await action(fallback, 'Help Alice load the flour');
    expect((await read(fallback)).scene.heading).toBe('A key at dusk');
  } finally {
    await covel?.stop();
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
