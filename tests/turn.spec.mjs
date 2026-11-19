import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { startApp } from './app-fixture.mjs';

test('a consequential interruption ends a multi-step turn before the clerk can leave', async ({ request }) => {
  const app = await startApp();
  try {
    const started = await request.post(app.url + '/api/saves', { data: {} });
    const save = await started.json();
    const played = await request.post(`${app.url}/api/saves/${save.id}/turns`, {
      data: { revision: 0, requestId: 'ledger-attempt', text: 'Look around, then take the ledger, then go to the river.' },
    });
    expect(played.ok()).toBeTruthy();
    const result = await played.json();
    expect(result).toMatchObject({ revision: 1, scene: { id: 'bakehouse', minute: 365 }, turn: { kind: 'interrupted' } });
    const latest = result.passages.at(-1);
    expect(latest.paragraphs.join(' ')).toContain('Alice’s hand comes down on the ledger');
    expect(latest.location).toBe('London · Bakehouse lane');
  } finally {
    await app.close();
  }
});

test('retrying after a lost response displays the already committed turn once', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.route('**/api/saves/*/turns', async route => {
      const committed = await route.fetch();
      expect(committed.ok()).toBeTruthy();
      await route.abort();
    }, { times: 1 });
    await page.getByLabel('What do you do?').fill('Look around');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByLabel('What do you do?')).toHaveValue('Look around');
    await page.getByRole('button', { name: 'Retry turn' }).click();
    await expect(page.getByRole('heading', { name: 'A moment to look' })).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'A moment to look' })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('a configured provider interprets a turn from player-visible context', async ({ request }) => {
  let submitted;
  const provider = createServer(async (incoming, response) => {
    let body = '';
    for await (const chunk of incoming) body += chunk;
    submitted = JSON.parse(body);
    if (!submitted.messages.some(message => /\bjson\b/i.test(message.content))) {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"intents":[{"type":"observe"},{"type":"take-ledger"}]}' } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const url = `http://127.0.0.1:${provider.address().port}/chat/completions`;
  const app = await startApp({ provider: { url, name: 'fixture-model' } });
  try {
    const created = await request.post(app.url + '/api/saves', { data: {} });
    const save = await created.json();
    const played = await request.post(`${app.url}/api/saves/${save.id}/turns`, {
      data: { revision: 0, requestId: 'provider-move', text: 'I survey the room before reaching out for the book.' },
    });
    expect(await played.json()).toMatchObject({ revision: 1, turn: { kind: 'interrupted' } });
    expect(submitted.model).toBe('fixture-model');
    expect(JSON.stringify(submitted)).not.toContain('The blue loaf wakes at low tide');
  } finally {
    await app.close();
    await new Promise(resolve => provider.close(resolve));
  }
});

test('reading the order later in the evening does not move the clock backward', async ({ request }) => {
  const app = await startApp();
  try {
    let save = await (await request.post(app.url + '/api/saves', { data: {} })).json();
    for (const [index, text] of ['Go with Alice to the river', 'Help Alice load the flour', 'Look around', 'Read the guild notice'].entries()) {
      const result = await request.post(`${app.url}/api/saves/${save.id}/turns`, {
        data: { revision: save.revision, requestId: 'clock-' + index, text },
      });
      expect(result.ok()).toBeTruthy();
      save = await result.json();
    }
    expect(save.scene).toMatchObject({ id: 'notice', minute: 1082 });
  } finally {
    await app.close();
  }
});

test('reloading after a lost acknowledgement restores the saved turn without a duplicate draft', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.route('**/api/saves/*/turns', async route => {
      const committed = await route.fetch();
      expect(committed.ok()).toBeTruthy();
      await route.abort();
    }, { times: 1 });
    await page.getByLabel('What do you do?').fill('Look around');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry turn' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'A moment to look' })).toHaveCount(1);
    await expect(page.getByLabel('What do you do?')).toHaveValue('');
  } finally {
    await page.close();
    await app.close();
  }
});
