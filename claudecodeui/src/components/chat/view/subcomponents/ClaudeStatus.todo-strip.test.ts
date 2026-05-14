import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('ClaudeStatus todo strip layout', () => {
  it('shows the todo strip in the status bar and reduces generic processing to a pulse lamp', () => {
    const statusSource = readFileSync(resolve(currentDir, 'ClaudeStatus.tsx'), 'utf8');
    const composerSource = readFileSync(resolve(currentDir, 'ChatComposer.tsx'), 'utf8');

    expect(statusSource).toContain('todoItems?: Array<');
    expect(statusSource).toContain('const showCompactProcessingLamp = hasTodoItems && genericLoadingState;');
    expect(statusSource).toContain('Todo');
    expect(statusSource).toContain('visibleTodoItems.map((item, index) => (');

    expect(composerSource).toContain("['TodoWrite', 'TodoRead'].includes(String(message.toolName || ''))");
    expect(composerSource).toContain('const statusTodoItems = useMemo(() => getStatusTodoItems(messages), [messages]);');
    expect(composerSource).toContain('todoItems={statusTodoItems}');
  });
});
