import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const opening = `The fire has got hold of the last ash twig. Its tip burns white, and the sound it makes is close to someone drawing breath to speak. Alice reaches above the oven for a peel polished dark by her hands. She draws a loaf out by degrees, stopping at the lip to see whether the crust has caught. At that hour the lane usually smells of damp wool and yesterday’s onions. Fresh bread puts an end to both of those smells as soon as she lays the loaf on the table.

The crier’s words are still carrying past the doorway. Arthur died fighting Launcelot overseas, he says. Farther off somebody asks him to repeat it. By then he is walking, and the answer arrives a little at a time. Alice slides the loaf onto its side. The crust makes three small sounds as it cools. She waits for the footsteps to pass before she sets the peel back in its notch above the oven.

Martin has left the delivery ledger beside the scales. One brass weight has been set on its cover, just on the edge, to hold it down. When he spoke of dusk he kept his finger on that weight. The guild needs names against the flour, he said. A clean account will keep the ovens open. Alice had pointed out that her own name was on the book already. He had taken his hand away then, and let the cover lie where it was. The account is still due at dusk. Even with Martin gone the book occupies half the table.

Alice takes up a sleeve of folded cloth and runs it over the edge of the scales. She has a way of working around a question for a while, as if keeping her hands occupied buys her the right to choose her words. When she speaks she is looking at a tight seam in the cloth. “I stood surety for you once,” she says. “Do you remember the clerk who brought the bond? He came at breakfast, before I had swept the floor. Put his clean paper right in the flour and asked why my mark was so hard to read.” She folds the cloth a second time. “I can read it well enough.”

She makes a space on the table beside the ledger. It is just wide enough for two people to stand and see the same page. The light has reached the bottom of the door, but it has yet to climb very far up the wood. Outside, a set of cart wheels rolls over a bad stone. Alice waits for the rattle to end. “Come to the river,” she says. “You'll see what’s waiting there. You can tell me what you'd write in the book once you’ve seen it.”`;

const landing = `The lane falls steeply to the river. On the last stretch the brick is slick, and the front wheel of an empty cart keeps missing the fall of the gutter. Its driver swears at a cobble, then takes the wheel in both hands. Alice waits against a wall while he brings it past. There is flour in the fold of her cuff still. She puts her thumb against it and leaves a pale mark on the brick.

The tide has left a line of wet leaves on the landing. Every leaf points downstream. Above that line six sacks sit on two wide boards, out of reach of the small waves that come over the edge. The carter has a tarpaulin folded as long as his arm. He lays it over the last sack, tucks a corner underneath, and pulls it free again when the board takes hold of it. Alice catches the corner before it falls in the water. Neither of them says anything until the cloth is lying flat.

“Six sacks,” she says, looking down the line of boards. “Enough to keep them on their feet.” She holds out her hand to the carter. He wipes a wet palm on his breeches before he passes her the loose end of the rope. It has been knotted twice at about the length of her forearm, once badly and once well. She works a nail into the bad knot. The river laps against the stone, close enough to lift the shadow under her fingers.

“A sack has a weight. You put it on the scales and anybody can see you’re telling the truth about what it weighs.” She coaxes the knot open a little at a time. “I can carry the weight on my back if I have to. I can pay for the flour if the loads come in next week.” The end of the rope comes clear. She lets the carter take it from her. He winds the spare length around his hand and looks away down the wharf.

Alice turns so she can speak without raising her voice above the water. “What do you put on the scales when somebody asks for the names?” She has a patch of flour on her thumb where she pressed the brick. She rubs it between two fingers and watches it go. Behind her the carter steadies himself on the boards as they shift. One corner of the cloth flips up in the wind. The sacks are still on the landing.`;

test('a fresh Covel story commits the free-text turn and its Journal evidence together', async ({ page }) => {
  test.slow();
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const incoming = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(incoming.messages.at(-1).content);
    let result;
    if ('candidate' in context) result = { hardFailures: [], editorial: null };
    else if ('currentScene' in context) result = { prose: context.opening ? opening : landing };
    else if (context.text === 'I head to the river.') result = { intents: [{ type: 'choice', choice: 'Go with Alice to the river' }] };
    else result = { thought: 'I will wait and see what the clerk makes of this.' };
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
    await expect(story.getByRole('article')).toContainText('The crier’s words are still carrying past the doorway.');
    const action = page.getByRole('textbox', { name: 'What do you do?' });
    await action.fill('I head to the river.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    const passage = story.getByRole('article').filter({ hasText: 'The tide has left a line of wet leaves on the landing.' });
    const paragraphs = await passage.locator('p:not(.passage-time, .played-action)').allTextContents();
    const words = paragraphs.join(' ').trim().split(/\s+/u).length;
    expect(words).toBeGreaterThanOrEqual(400);
    expect(words).toBeLessThanOrEqual(700);

    await app.restart();
    await page.reload();
    await expect(passage).toHaveCount(1, { timeout: 30_000 });
    await expect(passage).toContainText(paragraphs[0]);
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
