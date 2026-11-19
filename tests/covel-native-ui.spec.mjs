import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel browser suite with HARBINGER_TEST_COVEL=1.');

const openingLine = 'A crier’s voice carries through the flour dust.';
const landingLine = 'A carter folds a tarpaulin over the last sack.';
const privateThought = 'I can let them take the flour. I cannot let them read the names.';
const conversation = 'I ask Alice to wait here.';
const spokenAnswer = 'You’ll have to leave that with me.';
const actorReply = 'Alice says, “' + spokenAnswer + '”';
const storehouseLine = 'Edith, the guild porter, props the door with an empty barrel';
const partialAction = 'I look around, then try a lock I have not found.';
test.use({ locale: 'en-US' });

test('Covel’s AI roles change the next Character and State requests and preserve the previous lineup', async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-covel-ui-'));
  const model = 'bread-ledger-test-model';
  const nextModel = 'bread-ledger-next-model';
  const characterModel = 'bread-ledger-character-model';
  const stateModel = 'bread-ledger-state-model';
  const key = 'fixture-model-key';
  const recordedRequests = [];
  const structuredRequests = { speech: [], unclear: [] };
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(input.messages.findLast(message => message.role === 'user').content);
    const operation = 'candidate' in context ? 'review' : 'currentScene' in context ? 'story'
      : 'words' in context ? 'dialogue' : 'situation' in context ? 'thought' : 'porterNames' in context ? 'storehouse' : 'intent';
    recordedRequests.push({ model: input.model, operation, key: request.headers.authorization });
    const system = input.messages.find(message => message.role === 'system').content;
    let result;
    if ('candidate' in context || 'currentScene' in context) {
      result = { prose: 'The clerk volunteers to sign the ledger.' };
    } else if ('words' in context) {
      result = { reply: spokenAnswer, meetingId: null };
    } else if ('porterNames' in context) {
      result = { porterName: 'Edith', sign: 'Anchor' };
    } else if (context.text === conversation) {
      result = structuredRequests.speech.push(system) === 1
        ? { intents: [{ type: 'speak', words: 12 }] }
        : { intents: [{ type: 'speak', choice: null, words: 'wait here', actorId: 'alice' }] };
    } else if (context.text === partialAction) {
      structuredRequests.unclear.push(system);
      result = { intents: [{ type: 'invent-unseen-lock' }] };
    } else if (context.text === 'I head to the river.') {
      result = { intents: [{ type: 'choice', choice: 'Go with Alice to the river' }] };
    } else result = { index: 0 };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });

  let covel;
  let stopped;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
    covel = launchCovel({
      databasePath: join(directory, 'story.sqlite'),
      provider: {
        url: `${providerOrigin}/v1/chat/completions`,
        name: model,
        key,
        reasoningEffort: 'medium',
      },
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
        entries: { 'ui.appearance': 'panel' },
      }));
    });
    await page.goto(url);
    const world = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'The Bread Ledger', exact: true }),
    });
    await expect(world).toBeVisible();
    await expect(page.getByText('Set up an AI first', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Choose your language|Welcome to Covel/u })).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI roles', exact: true }).click();
    const story = settings.getByRole('group', { name: 'story', exact: true });
    const modelInput = story.getByRole('combobox', { name: 'Model configuration', exact: true });
    await expect(modelInput.getByRole('option', { name: /previous lineup.*bread-ledger-test-model/iu })).toHaveCount(1);
    await expect(story.getByText(new RegExp(key, 'u'))).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();

    await settings.getByRole('button', { name: 'Preferences', exact: true }).click();
    await expect(settings.getByRole('combobox', { name: /Interface language/iu })).toBeEnabled();
    const messageWindow = settings.getByRole('spinbutton', { name: /Chat (window message limit|message window)/iu });
    await expect(messageWindow).toBeEnabled();
    await messageWindow.fill('2100');
    await messageWindow.press('Enter');
    await expect(settings.getByText(/Background music|Music volume|Show text all at once|When the story appears|Open turn updates by default/u)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await world.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect(page.getByTestId('start-panel')).toBeVisible();
    await expect(page.getByText('No AI is set up yet.', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start Game', exact: true }).first().click();
    await expect(page).toHaveURL(/sid=/u);

    await page.getByRole('button', { name: 'Begin Adventure', exact: true }).click();
    await expect(page.getByText(openingLine, { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    expect(recordedRequests).toContainEqual({ model, operation: 'thought', key: 'Bearer ' + key });
    expect(recordedRequests.some(({ operation }) => operation === 'story' || operation === 'review')).toBe(false);
    recordedRequests.length = 0;

    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    async function openSettings() {
      await menu.click();
      await page.getByRole('group', { name: 'Menu', exact: true }).getByRole('button', { name: /^Settings/u }).click();
      await expect(settings.getByRole('button', { name: 'AI roles', exact: true })).toBeVisible();
    }
    await openSettings();
    await settings.getByRole('button', { name: 'Providers & keys', exact: true }).click();
    await settings.getByRole('button', { name: 'Add model', exact: true }).click();
    const addModel = page.getByRole('dialog', { name: 'Add model', exact: true });
    await addModel.getByRole('textbox', { name: /Model IDs/u }).fill(`${nextModel}\n${characterModel}\n${stateModel}`);
    await addModel.getByRole('button', { name: 'Add 3 models', exact: true }).click();
    await expect(addModel).not.toBeVisible();
    await settings.getByRole('button', { name: 'AI roles', exact: true }).click();
    await modelInput.selectOption({ label: nextModel });
    await expect(modelInput.locator('option:checked')).toHaveText(nextModel);
    const character = settings.getByRole('group', { name: 'character', exact: true });
    const characterInput = character.getByRole('combobox', { name: 'Model configuration', exact: true });
    await expect(characterInput).toBeVisible();
    await characterInput.selectOption({ label: characterModel });
    await expect(characterInput.locator('option:checked')).toHaveText(characterModel);
    const state = settings.getByRole('group', { name: 'state', exact: true });
    const stateInput = state.getByRole('combobox', { name: 'Model configuration', exact: true });
    await expect(stateInput).toBeVisible();
    await stateInput.selectOption({ label: stateModel });
    await expect(stateInput.locator('option:checked')).toHaveText(stateModel);
    await page.keyboard.press('Escape');

    const composer = page.getByTestId('game-composer-input');
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    await page.getByTestId('composer-mode-act').click();
    await composer.fill('I head to the river.');
    await composer.press('Enter');
    const landing = page.getByText(landingLine, { exact: false });
    await expect(landing).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    expect(recordedRequests.some(({ operation }) => operation === 'story')).toBe(false);
    expect(recordedRequests).toContainEqual({ model: characterModel, operation: 'thought', key: `Bearer ${key}` });

    recordedRequests.length = 0;
    await composer.fill(conversation);
    await composer.press('Enter');
    await expect(page.getByText(actorReply, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    expect(structuredRequests.speech).toHaveLength(2);
    expect(structuredRequests.speech[0]).toContain('{"type":"observe","choice":null,"words":null,"actorId":null}');
    expect(structuredRequests.speech[1]).toContain('previous reply did not match');
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    expect(recordedRequests).toContainEqual({ model: characterModel, operation: 'dialogue', key: `Bearer ${key}` });
    expect(recordedRequests).toContainEqual({ model: characterModel, operation: 'thought', key: `Bearer ${key}` });
    expect(recordedRequests.some(({ operation }) => operation === 'story')).toBe(false);
    expect(recordedRequests).toContainEqual({ model: stateModel, operation: 'intent', key: `Bearer ${key}` });
    await expect(page.getByText(privateThought, { exact: true })).toHaveCount(0);

    recordedRequests.length = 0;
    await composer.fill('Visit the riverside storehouse');
    await composer.press('Enter');
    await expect(page.getByText(storehouseLine, { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');
    expect(recordedRequests).toContainEqual({ model: stateModel, operation: 'storehouse', key: `Bearer ${key}` });

    await composer.fill(partialAction);
    await composer.press('Enter');
    await expect(page.getByText('You take a moment to look around.', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('What would you like to try here?', { exact: true })).toBeVisible();
    expect(structuredRequests.unclear).toHaveLength(2);
    await expect(page.getByTestId('game-composer')).toHaveAttribute('data-executing', 'false');

    await page.reload();
    await expect(page.getByText(actorReply, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    await menu.click();
    await page.getByRole('button', { name: /^This game's settings/u }).click();
    const gameSettings = page.getByTestId('session-settings-drawer');
    await expect(gameSettings.getByText('Current save', { exact: true })).toBeVisible();
    await expect(gameSettings.getByText(/^(Advanced|Auto-advance turns)$/u)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await openSettings();
    await settings.getByRole('button', { name: 'AI roles', exact: true }).click();
    await expect(modelInput.locator('option:checked')).toHaveText(nextModel);
    await settings.getByRole('button', { name: 'Preferences', exact: true }).click();
    await expect(messageWindow).toHaveValue('2100');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    const journal = page.getByRole('tabpanel', { name: 'Journal', exact: true });
    await expect(journal.getByText('Thames landing', { exact: true })).toBeVisible();
    await expect(journal.getByText('Seen at the landing', { exact: true })).toBeVisible();
    await expect(journal.getByText(privateThought, { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Testing view', exact: true }).click();
    const testing = page.frameLocator('iframe[title="Testing view"]').frameLocator('iframe[title="Plugin content"]');
    await expect(testing.getByText(privateThought, { exact: true })).toHaveCount(0);
    await testing.getByRole('button', { name: 'Reveal testing view' }).click();
    await expect(testing.getByText(privateThought, { exact: false }).first()).toBeVisible();
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
