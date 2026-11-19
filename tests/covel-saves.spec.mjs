import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const privateThought = 'I must put the Tower carter’s tally back before Martin comes.';
const paragraph = `In the lane beyond the open door a child crouches to tie a loose cord on one shoe. An empty barrow passes and she has to stand up before she has finished. The sound of its wheel stays in the room for a moment. Alice lifts the edge of the folded paper on the table just high enough to see how many lines are already filled. Low down on the wood, under the mark of an old nail, there is a streak of clay somebody has brought in from the river.`;
const prose = Array.from({ length: 5 }, () => paragraph).join('\n\n');

async function withCovelProvider(run, { beforePassage } = {}) {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const responses = typeof body.input === 'string';
    const context = JSON.parse(responses ? body.input : body.messages[1].content);
    if (context.currentScene && !context.candidate) await beforePassage?.(context.currentScene);
    const result = context.actor ? { thought: privateThought }
      : context.candidate ? { hardFailures: [], editorial: null } : { prose };
    const text = JSON.stringify(result);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(responses
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
      : { choices: [{ message: { content: text } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const opened = [];
  try {
    await run(async () => {
      const app = await startApp({
        engine: 'covel',
        provider: { url: `http://127.0.0.1:${provider.address().port}/v1/responses`, name: 'fixture' },
      });
      opened.push(app);
      return app;
    });
  } finally {
    await Promise.all(opened.map(app => app.close()));
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
  }
}

test('a Covel import rejects malformed knowledge records before adding a save', async ({ request }) => {
  await withCovelProvider(async start => {
    const app = await start();
    const saves = `${app.url}/api/saves`;
    const created = await request.post(saves, { data: {} });
    expect(created.status()).toBe(201);
    const save = await created.json();
    const exported = await request.get(`${saves}/${save.id}/export`);
    const bundle = await exported.json();

    for (const badRecord of [{ type: 'fact-access', minute: 360 }, { type: 'fact-report', minute: 360 }]) {
      const malformed = structuredClone(bundle);
      malformed.state.records.push(badRecord);
      const response = await request.post(`${saves}/import`, { data: malformed });
      expect(response.status()).toBe(400);
    }
    expect(await (await request.get(saves)).json()).toEqual([expect.objectContaining({ id: save.id })]);
  });
});

test('a copied Covel save can take a different next action without moving the original', async ({ page }) => {
  test.slow();
  await withCovelProvider(async start => {
    const app = await start();
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    const openSaves = page.getByRole('button', { name: 'Saves' });
    const library = page.getByRole('dialog', { name: 'Save library' });

    await openSaves.click();
    const original = library.getByRole('button', { name: 'The Bread Ledger', exact: true });
    await expect(original).toHaveAttribute('aria-current', 'true');
    await library.getByRole('button', { name: 'Duplicate current save' }).click();
    await expect(library.getByRole('status')).toHaveText('Created The Bread Ledger (copy).');
    await expect(original).toHaveAttribute('aria-current', 'true');
    const copy = library.getByRole('button', { name: 'The Bread Ledger (copy)', exact: true });
    await copy.click();
    await story.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();

    await openSaves.click();
    await expect(copy).toHaveAttribute('aria-current', 'true');
    await original.click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toHaveCount(0);
    await expect(story.getByRole('heading', { name: 'Alice’s bakehouse' })).toBeVisible();
    await story.getByRole('button', { name: 'Take the ledger to Martin' }).click();
    await expect(story.getByRole('heading', { name: 'The last entry' })).toBeVisible();

    await openSaves.click();
    await copy.click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await expect(story.getByRole('heading', { name: 'The last entry' })).toHaveCount(0);
  });
});

test('a complete Covel export restores privately while the shareable story stays player-visible', async ({ page }) => {
  test.slow();
  await withCovelProvider(async start => {
    const source = await start();
    const destination = await start();
    const note = 'Remember the unshared tally at the door.';
    await page.goto(source.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await story.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();

    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page.getByLabel('Private notes')).toBeEnabled();
    await page.getByLabel('Private notes').fill(note);
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.getByRole('status', { name: 'Notes status' })).toHaveText('Notes saved.');
    await page.getByRole('button', { name: 'Close Journal' }).click();

    const library = page.getByRole('dialog', { name: 'Save library' });
    await page.getByRole('button', { name: 'Saves' }).click();
    const download = async name => {
      const response = page.waitForEvent('download');
      await library.getByRole('link', { name }).click();
      return readFile(await (await response).path());
    };
    const complete = await download('Export complete save (includes hidden state)');
    expect(complete.toString()).toContain(privateThought);
    expect(complete.toString()).toContain(note);
    const shared = (await download('Export shareable story')).toString();
    expect(shared).toContain('Thames landing');
    expect(shared).toContain(paragraph);
    expect(shared).not.toContain(privateThought);
    expect(shared).not.toContain(note);

    await page.goto(destination.url);
    await page.getByRole('button', { name: 'Saves' }).click();
    const fileInput = library.getByLabel('Import complete save');
    await expect(fileInput).toBeEnabled();
    const importSave = buffer => fileInput.setInputFiles({
      name: 'bread-ledger.json', mimeType: 'application/json', buffer,
    });
    await importSave(Buffer.from(JSON.stringify({ ...JSON.parse(complete), version: 0 })));
    await expect(library.getByRole('status')).toContainText('Choose a valid Harbinger complete save for Covel.');
    const restored = library.getByRole('button', { name: 'The Bread Ledger', exact: true });
    await expect(restored).toHaveCount(0);
    await importSave(complete);
    await expect(library.getByRole('status')).toHaveText('Imported The Bread Ledger.');
    await restored.click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await expect(story.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page.getByLabel('Private notes')).toHaveValue(note);
    await page.getByRole('button', { name: 'Close Journal' }).click();
    await page.getByRole('button', { name: 'Testing view' }).click();
    const testing = page.getByRole('dialog', { name: 'Testing view' });
    await testing.getByRole('button', { name: 'Reveal private thoughts' }).click();
    await expect(testing).toContainText(privateThought);
    await page.keyboard.press('Escape');
    await story.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(story.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
  });
});

async function expectPoliteStatus(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#status' });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    expect(nodes[0].role.value).toBe('status');
    expect(nodes[0].properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'live', value: expect.objectContaining({ value: 'polite' }) }),
      expect.objectContaining({ name: 'atomic', value: expect.objectContaining({ value: true }) }),
    ]));
  } finally {
    await cdp.detach();
  }
}

