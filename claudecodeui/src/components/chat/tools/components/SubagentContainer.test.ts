import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubagentContainer } from './SubagentContainer';

describe('SubagentContainer', () => {
  it('renders collapsed internal tool history as a compact summary by default', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubagentContainer, {
        toolInput: { subagent_type: 'Agent', description: 'Inspect crash data' },
        subagentState: {
          childTools: [
            { toolId: 'read-a', toolName: 'Read', toolInput: { file_path: 'a.ts' }, timestamp: new Date(1) },
            { toolId: 'read-b', toolName: 'Read', toolInput: { file_path: 'b.ts' }, timestamp: new Date(2) },
            { toolId: 'bash-test', toolName: 'Bash', toolInput: { command: 'npm test' }, timestamp: new Date(3) },
          ],
          currentToolIndex: 2,
          isComplete: true,
          runtimeStatus: 'DONE',
        },
      }),
    );

    expect(html).toContain('运行 3 个工具');
    expect(html).toContain('读取 2 个文件');
    expect(html).not.toContain('a.ts');
    expect(html).not.toContain('b.ts');
    expect(html).not.toContain('npm test');
  });
});
