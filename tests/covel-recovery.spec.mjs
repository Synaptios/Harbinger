import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

async function withRecoveryApp(run, { interpret } = {}) {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const responses = typeof payload.input === 'string';
    const context = JSON.parse(responses ? payload.input : payload.messages[1].content);
    let output = {};
    if (context.actor && context.words) output = { reply: 'I have to weigh this flour first.', meetingId: null };
    if (context.actor && context.options) output = { index: 0 };
    if (context.audience) {
      output = { intents: interpret?.(context) ?? [{ type: 'speak', words: 'Are you coming with me?', actorId: null }] };
    }
    response.setHeader('Content-Type', 'application/json');
    const content = JSON.stringify(output);
    response.end(JSON.stringify(responses
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
      : { choices: [{ message: { content } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  let app;
  try {
    app = await startApp({
      engine: 'covel',
      provider: { url: `http://127.0.0.1:${provider.address().port}/v1/responses`, name: 'fixture' },
    });
    await run(app);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
  }
}

test('a committed turn with a lost acknowledgement recovers on reload', async ({ page }) => {
  test.slow();
  await withRecoveryApp(async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    const input = page.getByRole('textbox', { name: 'What do you do?' });
    await page.route('**/api/saves/*/turns', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort();
    }, { times: 1 });
    await input.fill('Take the ledger to Martin');
    await page.getByRole('button', { name: 'Continue' }).click();
    const retry = page.getByRole('button', { name: 'Retry turn' });
    await expect(retry).toBeVisible();
    await page.reload();
    await expect(story.getByRole('heading', { name: 'The last entry' })).toHaveCount(1);
    await expect(story.getByRole('article')).toHaveCount(2);
    await expect(story.getByRole('article').last()).toContainText('Martin sets a finger beside the delivery column.');
    await expect(input).toHaveValue('');
    await expect(retry).toBeHidden();
  });
});

test('ambiguous speech commits one clarification with a replayable receipt', async ({ page }) => {
  test.slow();
  await withRecoveryApp(async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    const input = page.getByRole('textbox', { name: 'What do you do?' });
    const draft = 'I ask, “Are you coming with me?”';
    const clarification = 'Who would you like to address, and what would you like to say aloud?';
    await input.fill(draft);
    const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/turns'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('article').last()).toContainText(clarification);
    await expect(page.getByRole('button', { name: 'Retry turn' })).toBeHidden();
    await expect(input).toHaveValue('');
    await expect(story.getByRole('article')).toHaveCount(2);
    await expect(page.locator('#scene-location')).toContainText('Bakehouse lane');

    const turn = await submitted;
    const payload = turn.postDataJSON();
    const receiptUrl = new URL('./receipt', turn.url());
    receiptUrl.searchParams.set('requestId', payload.requestId);
    const receipt = await page.request.get(receiptUrl.href);
    expect(await receipt.json()).toEqual({ committed: true });
    const replay = await page.request.post(turn.url(), { data: payload });
    expect(replay.ok()).toBe(true);
    const save = await replay.json();
    expect(save.revision).toBe(payload.revision + 1);
    expect(save.passages).toHaveLength(2);
    expect(save.passages.at(-1).paragraphs.join(' ')).toContain(clarification);

    await input.fill('Go with Alice to the river');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await expect(story.getByRole('article')).toHaveCount(3);
  });
});

test('an unclear later action keeps the earlier resolved move and its Journal evidence', async ({ page }) => {
  test.slow();
  await withRecoveryApp(async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    const input = page.getByRole('textbox', { name: 'What do you do?' });
    await input.fill('Go with Alice to the river, then do the usual thing.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('article').last()).toContainText('What would you like to try here?');
    await expect(story.getByRole('article')).toHaveCount(2);
    await expect(page.locator('#scene-location')).toContainText('Thames landing');
    await expect(input).toHaveValue('');
    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing', exact: true })).toBeVisible();
  }, {
    interpret: () => [{ type: 'choice', choice: 'Go with Alice to the river' }, { type: 'unclear' }],
  });
});
