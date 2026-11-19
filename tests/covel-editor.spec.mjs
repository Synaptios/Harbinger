import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const weakOpening = 'This moment is undeniably significant, a powerful tapestry of loyalty and ambition.';
const strongOpening = 'Martin draws his inkstone toward him, keeping one hand free for the ledger.';
const guildScene = `${strongOpening} There are three people at the table, but only Martin raises his head when the door opens. A boy beside him has laid a tally on its edge and is seeing how long it will balance. When he notices the book he lets the stick fall flat.

“I was about to send for you,” Martin says. At the far end of the table a candle has guttered down to the metal. The room is light enough without it now. Martin wets his finger and puts out the wick. “You can leave the book here. I can make room.”

He slides the register and a roll of paper apart. The space he leaves looks too small for a thing that took both hands to carry up the lane. The book’s corners are worn to the boards. Alice has three trays with the same wear where her fingers go. Her marks are in the book, with the amounts close against them. The rest of each line is open.

Through the wall comes the knock of a mallet, six blows with a pause between the third and the fourth. Someone is doing a morning’s work. The boy looks down at his tally again. One end of it has been cut square. He rubs a ridge left by the saw, going over it with his thumb until Martin looks round. The boy puts his hands in his lap.

“We counted the stalls yesterday,” Martin says. “There are two standing empty by the east post. People will have bread from those ovens again if somebody can say where the flour went. I need names I can give the clerk who comes at dusk. He’s got twelve books to close and he’ll shut any oven he has to return to tomorrow.” His hand moves across the space he made for the ledger. “I told him ours would be ready.”

A thin skin of black ink has come away on Martin’s finger. He wipes it on a piece of rag and folds the rag so the clean face is uppermost. The boy has taken to looking at the door. The latch there comes halfway out of the wood when the wind strains at it. He gets to his feet and settles it with his thumb.

Martin waits until the boy is back at the table. “Shall I give you a minute to find the page?” he asks. The space between the register and the roll is still there. He takes his hand away so there is room for the book.`;
const correctedFirstParagraph = guildScene.split('\n\n')[0];

async function startProvider(answer) {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const operation = payload.text?.format.name ?? 'actor-thought';
    const input = JSON.parse(payload.input ?? payload.messages.at(-1).content);
    const result = answer(operation, input);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
      choices: [{ message: { content: JSON.stringify(result) } }],
    }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  return {
    config: { url: `http://127.0.0.1:${provider.address().port}/v1/responses`, name: 'fixture', key: 'fixture' },
    close: () => new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    }),
  };
}

test('the reader receives the targeted revision of a flat passage', async ({ page }) => {
  test.slow();
  const provider = await startProvider((operation, input) => {
    if (operation === 'harbinger_passage') {
      return { prose: input.opening ? guildScene : guildScene.replace(strongOpening, weakOpening) };
    }
    if (operation === 'harbinger_review') {
      const editorial = input.candidate[0].startsWith(weakOpening) ? { paragraph: 1, kind: 'flatness' } : null;
      return { hardFailures: [], editorial };
    }
    if (operation === 'harbinger_repair') return { patches: [{ paragraph: 1, text: correctedFirstParagraph }] };
    return { thought: 'I will see what the clerk makes of this.' };
  });
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: provider.config });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'What do you do?' }).fill('Take the ledger to Martin');
    await page.getByRole('button', { name: 'Continue' }).click();
    const passage = story.getByRole('article').filter({ has: page.getByRole('heading', { name: 'The last entry' }) });
    await expect(passage).toContainText(strongOpening);
    await expect(passage).not.toContainText(weakOpening);
  } finally {
    if (app) await app.close();
    await provider.close();
  }
});

