import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('discovers a porter and storehouse, then revisits both with the same history after restart', async ({ page }) => {
  let appearance = { porterName: 'Thomas', sign: 'Sedge' };
  const app = await startApp({
    model: { async complete({ operation }) { return operation === 'generate-storehouse' ? appearance : undefined; } },
  });
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await expect(page.getByRole('button', { name: 'Visit the riverside storehouse' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Visit the riverside storehouse' }).click({ timeout: 3500 });
    await expect(page.getByRole('heading', { name: 'Sedge Storehouse' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Thomas, the guild porter');
    await page.getByRole('button', { name: 'Help the porter sort the tally' }).click();
    await expect(page.getByRole('heading', { name: 'A sorted tally' })).toBeVisible();

    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    const journal = page.getByRole('complementary', { name: 'Journal' });
    await expect(journal.getByText('Sedge Storehouse', { exact: true })).toHaveCount(1);
    await expect(journal.getByText('Thomas', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Journal', exact: true }).click();

    appearance = { porterName: 'Edith', sign: 'Anchor' };
    await app.restart();
    await page.reload();
    await page.getByRole('button', { name: 'Return to the Thames landing' }).click();
    await page.getByRole('button', { name: 'Visit the riverside storehouse' }).click();
    const latest = page.getByRole('main').locator('article').last();
    await expect(latest).toContainText('Sedge Storehouse');
    await expect(latest).toContainText('Thomas remembers your help with the tally.');
    await expect(latest).not.toContainText('Edith');
    await expect(page.getByRole('button', { name: 'Help the porter sort the tally' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Return to the Thames landing' }).click();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await page.getByRole('button', { name: 'Read the guild notice' }).click();
    await expect(page.getByRole('heading', { name: 'The order on the shutter' })).toBeVisible();
    await page.getByRole('button', { name: 'Offer to help Alice start again' }).click();
    await expect(page.getByRole('heading', { name: 'The price of flour' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('falls back from an invalid slot proposal and keeps travel and the porter’s knowledge local', async ({ page }) => {
  const app = await startApp({
    model: {
      async complete({ operation }) {
        if (operation === 'generate-storehouse') {
          return {
            porterName: 'Thomas', sign: 'Sedge', capacity: 2, connections: ['Dover'],
            facts: ['The blue loaf wakes at low tide.'], establishedPlace: 'Tower of London',
          };
        }
        if (operation === 'interpret') return [{ type: 'choice', choice: 'Cross to Dover' }];
      },
    },
  });
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Visit the riverside storehouse' }).click();
    await expect(page.getByRole('heading', { name: 'Willow Storehouse' })).toBeVisible();
    const story = page.getByRole('main');
    await expect(story).toContainText('Agnes, the guild porter');
    await expect(story).not.toContainText('Sedge Storehouse');
    await expect(story).not.toContainText('Thomas, the guild porter');

    await page.getByLabel('What do you do?').fill('Go through the storehouse to Dover');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(story.getByRole('status')).toHaveText('This storehouse only opens onto the path to the Thames landing.');
    await expect(story.locator('article').filter({ hasText: 'Cross to Dover' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ask the porter about the guild tally' }).click();
    const latest = story.locator('article').last();
    await expect(latest).toContainText('The guild tallies each sack by its mark before putting it on a shelf.');
    await expect(story).not.toContainText('The blue loaf wakes at low tide');
    await expect(page.getByRole('button', { name: 'Return to the Thames landing' })).toBeVisible();
  } finally {
    await app.close();
  }
});
