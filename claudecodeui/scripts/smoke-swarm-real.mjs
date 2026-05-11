import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveSmokeAuthMode } from './smoke-swarm-real-auth.mjs';

const root = process.cwd();
const serverPort = process.env.ARGUS_SMOKE_PORT || '3191';
const startServer = process.env.ARGUS_SMOKE_START_SERVER !== '0';
const baseUrl = process.env.ARGUS_SMOKE_BASE_URL || `http://127.0.0.1:${serverPort}`;
const authMode = resolveSmokeAuthMode(process.env);
const authToken = authMode.authToken;
const apiKey = process.env.ARGUS_SMOKE_API_KEY || process.env.API_KEY || '';

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed (${response.status}): ${body.details || body.error || text}`);
  }
  return body;
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Argus server did not become healthy at ${baseUrl}`);
}

async function pollRun(runId, predicate, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = (await request(`/api/swarms/runs/${encodeURIComponent(runId)}`)).run;
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${label}. Latest runtimeStatus=${latest?.runtimeStatus || 'unknown'}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopServerProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    child.kill('SIGTERM');
    await waitForChildExit(child, 5000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await waitForChildExit(child, 5000);
}

function isTransientCleanupError(error) {
  return ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code);
}

async function removeTempDirWithRetry(tempDir) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isTransientCleanupError(error) || attempt === 5) {
        console.warn(`[smoke] Could not remove temporary directory ${tempDir}: ${error?.message || error}`);
        return;
      }
      await delay(250 * (attempt + 1));
    }
  }
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'argus-swarm-smoke-'));
  let serverProcess = null;
  try {
    if (startServer) {
      const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
      const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm', 'run', 'server:dev']
        : ['run', 'server:dev'];
      serverProcess = spawn(command, args, {
        cwd: root,
        env: {
          ...process.env,
          DESKTOP_MODE: authMode.desktopModeEnv || process.env.DESKTOP_MODE,
          SERVER_PORT: serverPort,
          DATABASE_PATH: path.join(tempDir, 'argus-smoke.db'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[argus] ${chunk}`));
      serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[argus] ${chunk}`));
    }

    await waitForHealth();
    const manifest = JSON.parse(await readFile(
      path.join(root, 'examples', 'swarm-templates', 'review-swarm-pack', 'manifest.json'),
      'utf8',
    ));
    const createRun = await request('/api/swarms/runs', {
      method: 'POST',
      body: JSON.stringify({
        template: manifest,
        objective: 'Real smoke: verify coordinator subagent runtime, controls, and message trace.',
        projectPath: root,
        runtimeMode: 'coordinator-subagents',
      }),
    });
    const runId = createRun.run.id;
    const mapped = await pollRun(
      runId,
      (run) => Boolean(run.coordinatorSessionId) && run.agents?.some((agent) => agent.taskId && agent.threadId),
      'coordinator session and role task mappings',
    );
    const agent = mapped.agents.find((candidate) => candidate.taskId && candidate.threadId);
    if (!agent) throw new Error('No mapped agent was available for control smoke.');

    const message = await request(`/api/swarms/runs/${encodeURIComponent(runId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        fromAgentId: 'smoke',
        toAgentId: agent.id,
        type: 'operator_message',
        payload: { message: 'Smoke delivery message. Acknowledge receipt only.' },
        correlationId: `smoke-${Date.now()}`,
      }),
    });

    for (const action of ['wait-agent', 'send-agent', 'followup-agent', 'stop-agent']) {
      await request(`/api/swarms/runs/${encodeURIComponent(runId)}/control`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          agentId: agent.id,
          content: action === 'send-agent' ? 'Smoke send control.' : undefined,
          objective: action === 'followup-agent' ? 'Smoke follow-up control.' : undefined,
        }),
      });
    }

    const trace = await request(`/api/swarms/runs/${encodeURIComponent(runId)}/messages/${encodeURIComponent(message.message.id)}/trace`);
    const finalRun = (await request(`/api/swarms/runs/${encodeURIComponent(runId)}`)).run;
    const controlEvents = finalRun.events.filter((event) => event.type.startsWith('swarm_agent_control_'));
    if (!trace.trace?.some((entry) => entry.status === 'published')) {
      throw new Error('Smoke message trace did not include a published event.');
    }
    if (controlEvents.length < 4) {
      throw new Error(`Expected structured control events, found ${controlEvents.length}.`);
    }
    console.log(JSON.stringify({
      success: true,
      runId,
      coordinatorSessionId: finalRun.coordinatorSessionId,
      mappedAgents: finalRun.agents.filter((candidate) => candidate.taskId).length,
      messageTraceEvents: trace.trace.length,
      controlEvents: controlEvents.length,
    }, null, 2));
  } finally {
    if (serverProcess) {
      await stopServerProcess(serverProcess);
    }
    await removeTempDirWithRetry(tempDir);
  }
}

await main();
