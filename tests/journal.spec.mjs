import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

test('a narrow-screen reader follows Journal evidence back to the passage with their draft intact', async ({ page }) => {
  const app = await startApp();
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    const draft = page.getByRole('textbox', { name: 'What do you do?' });
    await draft.fill('Wait for Alice to come back.');

    const journalButton = page.getByRole('button', { name: 'Journal' });
    await journalButton.focus();
    await page.keyboard.press('Enter');
    const journal = page.getByRole('dialog', { name: 'Journal' });
    await expect(journal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(journalButton).toBeFocused();

    await page.keyboard.press('Enter');
    await journal.getByRole('link', { name: 'View source · London crier' }).click();
    await expect(journal).toBeHidden();
    await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: 'Alice’s bakehouse' }) })).toBeFocused();
    await expect(draft).toHaveValue('Wait for Alice to come back.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await page.close();
    await app.close();
  }
});

test('search indexes public evidence and omits the restricted carter phrase', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Journal' }).click();
    const journal = page.getByRole('complementary', { name: 'Journal' });
    await expect(journal.getByText('The proclamation', { exact: true })).toBeVisible();
    await expect(journal.getByText('Reported', { exact: true })).toBeVisible();
    await expect(journal).not.toContainText('The blue loaf wakes at low tide');
    const search = journal.getByRole('searchbox', { name: 'Search the Journal' });
    await expect(search).toBeVisible();
    await search.fill('blue loaf');
    await expect(journal.getByRole('status', { name: 'Journal results' })).toHaveText('0 entries');
    await search.fill('Launcelot');
    await expect(journal.getByRole('status', { name: 'Journal results' })).toHaveText('1 entry');
    await expect(journal.getByRole('link', { name: 'View source · London crier' })).toBeVisible();
  } finally {
    await page.close();
    await app.close();
  }
});

test('private Journal notes survive a restart and stay out of the narrative', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Journal' }).click();
    const notes = page.getByRole('textbox', { name: 'Private notes' });
    await expect(notes).toBeVisible();
    await notes.fill('Remember the account of the copper spoon.');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.getByRole('status', { name: 'Notes status' })).toHaveText('Notes saved.');

    await page.goto('about:blank');
    await app.restart();
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(notes).toHaveValue('Remember the account of the copper spoon.');
    await expect(page.getByRole('main')).not.toContainText('copper spoon');
  } finally {
    await page.close();
    await app.close();
  }
});

test('a new firsthand account updates the open Journal and keeps the prior source linked', async ({ page }) => {
  const app = await startApp();
  const gate = Promise.withResolvers();
  const pendingTurn = Promise.withResolvers();
  try {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await page.getByRole('button', { name: 'Journal' }).click();
    const journal = page.getByRole('complementary', { name: 'Journal' });
    const report = journal.getByRole('article').filter({ hasText: 'The oven may be sealed' });
    const order = journal.getByRole('article').filter({ hasText: 'Guild closure order' });
    await expect(report.getByText('Reported', { exact: true })).toBeVisible();

    await page.route('**/turns', async route => {
      pendingTurn.resolve();
      await gate.promise;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Read the guild notice' }).click();
    await pendingTurn.promise;
    await expect(journal.getByRole('searchbox')).toBeEnabled();
    await expect(report.getByRole('link', { name: 'View source · Errand boy' })).toBeVisible();
    await expect(order).toHaveCount(0);

    gate.resolve();
    await expect(order.getByText('Firsthand', { exact: true })).toBeVisible();
    await expect(order.getByRole('link', { name: 'Prior account · Errand boy' })).toBeVisible();
    await order.getByRole('link', { name: 'View source · Written order on the bakehouse' }).click();
    await expect(page.locator('main article').filter({ has: page.getByRole('heading', { name: 'The order on the shutter' }) })).toBeFocused();
  } finally {
    gate.resolve();
    await page.close();
    await app.close();
  }
});

test('the reader can open and dismiss the mobile Journal midway through a long story', async ({ page }) => {
  const app = await startApp();
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Begin story' }).click();
    await page.getByRole('button', { name: 'Go with Alice to the river' }).click();
    await page.getByRole('button', { name: 'Help Alice load the flour' }).click();
    await expect(page.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 3)));
    const readingOffset = await page.evaluate(() => window.scrollY);
    expect(readingOffset).toBeGreaterThan(200);
    const toolbarButton = await page.getByRole('button', { name: 'Journal' }).boundingBox();
    expect(toolbarButton?.y).toBeGreaterThanOrEqual(0);
    await page.mouse.click(toolbarButton.x + toolbarButton.width / 2, toolbarButton.y + toolbarButton.height / 2);
    await page.getByRole('button', { name: 'Close Journal' }).click();
    await expect(page.getByRole('button', { name: 'Journal' })).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(readingOffset);
  } finally {
    await page.close();
    await app.close();
  }
});
