import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const invitation = 'Will you come to supper with me after the ovens are shut?';
const answer = 'Not while the oven needs minding. Ask again when the last loaf is out.';
const secret = 'The blue loaf wakes at low tide.';
const privateThought = `I can let them take the flour. I cannot let them read the names. I still remember what the carter said. “${secret}”`;

async function playAgainstProvider(respond, callback, endpoint = 'chat/completions') {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const instruction = input.instructions ?? input.messages[0].content;
    const context = JSON.parse(input.input ?? input.messages[1].content);
    const output = respond(instruction, context);
    const content = JSON.stringify(output);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(endpoint === 'responses'
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
      : { choices: [{ message: { content } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  let app;
  try {
    app = await startApp({
      engine: 'covel',
      provider: { url: `http://127.0.0.1:${provider.address().port}/v1/${endpoint}`, name: 'fixture' },
    });
    await callback(app);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
  }
}

test('Alice answers a supper invitation in her voice and the reply survives reload', async ({ page }) => {
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      return { intents: [{ type: 'speak', actorId: 'alice', words: invitation }] };
    }
    if (context.actor?.id === 'alice' && context.words === invitation) return { reply: answer, meetingId: null };
    return { index: 0 };
  }, async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toBeVisible();
    await page.getByRole('textbox', { name: 'What do you do?' }).fill(`I turn to Alice. “${invitation}”`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story).toContainText(answer);
    await app.restart();
    await page.reload();
    await expect(story).toContainText(answer);
  });
});

test('the same question to Martin gets a different answer once he hears the clerk’s account', async ({ request }) => {
  const question = 'Did the Queen take shelter at the Tower, Master Martin?';
  const witnessSource = 'Clerk’s testimony heard in the bakehouse';
  const reported = 'I can enter what you told me under your name. The carter must put his own mark to it.';
  const absent = 'Wedding supplies are the only errand in my book.';
  const prompts = [];
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      return { intents: [{ type: 'speak', actorId: 'martin', words: question, choice: null }] };
    }
    if (context.words === question) {
      prompts.push(context.evidence);
      const account = context.evidence.some(item => item.source === witnessSource && item.status === 'reported');
      return { reply: account ? reported : absent, meetingId: null };
    }
    return { index: 0 };
  }, async app => {
    const root = `${app.url}/api/saves`;
    const play = async (save, text) => {
      const response = await request.post(`${root}/${save.id}/turns`, {
        data: { text, revision: save.revision, requestId: `play-${save.revision}` },
      });
      expect(response.ok()).toBe(true);
      const next = await response.json();
      expect(next.revision).toBe(save.revision + 1);
      return next;
    };
    const prepare = async choice => {
      let save = await (await request.post(root, { data: {} })).json();
      save = await play(save, 'Promise Alice discretion');
      save = await play(save, 'Ask Alice what brought Guenever to London');
      expect(save.observations).toContainEqual(expect.objectContaining({
        title: 'The reason for the flour', source: 'Alice', status: 'reported', passageId: save.passages.at(-1).id,
      }));
      return play(save, choice);
    };
    const kept = await prepare('Keep Alice’s confidence');
    const disclosed = await prepare('Tell Martin what Alice said about the Queen');
    await app.restart();
    const unheard = await play(kept, `I ask Martin, “${question}”`);
    const heard = await play(disclosed, `I ask Martin, “${question}”`);
    expect(unheard.passages.at(-1).paragraphs.join(' ')).toContain(absent);
    expect(heard.passages.at(-1).paragraphs.join(' ')).toContain(reported);
    expect(JSON.stringify(prompts[0])).not.toMatch(/Tower|blue loaf/u);
    expect(prompts[1]).toContainEqual(expect.objectContaining({
      source: witnessSource, status: 'reported', text: expect.stringContaining('The clerk says'),
    }));
    expect(JSON.stringify(prompts[1])).not.toContain(secret);
  }, 'responses');
});

