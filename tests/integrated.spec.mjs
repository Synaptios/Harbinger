import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startApp } from './app-fixture.mjs';

for (const width of [1280, 320]) {
  test(`the complete river route supports source navigation, private testing, and portable continuation at ${width}px`, async ({ page }) => {
    const source = await startApp({
      model: {
        async complete({ operation }) {
          if (operation === 'generate-storehouse') return { porterName: 'Thomas', sign: 'Sedge' };
          return { index: 0 };
        },
      },
    });
    const destination = await startApp();
    const press = name => page.getByRole('button', { name, exact: true }).click();
    try {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(source.url);
      const beginnings = page.getByRole('button', { name: 'Begin story' });
      await beginnings.focus();
      await page.keyboard.press('Enter');
      await press('Go with Alice to the river');
      await press('Visit the riverside storehouse');
      const story = page.getByRole('main');
      await expect(story.getByRole('heading', { name: 'Sedge Storehouse' })).toBeVisible();
      await expect(story).toContainText('Thomas, the guild porter');
      await press('Help the porter sort the tally');
      await expect(story.getByRole('heading', { name: 'A sorted tally' })).toBeVisible();

      const draft = story.getByRole('textbox', { name: 'What do you do?' });
      await draft.fill('I should check in on the apprentice tomorrow.');
      await press('Journal');
      const journal = page.getByRole(width === 320 ? 'dialog' : 'complementary', { name: 'Journal' });
      await expect(journal.getByRole('searchbox', { name: 'Search the Journal' })).toBeVisible();
      const visit = journal.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Thomas', exact: true }) });
      await visit.getByRole('link', { name: 'View source · Meeting at the storehouse' }).click();
      const sourcePassage = story.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Sedge Storehouse', exact: true }) });
      await expect(sourcePassage).toBeFocused();
      await expect(draft).toHaveValue('I should check in on the apprentice tomorrow.');
      if (width !== 320) await journal.getByRole('button', { name: 'Close Journal' }).click();

      await press('Return to the Thames landing');
      await press('Help Alice load the flour');
      await expect(story.getByRole('heading', { name: 'A key at dusk' })).toBeVisible();
      const secret = 'The blue loaf wakes at low tide.';
      await expect(story).not.toContainText(secret);
      const testingButton = page.getByRole('button', { name: 'Testing view' });
      await testingButton.click();
      const testing = page.getByRole('dialog', { name: 'Testing view' });
      await expect(testing).toContainText('Story spoilers.');
      await expect(testing).not.toContainText(secret);
      await testing.getByRole('button', { name: 'Reveal private thoughts' }).press('Enter');
      await expect(testing).toContainText(secret);
      await expect(testing).toContainText('The inspection sealed the oven.');
      await page.keyboard.press('Escape');
      await expect(testingButton).toBeFocused();
      await expect(testing).toBeHidden();
      await expect(draft).toHaveValue('I should check in on the apprentice tomorrow.');
      await expect(page.getByText(secret, { exact: false })).toHaveCount(0);

      await press('Saves');
      const library = page.getByRole('dialog', { name: 'Save library' });
      await library.getByRole('button', { name: 'Duplicate current save' }).click();
      await expect(library.getByRole('status')).toHaveText('Created The Bread Ledger (copy).');
      await expect(library.getByRole('button', { name: 'The Bread Ledger', exact: true })).toHaveAttribute('aria-current', 'true');
      await library.getByRole('button', { name: 'The Bread Ledger (copy)', exact: true }).click();
      await expect(library).toBeHidden();
      await press('Saves');
      const download = page.waitForEvent('download');
      await library.getByRole('link', { name: 'Export complete save (includes hidden state)' }).click();
      const buffer = await readFile(await (await download).path());

      await page.goto(destination.url);
      await press('Saves');
      await library.getByLabel('Import complete save').setInputFiles({
        name: 'bread-ledger-copy.json', mimeType: 'application/json', buffer,
      });
      await expect(library.getByRole('status')).toHaveText('Imported The Bread Ledger (copy).');
      await library.getByRole('button', { name: 'The Bread Ledger (copy)', exact: true }).click();
      await expect(story.getByRole('heading', { name: 'Sedge Storehouse' })).toBeVisible();
      await press('Read the guild notice');
      await press('Offer to help Alice start again');
      await expect(story.getByRole('heading', { name: 'The price of flour' })).toBeVisible();
      await expect(story).toContainText('Come at first light.');
      await expect(story).not.toContainText(secret);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally {
      await page.close();
      await Promise.all([source.close(), destination.close()]);
    }
  });
}
