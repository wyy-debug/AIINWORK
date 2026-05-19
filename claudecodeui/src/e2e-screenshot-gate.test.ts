import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('E2E screenshot evidence gate', () => {
  it('exposes Playwright E2E scripts and configuration', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['test:e2e']).toBe('playwright test --config=playwright.config.ts');
    expect(packageJson.scripts['test:e2e:ui']).toBe('playwright test --ui --config=playwright.config.ts');
    expect(packageJson.scripts['test:e2e:screenshots']).toBe('playwright test --config=playwright.config.ts --grep @screenshot');
    expect(packageJson.devDependencies['@playwright/test']).toBeTruthy();
    expect(existsSync(resolve(root, 'playwright.config.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'e2e/runtime-panels.screenshot.spec.ts'))).toBe(true);
  });
});
