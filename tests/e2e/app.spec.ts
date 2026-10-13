import { expect, test } from '@playwright/test';
import { blockedRequests, fakeGitHub } from './fixtures';

test.beforeEach(async ({ page }) => {
  blockedRequests.length = 0;
  await fakeGitHub(page);
});
test.afterEach(() => {
  expect(blockedRequests, 'requests to unfaked hosts').toEqual([]);
});

test('customize the gland: form, live preview, export, share link', async ({ page }) => {
  await page.goto('#/gh/demo/gland/cable_gland.scad');
  await expect(page.getByText('Cables', { exact: true })).toBeVisible();
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  const sizeBefore = await page.getByTestId('model-size').textContent();
  expect(sizeBefore).toMatch(/^\d+\.\d × \d+\.\d × \d+\.\d mm$/);

  await page.getByText('Cables', { exact: true }).click(); // open the group if collapsed
  await page.getByLabel('cable_count value', { exact: true }).fill('3');
  await page.getByLabel('cable_count value', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/cable_count=3/);
  await expect(page.getByTestId('model-size')).not.toHaveText(sizeBefore!, { timeout: 30_000 });
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });

  const download = page.waitForEvent('download');
  await page.getByTestId('export-stl').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cable_gland-[0-9a-f]{8}\.stl$/);

  const url = page.url();
  const fresh = await page.context().newPage();
  await fakeGitHub(fresh);
  await fresh.goto(url);
  await expect(fresh.getByLabel('cable_count value', { exact: true })).toHaveValue('3');
});

test('presets from the OpenSCAD preset file', async ({ page }) => {
  await page.goto('#/gh/demo/gland/cable_gland.scad');
  await page.getByLabel('Preset').selectOption('Three cables');
  await expect(page).toHaveURL(/preset=Three\+cables/);
  await expect(page.getByLabel('part', { exact: true })).toHaveValue('2'); // index of "nut"
});

test('picker, includes, and missing library notice', async ({ page }) => {
  await page.goto('#/gh/demo/multi');
  await expect(page.getByTestId('picker-card')).toHaveCount(2);
  await expect(page.getByTestId('notice').filter({ hasText: "Library nope isn't bundled" })).toBeVisible();
  await page.getByTestId('picker-card').filter({ hasText: 'a.scad' }).click();
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  await expect(page.getByTestId('model-size')).toHaveText('10.0 × 10.0 × 10.0 mm');
});

test('unknown repo shows an error', async ({ page }) => {
  await page.goto('#/gh/demo/does-not-exist');
  await expect(page.getByRole('alert')).toContainText("Couldn't find demo/does-not-exist");
});

test('source drawer edits re-render', async ({ page }) => {
  await page.goto('#/gh/demo/multi/a.scad');
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  await page.getByTestId('source-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\ntranslate([20,0,0]) cube(1);');
  await expect(page.getByText('Edited locally – not saved to repo')).toBeVisible();
  await expect(page.getByTestId('model-size')).toHaveText('26.0 × 10.0 × 10.0 mm', { timeout: 30_000 });
});

test('mobile layout puts the viewer above the form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/gh/demo/multi/a.scad');
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  const viewer = await page.getByTestId('viewer').boundingBox();
  const form = await page.locator('.params').boundingBox();
  expect(viewer!.y).toBeLessThan(form!.y);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
