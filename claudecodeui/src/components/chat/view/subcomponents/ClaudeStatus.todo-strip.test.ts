import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('ClaudeStatus todo strip layout', () => {
  it('keeps the old status bar out of the composer and renders todo/lamp controls near send', () => {
    const statusSource = readFileSync(resolve(currentDir, 'ClaudeStatus.tsx'), 'utf8');
    const composerSource = readFileSync(resolve(currentDir, 'ChatComposer.tsx'), 'utf8');

    expect(statusSource).toContain('todoItems?: Array<');
    expect(composerSource).not.toContain("import ClaudeStatus from './ClaudeStatus';");
    expect(composerSource).not.toContain('<ClaudeStatus');

    expect(composerSource).toContain("['TodoWrite', 'TodoRead'].includes(String(message.toolName || ''))");
    expect(composerSource).toContain('const statusTodoItems = useMemo(() => getStatusTodoItems(messages), [messages]);');
    expect(composerSource).toContain('statusTodoItems.slice(0, 3).map((todo, index) => (');
    expect(composerSource).toContain("title={t('claudeStatus.controls.stop', { defaultValue: '停止' })}");
    expect(composerSource).toContain('onClick={onAbortSession}');
    expect(composerSource).toContain('group-hover:inline');
    expect(composerSource).toContain('animate-ping rounded-full bg-emerald-400/70');
  });
});
