import { expect, test } from '@playwright/test';

test('intentional browser failure proves the stable e2e check fails closed', async ({ page }) => {
  await page.goto('/');
  expect(await page.title()).toBe('INTENTIONAL CI AGGREGATION FAILURE');
});
