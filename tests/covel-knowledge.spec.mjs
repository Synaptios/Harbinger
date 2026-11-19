import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const invitation = 'Will you come to supper with me after the ovens are shut?';
const answer = 'Ask me when the boy has eaten. I’ll bring a heel of bread if the oven leaves us one.';
const secret = 'The blue loaf wakes at low tide.';
const privateThought = `I told the carter I could keep one phrase to myself. ${secret}`;

const scene = `Rain ticks against the shallow shelf above the door, where the wood is beginning to split around a nail. Alice moves the empty flour sack away from the draft. It folds in on itself with a little rush of dust, and she puts her foot on the corner to keep it from moving back. The lane smells of a wet fire. Somewhere out beneath the shutters a woman is calling for a child to mind the water that runs along the gutter.

On the far end of the table, Alice has weighed out the flour she is using and the flour she can spare. She puts each portion in its own bowl. The dish nearest the wall is the smaller one. When she takes a lump out of it she works the dough between her fingers a little longer than the first, as if coaxing it to hold together. There is no place on the table to lay a sleeve without leaving a mark on it.

The guild’s book is still beside the scales. An iron weight has been left on top, though the cover is too stiff to lift on its own. A line of water runs through the yard beyond the bakehouse. The carter's wheel has cut a track through the thin clay, and the track has started to fill. A boy steps over it with a bundle too long for his arms. The end of the bundle catches the door frame and he has to turn sideways to bring it in.

Alice brushes a space clear for the wood. She picks out the driest piece by tapping its end on the table. The sound is sharp enough to make the boy look up. She shows him where to set the rest and waits until he has done it. Outside, the woman's voice has stopped. From the oven comes the loose rattle of a lid that has been set back without quite finding its seat.

The boy drops the cord in a coil beside his shoes. It has come undone at one end and picked up a skein of mud. Alice tells him where there is a rag for his hands, then turns the bowl so a mark in its glaze faces the shelf. The pause is long enough for the thin puddle by the door to run into the yard. The lid rattles again. Alice keeps her palm on the table for a moment before she takes it away.`;

function repliesFrom(context) {
  return [...(context.currentScene?.paragraphs ?? []),
    ...((context.speakerEvidence ?? []).flatMap(actor => actor.suggestedReplies ?? []))].join(' ');
}

async function playAgainstProvider(respond, callback, endpoint = 'chat/completions', review = () => ({ hardFailures: [], editorial: null })) {
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const instruction = input.instructions ?? input.messages[0].content;
    const context = JSON.parse(input.input ?? input.messages[1].content);
    const output = context.candidate && !context.repairTargets ? review(context) : respond(instruction, context);
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
    if (context.actor?.id === 'alice' && context.words === invitation) return { reply: answer };
    const grounds = repliesFrom(context);
    return { prose: grounds.includes(answer) ? `${scene}\n\n“${answer}” Alice says.` : scene };
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
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      return { intents: [{ type: 'speak', actorId: 'martin', words: question, choice: null }] };
    }
    if (context.words === question) {
      const account = context.evidence.find(item => item.source === witnessSource && item.status === 'reported');
      return { reply: account ? reported : absent };
    }
    if (context.situation) return { thought: 'I need a name beside the evidence before I sign it.' };
    const moment = repliesFrom(context);
    const line = [reported, absent].find(reply => moment.includes(reply));
    return { prose: line ? `${scene}\n\n“${line}” Martin says.` : scene };
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
    expect(JSON.stringify(heard)).not.toContain(secret);
  }, 'responses');
});

