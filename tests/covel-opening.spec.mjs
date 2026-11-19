import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

test('a fresh Covel story commits the free-text turn and its Journal evidence together', async ({ page }) => {
  test.slow();
  const openingLine = 'The proclamation says Arthur died fighting Launcelot overseas.';
  const landingLine = 'On the landing the river has left a line of wet leaves, each one facing downstream.';
  const narrationRequests = [];
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const incoming = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(incoming.messages.at(-1).content);
    let result;
    if ('currentScene' in context || 'candidate' in context) {
      narrationRequests.push(context);
      result = { prose: 'The story model added an unauthored event.' };
    } else if (context.text === 'I head to the river.') result = { intents: [{ type: 'choice', choice: 'Go with Alice to the river' }] };
    else result = { index: 0 };
    const content = JSON.stringify(result);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      id: 'test-prose', object: 'chat.completion', created: 0, model: incoming.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 450, total_tokens: 550 },
    }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  let app;
  try {
    app = await startApp({
      engine: 'covel',
      provider: { url: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, name: 'fixture', key: 'fixture' },
    });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await expect(story.getByRole('article')).toContainText(openingLine);
    const action = page.getByRole('textbox', { name: 'What do you do?' });
    await action.fill('I head to the river.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    const passage = story.getByRole('article').filter({ hasText: landingLine });
    await expect(passage).toHaveCount(1);
    expect(narrationRequests).toEqual([]);

    await app.restart();
    await page.reload();
    await expect(passage).toHaveCount(1, { timeout: 30_000 });
    await expect(passage).toContainText(landingLine);
    await page.getByRole('button', { name: 'Journal' }).click();
    const entry = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Thames landing' }) });
    await entry.getByRole('link', { name: 'View source · Seen at the landing' }).click();
    await expect(passage).toBeFocused();
  } finally {
    if (app) await app.close();
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
  }
});
