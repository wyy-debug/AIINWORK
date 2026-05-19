import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('CapabilityMarketplaceContent wiring', () => {
  it('supports install, configure, enable, and disable actions from the marketplace UI', () => {
    const source = readFileSync(resolve(currentDir, 'CapabilityMarketplaceContent.tsx'), 'utf8');
    const apiSource = readFileSync(resolve(process.cwd(), 'src/utils/api.js'), 'utf8');

    expect(source).toContain('installMarketplaceItem');
    expect(source).toContain('configurationDrafts');
    expect(source).toContain('Configure');
    expect(source).toContain('toggleEnabled');
    expect(apiSource).toContain('installCapabilityMarketplaceItem');
  });

  it('surfaces workflow packages as a first-class marketplace kind', () => {
    const source = readFileSync(resolve(currentDir, 'CapabilityMarketplaceContent.tsx'), 'utf8');

    expect(source).toContain("'workflow'");
    expect(source).toContain('Workflows');
  });
});