test('a malformed dialogue response saves a fallback at the next revision', async ({ request }) => {
  const question = 'Is the license safe, Alice?';
  const invented = 'I have paid Martin to keep the oven open.';
  const safeReply = 'Tell me what you need, plain as that.';
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      return { intents: [{ type: 'speak', actorId: 'alice', words: question }] };
    }
    if (context.words === question) return { reply: invented, commitment: null };
    return { index: 0 };
  }, async app => {
    const root = `${app.url}/api/saves`;
    const save = await (await request.post(root, { data: {} })).json();
    const response = await request.post(`${root}/${save.id}/turns`, {
      data: { text: `I ask Alice, “${question}”`, revision: save.revision, requestId: 'unauthorized-commitment' },
    });
    expect(response.ok()).toBe(true);
    const next = await response.json();
    expect(next.passages.at(-1).paragraphs.join(' ')).toContain(safeReply);
    expect(next.revision).toBe(save.revision + 1);
    expect(JSON.stringify(next)).not.toContain(invented);
    expect(next.observations.some(item => item.title === 'Guild license on the shutter')).toBe(false);
  }, 'responses');
});

test('a first-person NPC thought is only exposed through the opt-in testing view', async ({ page }) => {
  await playAgainstProvider(() => ({ index: 0 }), async app => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Promise Alice discretion' }).click();
    await expect(page.getByRole('button', { name: 'Ask Alice what brought Guenever to London' })).toBeVisible();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).not.toContainText(secret);

    const requests = [];
    page.on('request', request => {
      if (request.url().endsWith('/testing')) requests.push(request.url());
    });
    await page.getByRole('button', { name: 'Testing view' }).click();
    const testing = page.getByRole('dialog', { name: 'Testing view' });
    await expect(testing).toContainText('Story spoilers');
    expect(requests).toEqual([]);
    await testing.getByRole('button', { name: 'Reveal private thoughts' }).click();
    const thought = testing.getByRole('region', { name: 'Turn 1' })
      .getByRole('article', { name: 'Alice' }).getByRole('blockquote');
    await expect(thought).toHaveText(privateThought);
    expect(requests).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  });
});

test('an NPC’s reachable appointment changes a later passage after reload', async ({ request }) => {
  const invitation = 'Could we speak again somewhere away from the guild?';
  const unreachable = 'Will you meet me inside the Tower?';
  const impossible = 'I will wait for you inside the Tower after dusk.';
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      const words = context.text.includes(unreachable) ? unreachable : invitation;
      return { intents: [{ type: 'speak', actorId: 'alice', words, choice: null }] };
    }
    if (context.words) return {
      reply: context.words === unreachable ? impossible : 'Perhaps we can talk near the river.',
      meetingId: context.words === unreachable ? 'tower' : 'thames-landing',
    };
    return { index: 0 };
  }, async app => {
    const root = `${app.url}/api/saves`;
    const begin = async () => (await request.post(root, { data: {} })).json();
    const play = async (save, text) => {
      const response = await request.post(`${root}/${save.id}/turns`, {
        data: { text, revision: save.revision, requestId: `meeting-${save.revision}` },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const unreachableRun = await play(await begin(), `I ask Alice, “${unreachable}”`);
    expect(unreachableRun.choices).not.toContain('Meet Alice at the Thames landing');
    expect(unreachableRun.observations.some(item => item.kind === 'promise')).toBe(false);
    expect(unreachableRun.passages.at(-1).paragraphs.join(' ')).not.toContain(impossible);

    let available = await play(await begin(), `I ask Alice, “${invitation}”`);
    expect(available.choices).toContain('Meet Alice at the Thames landing');
    expect(available.observations).toContainEqual(expect.objectContaining({
      kind: 'promise', title: 'Meeting with Alice', source: 'Alice at the bakehouse', status: 'firsthand',
      passageId: available.passages.at(-1).id,
    }));
    await app.restart();
    available = await (await request.get(`${root}/${available.id}`)).json();
    const visited = await play(available, 'Meet Alice at the Thames landing');
    expect(visited.passages.at(-1).heading).toBe('Alice keeps the appointment');
    expect(visited.observations).toContainEqual(expect.objectContaining({
      title: 'Alice kept the appointment', source: 'Seen at the Thames landing', status: 'firsthand',
      passageId: visited.passages.at(-1).id,
    }));
    expect(visited.choices).toContain('Help Alice load the flour');

    const delayed = await play(await begin(), `I ask Alice, “${invitation}”`);
    const guild = await play(delayed, 'Take the ledger to Martin');
    expect(guild.scene).toMatchObject({ id: 'guildInspection', minute: 1055 });
    expect(guild.choices).not.toContain('Meet Alice at the Thames landing');
    const departed = await play(guild, 'Return to the bakehouse with the ledger');
    expect(departed.scene.id).toBe('shutter');
    expect(departed.observations.some(item => item.topic === 'appointment' && item.title === 'Alice kept the appointment')).toBe(false);
  }, 'responses');
});

