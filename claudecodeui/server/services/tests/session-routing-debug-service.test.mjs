import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

import {
  appendSessionRoutingDebugEvent,
  buildSessionRoutingDebugEvent,
  getSessionRoutingDebugLogPath,
} from '../session-routing-debug-service.js';

test('session routing debug events redact command text and secret-like fields', () => {
  const event = buildSessionRoutingDebugEvent('client.send.route_resolved', {
    clientMessageId: 'client-user-1',
    command: 'please inspect token=super-secret',
    selectedProjectName: 'unity-profiler-rs',
    selectedProjectPath: 'E:/unity-profiler-rs',
    selectedSessionId: 'session-a',
    currentSessionId: 'session-b',
    apiToken: 'secret-token',
    nested: {
      authHeader: 'Bearer secret',
      backendSessionId: 'session-a',
    },
  }, {
    now: () => '2026-05-21T12:00:00.000Z',
  });

  assert.equal(event.at, '2026-05-21T12:00:00.000Z');
  assert.equal(event.event, 'client.send.route_resolved');
  assert.equal(event.clientMessageId, 'client-user-1');
  assert.equal(event.commandLength, 'please inspect token=super-secret'.length);
  assert.equal(event.command, undefined);
  assert.equal(event.apiToken, '[redacted]');
  assert.equal(event.nested.authHeader, '[redacted]');
  assert.equal(event.nested.backendSessionId, 'session-a');
});

test('session routing debug events append to a dated jsonl file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'argus-routing-debug-'));
  const env = { MTL_CODE_UI_DATA_DIR: tempDir };

  const logPath = getSessionRoutingDebugLogPath({
    env,
    now: () => '2026-05-21T12:00:00.000Z',
  });

  appendSessionRoutingDebugEvent('server.command_received', {
    provider: 'claude',
    sessionId: 'session-a',
  }, {
    env,
    now: () => '2026-05-21T12:00:00.000Z',
  });

  const raw = await fs.readFile(logPath, 'utf8');
  const line = JSON.parse(raw.trim());
  assert.equal(line.event, 'server.command_received');
  assert.equal(line.provider, 'claude');
  assert.equal(line.sessionId, 'session-a');
  assert.match(logPath, /session-routing-2026-05-21\.jsonl$/);
});

test('session routing debug event name cannot be overwritten by details', () => {
  const event = buildSessionRoutingDebugEvent('sdk.turn_start', {
    event: 'turn_start',
    sessionId: 'session-a',
  }, {
    now: () => '2026-05-21T12:00:00.000Z',
  });

  assert.equal(event.event, 'sdk.turn_start');
  assert.equal(event.sourceEvent, 'turn_start');
});
