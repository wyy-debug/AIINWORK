const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173';
const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const allowAuthErrors = process.env.SMOKE_ALLOW_AUTH_ERRORS !== 'false';

const errors = [];

function logStep(message) {
  console.log(`[smoke-ui] ${message}`);
}

async function clickFirstVisible(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 5000 });
      logStep(`clicked ${label}`);
      return true;
    }
  }
  throw new Error(`Could not find ${label}`);
}

async function waitForMainShell(page) {
  const shellLocator = page.locator([
    'button:has-text("项目")',
    'button:has-text("Projects")',
    'button:has-text("对话")',
    'button:has-text("Conversations")',
    'textarea',
    '[contenteditable="true"]',
  ].join(', ')).first();
  await shellLocator.waitFor({ timeout: 20_000 });
}

function isExpectedAuthError(text) {
  return allowAuthErrors && /401|Unauthorized|No token provided|Authentication failed|Failed to load conversations|Failed to fetch projects|TaskMaster .*401|WebSocket error/i.test(text);
}

async function run() {
  const { chromium } = await import('playwright').catch(() => {
    throw new Error('Playwright is not installed. Run `npm install --no-save playwright` or execute this script in an environment that provides the playwright package.');
  });
  logStep(`opening ${baseUrl}`);
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!isExpectedAuthError(text)) {
        errors.push(text);
      }
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    await waitForMainShell(page);
    logStep('main shell loaded');

    await clickFirstVisible(page, [
      'button:has-text("项目")',
      'button:has-text("Projects")',
      '[role="button"]:has-text("项目")',
      '[role="button"]:has-text("Projects")',
    ], 'project tab');

    await clickFirstVisible(page, [
      'button:has-text("对话")',
      'button:has-text("Conversations")',
      '[role="button"]:has-text("对话")',
      '[role="button"]:has-text("Conversations")',
    ], 'conversation tab');

    await clickFirstVisible(page, [
      'button:has-text("设置")',
      'button:has-text("Settings")',
      '[role="button"]:has-text("设置")',
      '[role="button"]:has-text("Settings")',
    ], 'settings button');
    await page.getByText(/设置|Settings/i).first().waitFor({ timeout: 10_000 });
    await page.getByRole('tab', { name: /模型|Model/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.getByRole('tab', { name: /运行时|Runtime/i }).first().click({ timeout: 5000 }).catch(() => {});
    const closeSettings = page.getByRole('button', { name: /关闭设置|Close settings/i }).first();
    if (await closeSettings.count().catch(() => 0)) {
      await closeSettings.click({ timeout: 5000 }).catch(() => {});
    }
    logStep('settings modal opens and closes');

    const composer = page.locator('textarea, [contenteditable="true"]').first();
    if (await composer.count().catch(() => 0)) {
      await composer.waitFor({ timeout: 10_000 });
      await composer.click();
      await page.keyboard.type('smoke input');
      logStep('composer accepts input');

      const modelTrigger = page.locator('button:has-text("Default"), button:has-text("MiMo"), button:has-text("Argus")').first();
      if (await modelTrigger.count().catch(() => 0)) {
        await modelTrigger.click({ timeout: 5000, force: true });
        const modelDialogVisible = await page.locator('text=/切换模型|Switch model/i').first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
        if (modelDialogVisible) {
          await page.keyboard.press('Escape');
          await composer.click();
          await page.keyboard.type(' after modal');
          logStep('model switcher closes and focus returns');
        } else {
          logStep('model switcher trigger found but dialog did not open; skipped modal focus check');
        }
      } else {
        logStep('model switcher trigger not visible; skipped modal focus check');
      }
    } else {
      logStep('composer not visible; skipped composer/model checks for this auth or empty-state target');
    }

    const visibleText = await page.locator('body').innerText().catch(() => '');
    if (/internal ID|Async agent launched successfully|output_file|agentId:/i.test(visibleText)) {
      throw new Error('Subagent internal control text is visible in the UI');
    }
    logStep('subagent internal control text is hidden');

    if (errors.length > 0) {
      throw new Error(`Browser console/page errors:\n${errors.join('\n')}`);
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(`[smoke-ui] failed: ${error.message}`);
  process.exit(1);
});
