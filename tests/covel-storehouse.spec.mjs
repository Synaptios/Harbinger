import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const storehouseTally = 'The guild tallies each sack by its mark before putting it on a shelf.';
const supperInvitation = 'Will you come to supper when your work is done?';
const supperReply = 'You spared me a second count. I still have marks to check.';

async function withStorehouseProvider(getAppearance, run, dialoguePrompts = []) {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(payload.input);
    let result;
    switch (payload.text.format.name) {
      case 'harbinger_storehouse':
        result = getAppearance();
        break;
      case 'harbinger_interpret':
        result = { intents: [context.text.includes(supperInvitation)
          ? { type: 'speak', actorId: context.audience.find(actor => actor.name === 'Thomas')?.id, words: supperInvitation }
          : { type: 'choice', choice: 'Cross to Dover' }] };
        break;
      case 'harbinger_actor_reply':
        dialoguePrompts.push(context);
        result = {
          reply: context.evidence.some(item => item.topic === 'storehouse-help' && item.status === 'firsthand')
            ? supperReply : 'I have to finish the count.',
          meetingId: null,
        };
        break;
      default:
        result = { index: 0 };
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    }));
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

test('the Covel story discovers an allowed storehouse and remembers its porter after restart', async ({ page }) => {
  test.slow();
  let appearance = { porterName: 'Thomas', sign: 'Sedge' };
  const dialoguePrompts = [];
  await withStorehouseProvider(() => appearance, async app => {
    const press = name => page.getByRole('button', { name, exact: true }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await page.goto(app.url);
    await press('Begin story');
    await press('Go with Alice to the river');
    await press('Visit the riverside storehouse');
    const visit = story.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Sedge Storehouse' }) });
    await expect(visit).toContainText('Thomas, the guild porter');
    await expect(visit).not.toContainText(storehouseTally);

    await press('Journal');
    const journal = page.getByRole('complementary', { name: 'Journal' });
    const porterEntry = journal.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Thomas' }) });
    await porterEntry.getByRole('link', { name: 'View source · Meeting at the storehouse' }).click();
    await expect(visit).toBeFocused();
    await press('Close Journal');
    await press('Help the porter sort the tally');
    await expect(story.getByRole('heading', { name: 'A sorted tally' })).toBeVisible();

    appearance = { porterName: 'Edith', sign: 'Anchor' };
    await app.restart();
    await page.reload();
    await press('Return to the Thames landing');
    await press('Visit the riverside storehouse');
    const latest = story.getByRole('article').last();
    await expect(latest.getByRole('heading', { name: 'Sedge Storehouse' })).toBeVisible();
    await expect(latest).toContainText('Thomas remembers your help with the tally.');
    await expect(latest).not.toContainText('Edith');

    await page.getByRole('textbox', { name: 'What do you do?' }).fill(`Thomas, “${supperInvitation}”`);
    await press('Continue');
    await expect(latest.getByRole('heading', { name: 'A word with Thomas' })).toBeVisible();
    await expect(latest).toContainText(supperReply);
    await expect(latest).not.toContainText(storehouseTally);
    expect(dialoguePrompts.at(-1).evidence).toContainEqual(expect.objectContaining({
      topic: 'storehouse-help', source: 'Counted with the porter at the storehouse', status: 'firsthand',
    }));
    expect(JSON.stringify(dialoguePrompts.at(-1).evidence)).not.toContain(storehouseTally);

    await press('Ask the porter about the guild tally');
    await expect(latest).toContainText(storehouseTally);
    await press('Journal');
    await expect(journal.getByText(storehouseTally)).toBeVisible();
  }, dialoguePrompts);
});

test('a proposal beyond the storehouse slot leaves its only route and local knowledge intact', async ({ page }) => {
  test.slow();
  const invalid = { porterName: 'Thomas', sign: 'Sedge', connections: ['Dover'], facts: ['The Tower carter’s password.'] };
  await withStorehouseProvider(() => invalid, async app => {
    const press = name => page.getByRole('button', { name, exact: true }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await page.goto(app.url);
    await press('Begin story');
    await press('Go with Alice to the river');
    await press('Visit the riverside storehouse');
    const latest = story.getByRole('article').last();
    await expect(latest.getByRole('heading', { name: 'Willow Storehouse' })).toBeVisible();
    await expect(latest).toContainText('Agnes, the guild porter');
    await expect(latest).not.toContainText('The Tower carter’s password.');

    await page.getByRole('textbox', { name: 'What do you do?' }).fill('Follow a passage through the storehouse to Dover.');
    const turn = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/turns'));
    await press('Continue');
    const result = await turn;
    expect(result.ok()).toBeTruthy();
    const save = await result.json();
    expect(save.scene.id).toBe('guild-storehouse');
    expect(save.passages.at(-1).paragraphs.join(' ')).not.toContain('Dover');
    await expect(latest.getByRole('heading', { name: 'A moment to decide' })).toBeVisible();
    await press('Ask the porter about the guild tally');
    await expect(latest).toContainText(storehouseTally);
    await press('Return to the Thames landing');
    await expect(latest.getByRole('heading', { name: 'Back at Thames landing' })).toBeVisible();
  });
});
