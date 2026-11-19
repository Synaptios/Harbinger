import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('a market observer learns the consequences of the missed inspection from a reachable witness', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const pursuit = page.getByRole('button', { name: 'Ask the carters in the market' });
    await expect(pursuit).toBeVisible({ timeout: 2000 });
    await pursuit.click();
    await expect(page.getByRole('heading', { name: 'The market tally' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'The market tally' })).toBeVisible();
    await expect(page.getByText('the guild has closed Alice’s oven', { exact: false })).toHaveCount(0);

    await page.getByRole('button', { name: 'Wait for the market tally' }).click();
    await expect(page.getByRole('heading', { name: 'A warning by the stall' })).toBeVisible();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story.getByText('the guild has closed Alice’s oven', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Read the market copy of the order' }).click();
    await expect(story.getByText('No ledger was produced', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Help Alice find another oven' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the clerk can ignore the market lead without learning the order firsthand', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Ask the carters in the market' }).click();
    await page.getByRole('button', { name: 'Wait for the market tally' }).click();
    const ignore = page.getByRole('button', { name: 'Leave the market copy unread' });
    await expect(ignore).toBeVisible({ timeout: 2000 });
    await ignore.click();
    await expect(page.getByRole('heading', { name: 'After the market' })).toBeVisible();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story.getByText('No ledger was produced', { exact: false })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the written order links its firsthand account to the earlier witness', async ({ request }) => {
  const app = await startApp();
  try {
    const create = await request.post(`${app.url}/api/saves`, { data: {} });
    expect(create.ok()).toBe(true);
    let save = await create.json();
    expect(save.observations).toContainEqual(expect.objectContaining({ kind: 'person', title: 'Alice' }));
    expect(save.observations).toContainEqual(expect.objectContaining({ kind: 'person', title: 'Martin' }));
    const turn = async text => {
      const response = await request.post(`${app.url}/api/saves/${save.id}/turns`, {
        data: { text, revision: save.revision, requestId: `director-${save.revision}` },
      });
      expect(response.ok()).toBe(true);
      save = await response.json();
    };
    await turn('Go with Alice to the river');
    await turn('Help Alice load the flour');
    const report = save.observations.find(observation => observation.source === 'Errand boy');
    expect(report.status).toBe('reported');
    await turn('Read the guild notice');
    const order = save.observations.find(observation => observation.title === 'Guild closure order');
    expect(order).toMatchObject({ status: 'firsthand', supersedes: report.id });
    expect(order.passageId).not.toBe(report.passageId);
    expect(save.observations).toContainEqual(report);
    expect(save).not.toHaveProperty('directorTrace');
  } finally {
    await app.close();
  }
});
