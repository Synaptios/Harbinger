import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('starts a fresh story from the save library and keeps the previous playthrough after reload', async ({ page }) => {
  const app = await startApp();
  try {
    const saves = page.getByRole('button', { name: 'Saves', exact: true });
    const library = page.getByRole('dialog', { name: 'Save library' });
    const draft = page.getByLabel('What do you do?');
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await draft.fill('Ask Alice about the flour.');

    await saves.click();
    await library.getByRole('button', { name: 'New story', exact: true }).click({ timeout: 3500 });
    await expect(library).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alice’s bakehouse' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toHaveCount(0);
    await expect(draft).toHaveValue('');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Alice’s bakehouse' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toHaveCount(0);
    await saves.click();
    await library.getByRole('button', { name: /The Bread Ledger.*Turn 1/ }).click();
    await expect(page.getByRole('heading', { name: 'Thames landing' })).toBeVisible();
    await expect(draft).toHaveValue('Ask Alice about the flour.');
  } finally {
    await app.close();
  }
});
