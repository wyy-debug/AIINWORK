import { describe, expect, it } from 'vitest';

import { unescapeWithMathProtection } from './chatFormatting';

describe('unescapeWithMathProtection', () => {
  it('keeps Windows paths intact when they contain backslash escape sequences', () => {
    expect(unescapeWithMathProtection('D:\\SOC\\trunk\\Assets')).toBe('D:\\SOC\\trunk\\Assets');
    expect(unescapeWithMathProtection('C:\\repo\\release\\notes.txt')).toBe('C:\\repo\\release\\notes.txt');
  });

  it('still decodes escaped newlines in normal prose', () => {
    expect(unescapeWithMathProtection('Line 1\\nLine 2')).toBe('Line 1\nLine 2');
  });

  it('preserves math blocks while decoding text outside them', () => {
    expect(unescapeWithMathProtection('Before\\n$\\text{keep\\\\there}$\\nAfter')).toBe('Before\n$\\text{keep\\\\there}$\nAfter');
  });
});