test('dialogue draft cannot authorize a commitment that the world never made', async ({ request }) => {
  const question = 'Is the license safe, Alice?';
  const invented = 'I have paid Martin to keep the oven open.';
  const revised = 'The license is still Martin’s to issue, and you know what he asked for.';
  const review = context => {
    const paragraph = context.candidate.findIndex(line => line.includes(invented)) + 1;
    const alreadyAuthorized = context.currentScene.paragraphs.some(line => line.includes(invented));
    return { hardFailures: paragraph && !alreadyAuthorized ? [{ paragraph, kind: 'consequence' }] : [], editorial: null };
  };
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) {
      return { intents: [{ type: 'speak', actorId: 'alice', words: question }] };
    }
    if (context.words === question) return { reply: invented, commitment: null };
    if (context.repairTargets) return { patches: context.repairTargets.map(({ paragraph }) => ({ paragraph, text: `“${revised}” Alice says.` })) };
    if (context.situation) return { thought: 'I hope the flour lasts until dusk.' };
    return { prose: repliesFrom(context).includes(invented) ? `${scene}\n\n“${invented}” Alice says.` : scene };
  }, async app => {
    const root = `${app.url}/api/saves`;
    const save = await (await request.post(root, { data: {} })).json();
    const response = await request.post(`${root}/${save.id}/turns`, {
      data: { text: `I ask Alice, “${question}”`, revision: save.revision, requestId: 'unauthorized-commitment' },
    });
    expect(response.ok()).toBe(true);
    const next = await response.json();
    expect(next.passages.at(-1).paragraphs.join(' ')).toContain(revised);
    expect(JSON.stringify(next)).not.toContain(invented);
    expect(next.observations.some(item => item.title === 'Guild license on the shutter')).toBe(false);
  }, 'responses', review);
});

test('a first-person NPC thought is only exposed through the opt-in testing view', async ({ page }) => {
  await playAgainstProvider((_instruction, context) => {
    if (context.actor?.id === 'alice' && context.facts?.some(fact => fact.text === secret)) {
      return { thought: privateThought };
    }
    if (context.facts) return { thought: 'I will mark the sums when this is settled.' };
    return { prose: scene };
  }, async app => {
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
      reply: context.words === unreachable ? impossible : 'I could use a word out of his hearing.',
      commitment: { locationId: context.words === unreachable ? 'tower' : 'thames-landing', purpose: 'flour' },
    };
    if (context.situation) return { thought: 'I have a sack to move before the tide turns.' };
    if (context.currentScene?.paragraphs.some(line => line.includes(impossible))
        || context.speakerEvidence?.some(actor => actor.suggestedReplies?.includes(impossible))) {
      return { prose: `${scene}\n\n“${impossible}” Alice says.` };
    }
    return { prose: scene };
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
  await playAgainstProvider((_instruction, context) => {
    if (context.situation) return { thought: 'I must settle what belongs in the record.' };
    const witness = context.sceneBrief?.resolution?.find(item => item.status === 'reported' && item.source === 'Guild runner');
    const order = context.sceneBrief?.resolution?.find(item => item.status === 'firsthand' && item.source === 'Guild copy left at the market stall');
    if (witness) return { prose: `${scene}\n\nThe guild runner sets a folded order on the stall. “Alice’s oven has been closed,” he says.` };
    if (order) return { prose: `${scene}\n\nThe written order says no ledger was produced. The seal has cracked where the runner folded it.` };
    return { prose: scene };
  }, async app => {
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
    expect(save.passages.at(-1).paragraphs.join(' ')).toContain('The guild runner sets a folded order');
    const report = save.observations.find(item => item.source === 'Guild runner');
    expect(report).toMatchObject({ status: 'reported', passageId: save.passages.at(-1).id });
    const testing = await (await request.get(`${root}/${save.id}/testing`)).json();
    expect(testing.thoughts).toContainEqual(expect.objectContaining({
      name: 'Martin', presence: 'offstage', text: expect.stringMatching(/^I /u),
    }));
    await play('Read the market copy of the order');
    expect(save.passages.at(-1).paragraphs.join(' ')).toContain('The written order says no ledger was produced.');
    expect(save.observations).toContainEqual(expect.objectContaining({
      title: 'Guild closure order', status: 'firsthand', supersedes: report.id, passageId: save.passages.at(-1).id,
    }));
    expect(save.choices).toContain('Help Alice find another oven');
  }, 'responses');
});

test('a reachable intervention stops remaining steps until the clerk responds', async ({ request }) => {
  await playAgainstProvider((instruction, context) => {
    if (instruction.includes('Interpret only the protagonist')) return { intents: [
      { type: 'observe' }, { type: 'choice', choice: 'Wait for the market tally' },
      { type: 'choice', choice: 'Leave the market copy unread' },
    ] };
    if (context.situation) return { thought: 'I still owe him the last tally.' };
    return { prose: scene };
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
