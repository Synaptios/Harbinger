import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('the testing view reveals attributed onstage and offstage thoughts only after opt-in', async ({ page }) => {
  const app = await startApp();
  const testingRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('/testing')) testingRequests.push(request.url());
  });
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();

    const phrase = 'The blue loaf wakes at low tide.';
    const saveId = await page.evaluate(() => localStorage.getItem('harbinger.active'));
    const saveUrl = app.url + '/api/saves/' + saveId;
    const publicSave = await (await page.request.get(saveUrl)).json();
    expect(JSON.stringify(publicSave)).not.toContain(phrase);
    await expect(page.getByRole('main')).not.toContainText(phrase);

    await page.getByRole('button', { name: 'Testing view' }).click();
    const view = page.getByRole('dialog', { name: 'Testing view' });
    await expect(view.getByText('Story spoilers', { exact: false })).toBeVisible();
    expect(testingRequests).toEqual([]);
    await view.getByRole('button', { name: 'Reveal private thoughts' }).click();
    const latest = view.getByRole('region', { name: 'Turn 2' });
    const alice = latest.getByRole('article', { name: 'Alice' });
    const martin = latest.getByRole('article', { name: 'Martin' });
    await expect(alice.getByText('Onstage', { exact: true })).toBeVisible();
    await expect(alice.getByRole('blockquote')).toHaveText(/^I .*The blue loaf wakes at low tide/u);
    await expect(alice.getByText('The Tower carter told Alice at the landing.', { exact: false })).toBeVisible();
    await expect(martin.getByText('Offstage', { exact: true })).toBeVisible();
    await expect(martin.getByRole('blockquote')).toHaveText(/^I /u);
    await expect(martin).not.toContainText(phrase);
    await expect(latest.getByText('The inspection sealed the oven.', { exact: false })).toBeVisible();
    expect(testingRequests).toHaveLength(1);

    await view.getByRole('combobox', { name: 'Sort turns' }).selectOption({ label: 'Oldest first' });
    await expect(view.getByRole('region').first()).toHaveAccessibleName('Opening');
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
    await expect(page.getByRole('button', { name: 'Testing view' })).toBeFocused();
    expect(await (await page.request.get(saveUrl)).json()).toEqual(publicSave);
    await expect(page.getByText(phrase, { exact: false })).toHaveCount(0);
  } finally {
    await page.close();
    await app.close();
  }
});

test('intermediate participants retain their first-person entries when several actions commit in one turn', async ({ request }) => {
  const model = {
    async complete({ operation }) {
      if (operation === 'actor-thought') throw new Error('Provider offline');
      return ['Go with Alice to the river', 'Help Alice load the flour', 'Read the guild notice']
        .map(choice => ({ type: 'choice', choice }));
    },
  };
  const app = await startApp({ model });
  try {
    const save = await (await request.post(app.url + '/api/saves', { data: {} })).json();
    const url = app.url + '/api/saves/' + save.id;
    const result = await request.post(url + '/turns', {
      data: { text: 'Follow Alice, load the flour, and read the notice.', requestId: 'one-batch', revision: 0 },
    });
    expect(result.ok()).toBe(true);
    expect((await result.json()).scene.heading).toBe('The order on the shutter');
    const { thoughts } = await (await request.get(url + '/testing')).json();
    const turn = thoughts.filter(entry => entry.turn === 1);
    expect(turn).toContainEqual(expect.objectContaining({ name: 'River carter', presence: 'onstage', text: expect.stringMatching(/^I /) }));
    expect(turn).toContainEqual(expect.objectContaining({ name: 'Errand boy', presence: 'onstage', text: expect.stringMatching(/^I[ ’']/) }));
    expect(turn).toContainEqual(expect.objectContaining({ name: 'Martin', presence: 'offstage', text: expect.stringMatching(/^I /) }));
  } finally {
    await app.close();
  }
});
