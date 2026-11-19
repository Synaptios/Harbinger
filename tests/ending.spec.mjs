import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('giving the guild the names keeps the oven open and costs the clerk Alice’s trust', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const walk = page.getByRole('button', { name: 'Take the ledger to Martin' });
    await expect(walk).toBeVisible();
    await walk.click();
    await expect(page.getByRole('heading', { name: 'The last entry' })).toBeVisible();
    await page.getByRole('button', { name: 'Give Martin the names' }).click();
    await expect(page.getByRole('heading', { name: 'The key comes off the nail' })).toBeVisible();
    const story = page.getByRole('region', { name: 'Story passage' });
    await expect(story).toContainText('Leave the wood by the door tomorrow');
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page.getByText('Guild license on the shutter', { exact: true })).toBeVisible();
  } finally {
    await page.close();
    await app.close();
  }
});

test('the clerk can leave the guild with the ledger and face the missed inspection', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Take the ledger to Martin' }).click();
    const leave = page.getByRole('button', { name: 'Return to the bakehouse with the ledger' });
    await expect(leave).toBeVisible();
    await leave.click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Story passage' })).toContainText('The ledger is still under your arm');
    await page.getByRole('button', { name: 'Read the guild notice' }).click();
    await expect(page.getByRole('region', { name: 'Story passage' })).toContainText('No ledger was produced');
    await page.getByRole('button', { name: 'Offer to help Alice start again' }).click();
    await expect(page.getByRole('region', { name: 'Story passage' })).toContainText('The sacks still wait at the landing');
  } finally {
    await page.close();
    await app.close();
  }
});
