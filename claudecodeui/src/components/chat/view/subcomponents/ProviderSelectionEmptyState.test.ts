import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('ProviderSelectionEmptyState Agent picker layout', () => {
  it('allows long Agent names to wrap in a wider dropdown menu', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'ProviderSelectionEmptyState.tsx'), 'utf8');
    const dropdownStart = source.indexOf('{isOpen && (');
    const optionsStart = source.indexOf('{agents.map', dropdownStart);
    const optionsEnd = source.indexOf('</div>', optionsStart);

    expect(dropdownStart).toBeGreaterThan(-1);
    expect(optionsStart).toBeGreaterThan(dropdownStart);
    expect(optionsEnd).toBeGreaterThan(optionsStart);

    const menuBlock = source.slice(dropdownStart, optionsStart);
    const optionsBlock = source.slice(optionsStart, optionsEnd);

    expect(menuBlock).toContain('left-1/2');
    expect(menuBlock).toContain('w-[22rem]');
    expect(menuBlock).toContain('max-w-[calc(100vw-2rem)]');
    expect(optionsBlock).toContain('items-start');
    expect(optionsBlock).toContain('whitespace-normal');
    expect(optionsBlock).toContain('break-words');
    expect(optionsBlock).not.toContain('truncate');
  });
});
