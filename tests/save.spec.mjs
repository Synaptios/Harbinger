import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startApp } from './app-fixture.mjs';

test('copies the current save and leaves the original open until the player chooses another save', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Save library' });
    await library.getByRole('button', { name: 'Duplicate current save' }).click();
    await expect(library.getByRole('status')).toHaveText('Created The Bread Ledger (copy).');
    await expect(library.getByRole('button', { name: 'The Bread Ledger', exact: true })).toHaveAttribute('aria-current', 'true');
    await library.getByRole('button', { name: 'The Bread Ledger (copy)', exact: true }).click();
    await expect(library).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();

    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await library.getByRole('button', { name: 'The Bread Ledger', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Help Alice load the flour' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('exports a labeled complete save and continues it on a clean installation', async ({ page }) => {
  const source = await startApp();
  const clean = await startApp();
  try {
    await page.goto(source.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Save library' });
    const download = page.waitForEvent('download');
    await library.getByRole('link', { name: 'Export complete save (includes hidden state)' }).click();
    const bundle = await readFile(await (await download).path());
    expect(bundle.toString()).toContain('The blue loaf wakes at low tide.');

    await page.goto(clean.url);
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await library.getByLabel('Import complete save').setInputFiles({
      name: 'portable-save.json', mimeType: 'application/json', buffer: bundle,
    });
    await expect(library.getByRole('status')).toHaveText('Imported The Bread Ledger.');
    await library.getByRole('button', { name: 'The Bread Ledger', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
  } finally {
    await Promise.all([clean.close(), source.close()]);
  }
});

test('shares a readable story without hidden details or private notes', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    const [save] = await (await page.request.get(app.url + '/api/saves')).json();
    await expect(await page.request.put(app.url + '/api/saves/' + save.id + '/notes', {
      data: { note: 'My private note about the flour.' },
    })).toBeOK();
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export shareable story' }).click({ timeout: 2500 }),
    ]);
    const story = await readFile(await download.path(), 'utf8');
    expect(story).toContain('The Bread Ledger');
    expect(story).toContain('A carter folds a tarpaulin over the last sack.');
    expect(story).not.toContain('The blue loaf wakes at low tide.');
    expect(story).not.toContain('My private note about the flour.');
  } finally {
    await app.close();
  }
});

test('duplicates the accepted revision after an in-flight turn settles', async ({ request }) => {
  const interpreting = Promise.withResolvers();
  const settle = Promise.withResolvers();
  const model = {
    async complete({ operation }) {
      if (operation !== 'interpret') return undefined;
      interpreting.resolve();
      return settle.promise;
    },
  };
  const app = await startApp({ model });
  try {
    const created = await request.post(app.url + '/api/saves', { data: {} });
    await expect(created).toBeOK();
    const save = await created.json();
    const url = app.url + '/api/saves/' + save.id;
    const turn = request.post(url + '/turns', {
      data: { text: 'I pause to take in my surroundings.', revision: save.revision, requestId: randomUUID() },
    });
    await interpreting.promise;
    const duplicate = request.post(url + '/duplicate', { data: {} });
    await expect.poll(async () => (await (await request.get(app.url + '/api/saves')).json()).length,
      { timeout: 1000 }).toBe(1);
    settle.resolve([{ type: 'observe' }]);

    const [acceptedResponse, duplicateResponse] = await Promise.all([turn, duplicate]);
    await expect(acceptedResponse).toBeOK();
    await expect(duplicateResponse).toBeOK();
    const accepted = await acceptedResponse.json();
    const copy = await duplicateResponse.json();
    expect(accepted.revision).toBe(save.revision + 1);
    expect(copy.id).not.toBe(save.id);
    expect(copy).toMatchObject({ revision: accepted.revision, passages: accepted.passages });
  } finally {
    settle.resolve([{ type: 'observe' }]);
    await app.close();
  }
});

test('portable saves preserve private notes and reject malformed imports without adding a save', async ({ request }) => {
  const app = await startApp();
  try {
    const endpoint = app.url + '/api/saves';
    const original = await (await request.post(endpoint, { data: {} })).json();
    const originalUrl = endpoint + '/' + original.id;
    const note = 'Keep the flour route private.';
    await expect(await request.put(originalUrl + '/notes', { data: { note } })).toBeOK();
    const bundle = await (await request.get(originalUrl + '/export')).json();
    const bad = { ...bundle, state: { ...bundle.state, passages: [{ paragraphs: ['Not a full passage.'] }] } };
    expect((await request.post(endpoint + '/import', { data: bad })).status()).toBe(400);
    expect(await (await request.get(endpoint)).json()).toMatchObject([{ id: original.id }]);

    const restored = await (await request.post(endpoint + '/import', { data: bundle })).json();
    const duplicate = await (await request.post(originalUrl + '/duplicate', { data: {} })).json();
    for (const save of [restored, duplicate]) {
      const notes = await request.get(endpoint + '/' + save.id + '/notes');
      await expect(notes).toBeOK();
      expect(await notes.json()).toEqual({ note });
    }
    await expect(await request.put(endpoint + '/' + duplicate.id + '/notes', { data: { note: 'Different copy.' } })).toBeOK();
    expect(await (await request.get(originalUrl + '/notes')).json()).toEqual({ note });
  } finally {
    await app.close();
  }
});

test('restores inspector metadata only when its optional fields have a usable shape', async ({ request }) => {
  const app = await startApp();
  try {
    const endpoint = app.url + '/api/saves';
    let original = await (await request.post(endpoint, { data: {} })).json();
    const originalUrl = endpoint + '/' + original.id;
    for (const text of ['Go with Alice to the river', 'Help Alice load the flour']) {
      const turn = await request.post(originalUrl + '/turns', {
        data: { text, revision: original.revision, requestId: randomUUID() },
      });
      await expect(turn).toBeOK();
      original = await turn.json();
    }
    const bundle = await (await request.get(originalUrl + '/export')).json();
    const { thoughts, directorTrace, ...legacyState } = bundle.state;
    expect(thoughts.length).toBeGreaterThan(0);
    expect(directorTrace.length).toBeGreaterThan(0);

    for (const patch of [
      { thoughts: 'not an array' },
      { thoughts: [{ ...thoughts[0], sources: null }] },
      { directorTrace: {} },
      { directorTrace: [{ ...directorTrace[0], reason: 42 }] },
    ]) {
      const response = await request.post(endpoint + '/import', { data: { ...bundle, state: { ...bundle.state, ...patch } } });
      expect(response.status()).toBe(400);
    }
    expect(await (await request.get(endpoint)).json()).toMatchObject([{ id: original.id }]);

    const current = await request.post(endpoint + '/import', { data: bundle });
    await expect(current).toBeOK();
    const restored = await current.json();
    expect(await (await request.get(endpoint + '/' + restored.id + '/testing')).json())
      .toEqual(await (await request.get(originalUrl + '/testing')).json());
    await expect(await request.post(endpoint + '/import', { data: { ...bundle, state: legacyState } })).toBeOK();
  } finally {
    await app.close();
  }
});