test('the director brings the missed inspection through a reachable witness and then a written order', async ({ request }) => {
  await playAgainstProvider(() => ({ index: 0 }), async app => {
    const root = `${app.url}/api/saves`;
    let save = await (await request.post(root, { data: {} })).json();
    const play = async text => {
      const response = await request.post(`${root}/${save.id}/turns`, {
        data: { text, revision: save.revision, requestId: `inspection-${save.revision}` },
      });
      expect(response.ok()).toBe(true);
      save = await response.json();
      return save;
    };
    await play('Ask the carters in the market');
    expect(save.observations.some(item => item.topic === 'oven-closure')).toBe(false);
    await play('Wait for the market tally');
    expect(save.passages.at(-1).paragraphs.join(' ')).toContain('He leaves a folded copy of the order on the stall.');
    const report = save.observations.find(item => item.source === 'Guild runner');
    expect(report).toMatchObject({ status: 'reported', passageId: save.passages.at(-1).id });
    const testing = await (await request.get(`${root}/${save.id}/testing`)).json();
    expect(testing.thoughts).toContainEqual(expect.objectContaining({
      name: 'Martin', presence: 'offstage', text: expect.stringMatching(/^I /u),
    }));
    await play('Read the market copy of the order');
    expect(save.passages.at(-1).paragraphs.join(' ')).toContain('No ledger was produced at the inspection.');
    expect(save.observations).toContainEqual(expect.objectContaining({
      title: 'Guild closure order', status: 'firsthand', supersedes: report.id, passageId: save.passages.at(-1).id,
    }));
    expect(save.choices).toContain('Help Alice find another oven');
  }, 'responses');
});

test('a reachable intervention stops remaining steps until the clerk responds', async ({ request }) => {
  await playAgainstProvider((instruction) => {
    if (instruction.includes('Interpret only the protagonist')) return { intents: [
      { type: 'observe' }, { type: 'choice', choice: 'Wait for the market tally' },
      { type: 'choice', choice: 'Leave the market copy unread' },
    ] };
    return { index: 0 };
  }, async app => {
    const root = `${app.url}/api/saves`;
    let save = await (await request.post(root, { data: {} })).json();
    const play = async text => {
      const response = await request.post(`${root}/${save.id}/turns`, {
        data: { text, revision: save.revision, requestId: `pause-${save.revision}` },
      });
      expect(response.ok()).toBe(true);
      save = await response.json();
    };
    await play('Ask the carters in the market');
    await play('I take a look around the market, wait for the tally, and then leave without reading the copy.');
    expect(save.scene).toMatchObject({ id: 'marketWarning', minute: 1088, time: 'Dusk' });
    expect(save.turn).toMatchObject({ kind: 'interrupted' });
    expect(save.choices).toContain('Leave the market copy unread');
    expect(save.observations.some(item => item.title === 'Alice heads home from the market')).toBe(false);
    await play('Leave the market copy unread');
    expect(save.scene).toMatchObject({ id: 'marketDepart', minute: 1105, time: 'After dusk' });
  });
});
