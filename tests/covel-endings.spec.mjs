import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const guild = 'Take the ledger to Martin';
const returnWithLedger = 'Return to the bakehouse with the ledger';
const market = ['Ask the carters in the market', 'Wait for the market tally'];
const cases = [
  {
    name: 'handing over the names keeps the oven open and exposes the carter',
    actions: [guild, 'Give Martin the names'],
    ending: 'The key comes off the nail',
    consequence: 'Then she takes the spare key off its nail',
    learned: ['Guild license on the shutter', 'Summons for the carter'],
    hidden: ['Guild closure order'],
  },
  {
    name: 'leaving the guild with the ledger leaves a way to help Alice',
    actions: [guild, returnWithLedger, 'Read the guild notice', 'Offer to help Alice start again'],
    ending: 'The price of flour',
    consequence: 'The sacks still wait at the landing.',
    learned: ['Guild closure order', 'Return at first light'],
    hidden: ['Summons for the carter'],
  },
  {
    name: 'letting the shutter notice stand unread leaves the report unconfirmed',
    actions: [guild, returnWithLedger, 'Leave the guild notice unread'],
    ending: 'The long way home',
    consequence: 'The paper is still hanging from the shutter',
    learned: ['The oven may be sealed'],
    hidden: ['Guild closure order'],
  },
  {
    name: 'reading the market copy creates a different opening for Alice',
    actions: [...market, 'Read the market copy of the order', 'Help Alice find another oven'],
    ending: 'Two hours before dawn',
    consequence: 'leaves her room for three dozen loaves',
    learned: ['Guild closure order', 'Two hours at another oven'],
    hidden: ['Guild license on the shutter'],
  },
  {
    name: 'leaving the market copy unread lets the clerk leave without firsthand evidence',
    actions: [...market, 'Leave the market copy unread'],
    ending: 'After the market',
    consequence: 'A stallholder weighs the folded paper down with a stone',
    learned: ['Closure reported at the market'],
    hidden: ['Guild closure order', 'Two hours at another oven'],
  },
];

async function startProvider() {
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the local fixture request. */ }
    const result = { index: 0 };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
    name: 'fixture',
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

for (const route of cases) {
  test(route.name, async ({ page }) => {
    test.slow();
    const provider = await startProvider();
    let app;
    try {
      app = await startApp({ engine: 'covel', provider });
      await page.goto(app.url);
      await page.getByRole('button', { name: 'Begin story' }).click();
      const story = page.getByRole('region', { name: 'Story passage' });
      await expect(story.getByRole('heading', { name: 'Alice’s bakehouse', exact: true })).toBeVisible({ timeout: 30000 });
      for (const [index, action] of route.actions.entries()) {
        await page.getByRole('textbox', { name: 'What do you do?' }).fill(action);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(story.getByRole('article')).toHaveCount(index + 2);
      }
      const passage = story.getByRole('article').filter({ has: page.getByRole('heading', { name: route.ending, exact: true }) });
      await expect(passage).toContainText(route.consequence);
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeHidden();

      await page.getByRole('button', { name: 'Journal', exact: true }).click();
      for (const heading of route.learned) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      for (const heading of route.hidden) await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0);
    } finally {
      if (app) await app.close();
      await provider.close();
    }
  });
}

test('the river carter is present for loading and absent when the clerk walks back from the guild', async ({ request }) => {
  const provider = await startProvider();
  let app;
  try {
    app = await startApp({ engine: 'covel', provider });
    const root = `${app.url}/api/saves`;
    const reportedParticipants = async actions => {
      let save = await (await request.post(root, { data: {} })).json();
      for (const text of actions) {
        const response = await request.post(`${root}/${save.id}/turns`, {
          data: { text, revision: save.revision, requestId: `arrival-${save.revision}` },
        });
        expect(response.ok()).toBe(true);
        save = await response.json();
      }
      const inspection = await (await request.get(`${root}/${save.id}/testing`)).json();
      return inspection.thoughts.filter(item => item.turn === save.revision && item.presence === 'onstage').map(item => item.name);
    };
    const walking = await reportedParticipants([guild, returnWithLedger]);
    expect(walking).toContain('Errand boy');
    expect(walking).not.toContain('River carter');
    const loading = await reportedParticipants(['Go with Alice to the river', 'Help Alice load the flour']);
    expect(loading).toContain('River carter');
  } finally {
    if (app) await app.close();
    await provider.close();
  }
});
