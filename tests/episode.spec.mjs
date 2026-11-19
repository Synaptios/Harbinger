import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('the clerk learns what happened at the missed inspection and finishes Alice’s route after a restart', async ({ page }) => {
  const app = await startApp();
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: 'The Bread Ledger' })).toBeVisible();
    await page.getByRole('button', { name: 'Begin story' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Alice’s bakehouse' })).toBeVisible();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();

    await app.restart();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(page.getByText('a written order pinned to the shutter', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Read the guild notice' }).click();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story.getByText('No ledger was produced', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Offer to help Alice start again' }).click();
    await expect(page.getByRole('heading', { name: 'The price of flour' })).toBeVisible();
    await expect(page.getByText('Come at first light', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(page.locator('body')).not.toContainText('The blue loaf wakes at low tide');
  } finally {
    await app.close();
  }
});
