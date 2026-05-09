import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyAgentCompletion } from './nativeNotifications';

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('native notification helpers', () => {
  it('uses the Electron desktop notification bridge for completed runs', async () => {
    const notify = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        argusDesktop: { notify },
      },
    });

    await notifyAgentCompletion({
      provider: 'claude',
      projectName: 'AIINWORK',
      sessionName: 'Review GPUScene',
      exitCode: 0,
    });

    expect(notify).toHaveBeenCalledWith({
      title: 'Argus：任务已完成',
      body: 'AIINWORK · Review GPUScene · Claude 已完成回复',
      tag: 'argus-run-complete:claude:AIINWORK:Review GPUScene',
      urgency: 'normal',
    });
  });

  it('does not notify for aborted completions', async () => {
    const notify = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        argusDesktop: { notify },
      },
    });

    await notifyAgentCompletion({
      provider: 'codex',
      projectName: 'AIINWORK',
      aborted: true,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it('falls back to granted Web Notification when desktop bridge is unavailable', async () => {
    const notification = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        Notification: Object.assign(notification, { permission: 'granted' }),
      },
    });

    await notifyAgentCompletion({
      provider: 'gemini',
      projectName: 'AIINWORK',
      exitCode: 1,
    });

    expect(notification).toHaveBeenCalledWith('Argus：任务已结束', {
      body: 'AIINWORK · Gemini 已结束，退出码 1',
      tag: 'argus-run-complete:gemini:AIINWORK:session',
      silent: false,
    });
  });

  it('does not throw when the desktop notification bridge rejects', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        argusDesktop: {
          notify: vi.fn().mockRejectedValue(new Error('native failed')),
        },
      },
    });

    await expect(notifyAgentCompletion({
      provider: 'claude',
      projectName: 'AIINWORK',
    })).resolves.toBeUndefined();
  });
});