test('an optional revision that takes over the clerk leaves the verified draft in the story', async ({ page }) => {
  test.slow();
  const unchosenAction = 'You tear the ledger page free while Martin watches.';
  const provider = await startProvider((operation, input) => {
    if (operation === 'harbinger_passage') {
      return { prose: input.opening ? guildScene : guildScene.replace(strongOpening, weakOpening) };
    }
    if (operation === 'harbinger_review') {
      const hardFailures = input.candidate[0].startsWith(unchosenAction) ? [{ paragraph: 1, kind: 'agency' }] : [];
      const editorial = input.candidate[0].startsWith(weakOpening) ? { paragraph: 1, kind: 'repetition' } : null;
      return { hardFailures, editorial };
    }
    if (operation === 'harbinger_repair') {
      return { patches: [{ paragraph: 1, text: correctedFirstParagraph.replace(strongOpening, unchosenAction) }] };
    }
    return { thought: 'I will see what the clerk makes of this.' };
  });
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: provider.config });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'What do you do?' }).fill('Take the ledger to Martin');
    await page.getByRole('button', { name: 'Continue' }).click();
    const latest = story.getByRole('article').last();
    await expect(latest.getByRole('heading', { name: 'The last entry' })).toBeVisible();
    await expect(latest).toContainText(weakOpening);
    await expect(latest).not.toContainText(unchosenAction);
  } finally {
    if (app) await app.close();
    await provider.close();
  }
});

test('a safe short passage remains playable when the word-count edit fails', async ({ page }) => {
  test.slow();
  const shortPassage = 'Martin draws his inkstone close and leaves enough room for the delivery book.';
  const provider = await startProvider((operation, input) => {
    if (operation === 'harbinger_passage') return { prose: input.opening ? guildScene : shortPassage };
    if (operation === 'harbinger_review') return { hardFailures: [], editorial: null };
    if (operation === 'harbinger_repair') return { patches: [] };
    return { thought: 'I will see what the clerk makes of this.' };
  });
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: provider.config });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'What do you do?' }).fill('Take the ledger to Martin');
    await page.getByRole('button', { name: 'Continue' }).click();
    const latest = story.getByRole('article').last();
    await expect(latest.getByRole('heading', { name: 'The last entry' })).toBeVisible();
    await expect(latest).toContainText(shortPassage);
    await expect(page.getByRole('button', { name: 'Retry turn' })).toBeHidden();
  } finally {
    if (app) await app.close();
    await provider.close();
  }
});

test('a repair that still reveals a confidence commits the resolved turn with authored prose', async ({ page }) => {
  test.slow();
  const secret = 'The blue loaf wakes at low tide.';
  const firstLeak = 'Martin speaks of the blue bread coming alive when the Thames is at its lowest.';
  const persistentLeak = 'Martin says the cobalt loaf stirs once the river uncovers the shore.';
  const provider = await startProvider((operation, input) => {
    if (operation === 'harbinger_passage') {
      expect(JSON.stringify(input)).not.toContain(secret);
      return { prose: input.opening ? guildScene : guildScene.replace(strongOpening, firstLeak) };
    }
    if (operation === 'harbinger_repair') {
      expect(JSON.stringify(input)).not.toContain(secret);
      return { patches: [{ paragraph: 1, text: correctedFirstParagraph.replace(strongOpening, persistentLeak) }] };
    }
    if (operation === 'harbinger_review') {
      const protectedMeaning = input.protectedFacts.some(fact => fact.text === secret);
      const paraphrase = [firstLeak, persistentLeak].some(leak => input.candidate[0].includes(leak));
      return {
        hardFailures: protectedMeaning && paraphrase ? [{ paragraph: 1, kind: 'knowledge' }] : [],
        editorial: null,
      };
    }
    return { thought: 'I will see what the clerk makes of this.' };
  });
  let app;
  try {
    app = await startApp({ engine: 'covel', provider: provider.config });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    const action = page.getByRole('textbox', { name: 'What do you do?' });
    await expect(story).toBeVisible({ timeout: 30_000 });
    await action.fill('Take the ledger to Martin');
    await page.getByRole('button', { name: 'Continue' }).click();
    const latest = story.getByRole('article').last();
    await expect(latest.getByRole('heading', { name: 'The last entry' })).toBeVisible();
    await expect(latest).toContainText('Martin sets a finger beside the delivery column.');
    await expect(story).not.toContainText(secret);
    await expect(story).not.toContainText(firstLeak);
    await expect(story).not.toContainText(persistentLeak);
    await expect(page.getByRole('button', { name: 'Retry turn' })).toBeHidden();
    await expect(action).toHaveValue('');
    await expect(story.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page.getByRole('heading', { name: 'The guild room' })).toBeVisible();
  } finally {
    if (app) await app.close();
    await provider.close();
  }
});
