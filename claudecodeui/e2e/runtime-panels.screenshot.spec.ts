import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const screenshotPath = resolve(
  process.cwd(),
  'output/playwright/screenshots/REQ-043-runtime-shell-baseline.png',
);

test('REQ-043 captures a runtime shell screenshot @screenshot', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  await expect(page.locator('body')).toContainText(/Argus|Projects|Settings|No projects|快速对话/i);

  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const file = await stat(screenshotPath);
  expect(file.size).toBeGreaterThan(0);
});
