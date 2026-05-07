import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('argus bridge Obsidian plugin main', () => {
  it('exposes token copy, recent errors, and recent write details in settings', async () => {
    const source = await readFile('obsidian-plugins/argus-bridge/main.js', 'utf8');

    expect(source).toContain('copyToken');
    expect(source).toContain("require('./core.js')");
    expect(source).toContain('recentErrors');
    expect(source).toContain('Last error');
    expect(source).toContain('Recent writes');
    expect(source).toContain('Copy');
  });

  it('registers active note, patch, query, periodic, graph, and reverse-send commands', async () => {
    const source = await readFile('obsidian-plugins/argus-bridge/main.js', 'utf8');

    for (const route of [
      '/argus/v1/active',
      '/argus/v1/patch',
      '/argus/v1/query',
      '/argus/v1/periodic/append',
      '/argus/v1/graph',
      '/argus/v1/duplicates/scan',
      '/argus/v1/duplicates/archive',
    ]) {
      expect(source).toContain(route);
    }

    for (const commandId of [
      'argus-bridge-start',
      'argus-bridge-stop',
      'argus-bridge-restart',
      'argus-bridge-send-current-note',
      'argus-bridge-send-selected-text',
      'argus-bridge-create-memory-from-selection',
      'argus-bridge-ask-about-note',
      'argus-bridge-append-selection-to-daily',
    ]) {
      expect(source).toContain(commandId);
    }

    expect(source).toContain('sendToArgusIngress');
    expect(source).toContain('appendToPeriodicNote');
    expect(source).toContain('archiveDuplicateNotes');
  });
});