for (const width of [320, 1280]) {
  test(`read, consult the Journal, and finish a portable Covel run at ${width}px`, async ({ page }) => {
    test.slow();
    let releaseTurn;
    const pause = new Promise(resolve => { releaseTurn = resolve; });
    await withCovelProvider(async start => {
      try {
        const source = await start();
        await page.setViewportSize({ width, height: 800 });
        await page.goto(source.url);
        await page.getByRole('button', { name: 'Begin story' }).press('Enter');
        const story = page.getByRole('region', { name: 'Story passage' });
        await expect(story).toBeVisible({ timeout: 30_000 });
        const composer = page.getByRole('textbox', { name: 'What do you do?' });
        const continueTurn = page.getByRole('button', { name: 'Continue', exact: true });
        await composer.fill('Take the ledger to Martin');
        await continueTurn.press('Enter');
        await expect(page.getByRole('status').filter({ hasText: 'Resolving the turn…' })).toBeVisible();
        await expectPoliteStatus(page);
        await expect(story.getByRole('article')).toHaveCount(1);
        await expect(composer).toHaveValue('Take the ledger to Martin');
        releaseTurn();

        const guild = story.getByRole('article').filter({ has: page.getByRole('heading', { name: 'The last entry' }) });
        await expect(guild).toBeVisible();
        await composer.fill('I still need to speak with Alice.');
        const journalToggle = page.getByRole('button', { name: 'Journal', exact: true });
        await journalToggle.press('Enter');
        const journal = page.getByRole(width === 320 ? 'dialog' : 'complementary', { name: 'Journal' });
        await journal.getByRole('link', { name: 'View source · Seen at the guild room' }).press('Enter');
        await expect(guild).toBeFocused();
        await expect(composer).toHaveValue('I still need to speak with Alice.');
        if (width === 320) {
          await journalToggle.focus();
          const position = await page.evaluate(() => window.scrollY);
          expect(position).toBeGreaterThan(0);
          await page.keyboard.press('Enter');
          await expect(journal).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(journal).toBeHidden();
          await expect(journalToggle).toBeFocused();
          expect(await page.evaluate(() => window.scrollY)).toBe(position);
        } else {
          await journal.getByRole('button', { name: 'Close Journal' }).press('Enter');
          await expect(journalToggle).toBeFocused();
        }

        await composer.fill('Return to the bakehouse with the ledger');
        await continueTurn.press('Enter');
        await expect(story.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
        const library = page.getByRole('dialog', { name: 'Save library' });
        await page.getByRole('button', { name: 'Saves' }).press('Enter');
        const download = page.waitForEvent('download');
        await library.getByRole('link', { name: 'Export complete save (includes hidden state)' }).press('Enter');
        const complete = await readFile(await (await download).path());

        const destination = await start();
        await page.goto(destination.url);
        await page.getByRole('button', { name: 'Saves' }).press('Enter');
        const fileInput = library.getByLabel('Import complete save');
        await expect(fileInput).toBeEnabled();
        await fileInput.setInputFiles({ name: 'bread-ledger.json', mimeType: 'application/json', buffer: complete });
        const restored = library.getByRole('button', { name: 'The Bread Ledger', exact: true });
        await expect(restored).toBeEnabled();
        await restored.press('Enter');
        await expect(story.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
        await story.getByRole('button', { name: 'Read the guild notice' }).press('Enter');
        await story.getByRole('button', { name: 'Offer to help Alice start again' }).press('Enter');
        await expect(story.getByRole('heading', { name: 'The price of flour' })).toBeVisible();
        await expect(continueTurn).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      } finally {
        releaseTurn();
      }
    }, { beforePassage: scene => scene.heading === 'The last entry' ? pause : undefined });
  });
}
