import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const fixture = [
  'Light falls over the boards at a slant, showing the scratches left by a rough edge of the baker’s peel. Alice wipes the flour from the place where the ledger lies. She sets a small brass weight against the cover and moves the scales to make room for it.',
  'Martin keeps one hand on the ledger as he speaks. When he says dusk, a cart wheel sounds from the lane and he waits for it to pass. His own copy of the guild’s tally lies folded near the edge of the table, beside a bowl left to catch the wax.',
  'The lane beyond the window smells of smoke. A pair of hands has mended the shutter with wood that does not match. Through a gap in the new board a line of light cuts straight across the table. For a moment the mark on the ledger looks brighter than its paper.',
].join('\n\n');
const passageText = `${fixture}\n\n${fixture}\n\n${fixture}`;

async function withRecoveryApp(run, { rejectFirstPlayerTurn = false, interpret } = {}) {
  let failPlayerTurn = rejectFirstPlayerTurn;
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const responses = typeof payload.input === 'string';
    const context = JSON.parse(responses ? payload.input : payload.messages[1].content);
    if (context.currentScene && !context.candidate && !context.opening && failPlayerTurn) {
      failPlayerTurn = false;
      response.writeHead(503);
      return response.end();
    }
    let output = { prose: passageText };
    if (context.candidate) output = { hardFailures: [], editorial: null };
    if (context.actor) output = { thought: 'I have to weigh this flour first.' };
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

test('a provider outage still commits the turn and a lost acknowledgement recovers on reload', async ({ page }) => {
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
  }, { rejectFirstPlayerTurn: true });
});

test('ambiguous speech commits a clarification without guessing who the player addressed', async ({ page }) => {
  test.slow();
  await withRecoveryApp(async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    const input = page.getByRole('textbox', { name: 'What do you do?' });
    const draft = 'I ask, “Are you coming with me?”';
    await input.fill(draft);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('article').last()).toContainText('Who would you like to address, and what would you like to say aloud?');
    await expect(page.getByRole('button', { name: 'Retry turn' })).toBeHidden();
    await expect(input).toHaveValue('');
    await expect(story.getByRole('article')).toHaveCount(2);
    await expect(page.locator('#scene-location')).toContainText('Bakehouse lane');
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
