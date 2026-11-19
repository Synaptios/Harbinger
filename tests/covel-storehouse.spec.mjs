import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const storehouseTally = 'The guild tallies each sack by its mark before putting it on a shelf.';
const supperInvitation = 'Will you come to supper when your work is done?';
const supperReply = 'You saved me the second count, and I still have the last shelf to reckon with.';
const scene = `A cart wheel has worn a hollow in the stone nearest the gate. It takes the man leading the cart a while to get it out. He puts his shoulder against the wood and tells his horse to stand. When the wheel comes free he steps back with both hands open. The horse seems to have known all along where it was going. It waits until he is beside it before going on up the lane.

Somebody has set a piece of dry board across the gutter. The rain runs under it in a little rush. One edge has gone pale where shoes have passed over it. A boy with a cloth over his head is standing on that edge to keep his feet out of the water. He waits for a woman carrying a basket to pass, then moves the board back into its place with his foot.

Beyond the board the stone wall has been repaired low down. The new mortar is still coarse and dark. Here and there a loose grain has caught in the wool of a sleeve brushing past it. The sleeve belongs to a man whose hands are full of short lengths of rope. He stops to gather them against his chest, looking down to make sure he has lost none. One length has been knotted with a scrap of red thread. He lifts that one to the top of the bundle.

In the doorway where two courses of brick meet, an iron hook has been set at the height of a man's shoulder. Its tip shines more brightly than the rest. Someone has used it to hang a wet length of sailcloth. Water gathers there a drop at a time and makes a dark line in the dust below. The line breaks around a little stone. The stone holds its place while the water finds a way down against the wall.

The man with the rope calls after the cart. He has something in his bundle he means to give the driver. He lifts his chin and calls again, saying the name more slowly this time. At the end of the lane the driver stops and looks back. Neither man hurries toward the other. The boy gives the board another nudge with his heel and comes out from beside the wall. The cart is out of the gutter now, and there is room for two people to walk abreast.`;

async function withStorehouseProvider(getAppearance, run) {
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
      case 'harbinger_review':
        result = { hardFailures: [], editorial: null };
        break;
      case 'harbinger_passage':
        result = { prose: [...context.currentScene.paragraphs, scene, ...(context.speakerEvidence ?? [])
          .filter(speaker => speaker.speaker === 'Thomas')
          .flatMap(speaker => (speaker.suggestedReplies ?? []).map(reply => `“${reply}” Thomas says.`))].join('\n\n') };
        break;
      case 'harbinger_interpret':
        result = { intents: [context.text.includes(supperInvitation)
          ? { type: 'speak', actorId: context.audience.find(actor => actor.name === 'Thomas')?.id, words: supperInvitation }
          : { type: 'choice', choice: 'Cross to Dover' }] };
        break;
      case 'harbinger_actor_reply':
        result = {
          reply: context.actor.name === 'Thomas' && context.relationship?.trust > 0 ? supperReply : 'I have to finish the count.',
          commitment: null,
        };
        break;
      default:
        result = { thought: 'I must finish counting before I leave.' };
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

    await press('Ask the porter about the guild tally');
    await expect(latest).toContainText(storehouseTally);
    await press('Journal');
    await expect(journal.getByText(storehouseTally)).toBeVisible();
  });
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
