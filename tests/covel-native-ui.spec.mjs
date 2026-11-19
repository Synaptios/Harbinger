import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const openingLine = 'Alice lays the delivery book beside the scales.';
const landingLine = 'Six sacks of flour wait on the Thames landing.';
const privateThought = 'I will wait and see what the clerk makes of this.';
const modelParagraph = 'Alice slides the cloth back to the edge of the table. It catches on the wood where a splinter has lifted. She smooths it down with her thumb, takes her hand away, and looks down at her sleeve. There is still flour in the fold. The sound of the last cart carries a little way and then falls away. She waits in the light by the door.';

test('Covel opens The Bread Ledger, plays a turn, and resumes it on reload', async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-covel-ui-'));
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(input.messages.at(-1).content);
    let result;
    if ('candidate' in context) result = { hardFailures: [], editorial: null };
    else if ('currentScene' in context) {
      const line = context.opening ? openingLine : landingLine;
      result = { prose: [line, ...Array(6).fill(modelParagraph)].join('\n\n') };
    } else if (context.text === 'I head to the river.') {
      result = { intents: [{ type: 'choice', choice: 'Go with Alice to the river' }] };
    } else result = { thought: privateThought };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });

  let covel;
  let stopped;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    covel = launchCovel({
      databasePath: join(directory, 'story.sqlite'),
      provider: { url: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, name: 'fixture' },
      port: 0,
      web: true,
    });
    stopped = new Promise(resolve => covel.once('exit', resolve));
    const url = await new Promise((resolve, reject) => {
      covel.once('error', reject);
      covel.once('exit', code => reject(new Error(`Covel exited before starting (${code}).`)));
      covel.on('message', message => {
        if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
      });
    });

    await page.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('covel:settings')) return;
      localStorage.setItem('covel:settings', JSON.stringify({
        schemaVersion: 2, revision: 0, savedAt: new Date().toISOString(),
        entries: { 'ui.appearance': 'panel', 'ui.locale': 'en-US', 'ui.onboardedVersion': 5 },
      }));
    });
    await page.goto(url);
    const world = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'The Bread Ledger', exact: true }),
    });
    await world.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
    await expect(page).toHaveURL(/sid=/u);

    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(openingLine, { exact: true })).toBeVisible({ timeout: 20_000 });

    const composer = page.getByTestId('game-composer-input');
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    await page.getByTestId('composer-mode-act').click();
    await composer.fill('I head to the river.');
    await composer.press('Enter');
    const landing = page.getByText(landingLine, { exact: true });
    await expect(landing).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');

    await page.reload();
    await expect(landing).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    const journal = page.getByRole('tabpanel', { name: 'Journal', exact: true });
    await expect(journal.getByText('Thames landing', { exact: true })).toBeVisible();
    await expect(journal.getByText('Seen at the landing', { exact: true })).toBeVisible();
    await expect(journal.getByText(privateThought, { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Testing view', exact: true }).click();
    const testing = page.frameLocator('iframe[title="Testing view"]').frameLocator('iframe[title="Plugin content"]');
    await expect(testing.getByText(privateThought, { exact: true })).toHaveCount(0);
    await testing.getByRole('button', { name: 'Reveal testing view' }).click();
    await expect(testing.getByText(privateThought, { exact: true }).first()).toBeVisible();
  } finally {
    if (covel && covel.exitCode === null && covel.signalCode === null) covel.kill();
    await stopped;
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
