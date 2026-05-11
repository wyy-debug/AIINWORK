import crypto from 'crypto';

import { createSwarmDeliveryWorker } from './swarm-delivery-worker-service.js';
import { normalizeSwarmTemplateManifest } from './swarm-template-manifest-service.js';

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultRuntimeAdapter() {
  return {
    async spawnAgent({ role, roleIndex, objective }) {
      return {
        taskId: `local-${role.id}-${roleIndex}-${crypto.randomUUID()}`,
        threadId: `local-thread-${role.id}-${roleIndex}`,
        objective,
        mode: 'local-control-plane',
      };
    },
    async controlAgent() {
      return { success: true, mode: 'local-control-plane' };
    },
    async deliverMessage() {
      return { success: true, mode: 'local-control-plane' };
    },
  };
}

function agentStatusFromRuntime(result) {
  if (result?.status) return result.status;
  if (result?.taskId) return 'running';
  return result ? 'failed' : 'queued';
}

function isTerminalAgent(agent) {
  return ['completed', 'failed', 'cancelled'].includes(agent?.status);
}

function roleMappingKey(agentOrMapping = {}) {
  return `${normalizeText(agentOrMapping.roleId)}:${Number.isFinite(Number(agentOrMapping.roleIndex)) ? Number(agentOrMapping.roleIndex) : 0}`;
}

function normalizeRuntimeMappings(mappings) {
  if (mappings instanceof Map) return mappings;
  const normalized = new Map();
  if (Array.isArray(mappings)) {
    for (const mapping of mappings) {
      normalized.set(mapping.agentId || roleMappingKey(mapping), mapping);
      normalized.set(roleMappingKey(mapping), mapping);
    }
  } else if (mappings && typeof mappings === 'object') {
    for (const [key, mapping] of Object.entries(mappings)) {
      if (!mapping || typeof mapping !== 'object') continue;
      normalized.set(key, mapping);
      normalized.set(mapping.agentId || roleMappingKey(mapping), mapping);
      normalized.set(roleMappingKey(mapping), mapping);
    }
  }
  return normalized;
}

export function createSwarmOrchestrator({ store, bus, runtimeAdapter = defaultRuntimeAdapter(), now = () => Date.now() } = {}) {
  if (!store) throw new Error('createSwarmOrchestrator requires a store');
  if (!bus) throw new Error('createSwarmOrchestrator requires a message bus');
  const localRuntimeAdapter = defaultRuntimeAdapter();
  const adapterForMode = (runtimeMode) => (runtimeMode === 'local-control-plane' ? localRuntimeAdapter : runtimeAdapter);
  const adapterForRun = (run) => adapterForMode(run?.runtimeMode || 'coordinator-subagents');
  const deliveryWorker = createSwarmDeliveryWorker({
    store,
    bus,
    now,
    runtimeAdapterResolver: (run) => adapterForRun(run),
  });
  let deliveryTimer = null;
  let deliveryTickRunning = false;

  async function processDeliveryQueues() {
    if (deliveryTickRunning) return { processed: 0, acknowledged: 0, failed: 0 };
    deliveryTickRunning = true;
    const totals = { processed: 0, acknowledged: 0, failed: 0 };
    try {
      const runs = typeof store.listActiveRuns === 'function' ? store.listActiveRuns() : [];
      for (const run of runs) {
        const result = await deliveryWorker.processRun(run.id);
        totals.processed += result.processed || 0;
        totals.acknowledged += result.acknowledged || 0;
        totals.failed += result.failed || 0;
      }
      return totals;
    } finally {
      deliveryTickRunning = false;
    }
  }

  return {
    async startRun({
      template,
      objective = '',
      sessionId = '',
      projectPath = '',
      launchAnswers = {},
      runtimeMode = 'coordinator-subagents',
      permissionMode = '',
      toolsSettings = null,
      skipPermissions = false,
      background = false,
    } = {}) {
      const manifest = normalizeSwarmTemplateManifest(template);
      const activeRuntimeAdapter = adapterForMode(runtimeMode);
      store.createDefinition({
        id: manifest.id,
        templateId: manifest.id,
        version: manifest.version,
        manifest,
      });
      const run = store.createRun({
        id: id('swarm_run'),
        templateId: manifest.id,
        status: 'running',
        runtimeMode,
        runtimeStatus: runtimeMode === 'coordinator-subagents' ? 'starting' : 'running',
        objective,
        sessionId,
        projectPath,
        template: manifest,
        launchAnswers,
      });
      const runtimePermissionSnapshot = {
        ...(normalizeText(permissionMode) ? { permissionMode: normalizeText(permissionMode) } : {}),
        ...(toolsSettings && typeof toolsSettings === 'object' ? { toolsSettings } : {}),
        skipPermissions: Boolean(skipPermissions),
      };
      if (runtimeMode === 'coordinator-subagents') {
        store.recordEvent(run.id, 'swarm_coordinator_started', {
          runtimeMode,
          status: 'starting',
        });
        store.updateRunRuntime(run.id, { runtimeMode, runtimeStatus: 'spawning' });
      }

      const assignments = [];
      for (const role of manifest.roles) {
        for (let roleIndex = 0; roleIndex < role.count; roleIndex += 1) {
          const agent = store.upsertAgent({
            id: id(`swarm_agent_${role.id}`),
            runId: run.id,
            roleId: role.id,
            roleIndex,
            label: role.count > 1 ? `${role.label} ${roleIndex + 1}` : role.label,
            status: 'queued',
            agentTemplateId: role.agentTemplateId,
            metadata: {
              runtime: role.runtime,
              topics: role.topics,
              runtimeMode,
              runtimeStatus: 'queued',
            },
          });
          assignments.push({ agent, role, roleIndex });
        }
      }

      const spawnAssignments = async () => {
        let successfulSpawns = 0;
        let failedSpawns = 0;
        for (const assignment of assignments) {
          const { role, roleIndex } = assignment;
          const agent = store.getAgent(assignment.agent.id) || assignment.agent;
          store.recordEvent(run.id, 'swarm_agent_spawn_requested', {
            agentId: agent.id,
            roleId: agent.roleId,
            roleIndex,
            runtimeMode,
          }, { agentId: agent.id });
          const currentRun = {
            ...store.getRun(run.id),
            ...runtimePermissionSnapshot,
          };
          let runtimeResult;
          try {
            runtimeResult = await activeRuntimeAdapter.spawnAgent({
              agent,
              run: currentRun,
              template: manifest,
              role,
              roleIndex,
              objective,
              sessionId,
              projectPath,
              launchAnswers,
            });
          } catch (error) {
            runtimeResult = {
              status: 'failed',
              error: error?.message || 'Swarm agent spawn failed.',
              mode: runtimeMode,
            };
          }
          if (runtimeResult?.coordinatorSessionId) {
            store.updateRunRuntime(run.id, {
              runtimeMode: runtimeResult.mode || runtimeMode,
              runtimeStatus: 'spawning',
              coordinatorSessionId: runtimeResult.coordinatorSessionId,
            });
          }
          const agentStatus = agentStatusFromRuntime(runtimeResult);
          if (agentStatus === 'failed') failedSpawns += 1;
          if (agentStatus === 'running') successfulSpawns += 1;
          const updatedAgent = store.upsertAgent({
            ...agent,
            status: agentStatus,
            taskId: runtimeResult?.taskId || '',
            threadId: runtimeResult?.threadId || '',
            metadata: {
              ...agent.metadata,
              runtimeMode: runtimeResult?.mode || runtimeMode,
              runtimeStatus: agentStatus,
              mode: runtimeResult?.mode || runtimeMode,
              spawnResult: runtimeResult || {},
              lastSpawnError: runtimeResult?.error || '',
            },
          });
          store.recordEvent(run.id, runtimeResult?.taskId ? 'swarm_agent_spawn_mapped' : 'swarm_agent_spawn_failed', {
            agentId: updatedAgent.id,
            roleId: updatedAgent.roleId,
            taskId: updatedAgent.taskId,
            threadId: updatedAgent.threadId,
            status: updatedAgent.status,
            error: runtimeResult?.error || '',
          }, { agentId: updatedAgent.id });
          if (runtimeResult?.taskId) {
            store.recordEvent(run.id, 'swarm_agent_started', {
              agentId: updatedAgent.id,
              roleId: updatedAgent.roleId,
              taskId: updatedAgent.taskId,
              threadId: updatedAgent.threadId,
              status: updatedAgent.status,
            }, { agentId: updatedAgent.id });
          }
        }

        const runtimeStatus = failedSpawns > 0
          ? successfulSpawns > 0 ? 'degraded' : 'failed'
          : 'running';
        store.updateRunRuntime(run.id, { runtimeMode, runtimeStatus });
        if (runtimeStatus === 'failed') {
          store.updateRunStatus(run.id, 'failed', { runtimeStatus, failedSpawns });
        }
      };

      if (background) {
        setTimeout(() => {
          void spawnAssignments().catch((error) => {
            store.updateRunStatus(run.id, 'failed', {
              runtimeStatus: 'failed',
              error: error?.message || 'Swarm background spawn failed.',
            });
            store.recordEvent(run.id, 'swarm_run_failed', {
              runtimeStatus: 'failed',
              error: error?.message || 'Swarm background spawn failed.',
            });
          });
        }, 0);
        return store.getRunSnapshot(run.id);
      }

      await spawnAssignments();
      return store.getRunSnapshot(run.id);
    },

    getRunSnapshot(runId) {
      return store.getRunSnapshot(runId);
    },

    listEvents(runId) {
      return store.listEvents(runId);
    },

    listRunSummaries(query = {}) {
      return typeof store.listRuns === 'function' ? store.listRuns(query) : [];
    },

    listMessageTrace(input) {
      const messageId = typeof input === 'string' ? input : normalizeText(input?.messageId);
      const runId = typeof input === 'object' ? normalizeText(input?.runId) : '';
      return typeof store.listDeliveryTrace === 'function' ? store.listDeliveryTrace(messageId, runId) : [];
    },

    async sendMessage(input = {}) {
      return bus.publish(input);
    },

    replayMessages(input = {}) {
      return typeof bus.replayMessages === 'function'
        ? bus.replayMessages(input)
        : [];
    },

    listMemory(runId) {
      return typeof store.listMemory === 'function' ? store.listMemory(runId) : [];
    },

    recordMemory(entry = {}) {
      return store.recordMemory(entry);
    },

    updateMemory(input, patch = {}) {
      if (typeof input === 'string') {
        return store.updateMemory(input, patch);
      }
      return store.updateMemory(
        normalizeText(input?.memoryId),
        input?.patch || {},
        normalizeText(input?.runId),
      );
    },

    deleteMemory(input) {
      if (typeof input === 'string') {
        return store.deleteMemory(input);
      }
      return store.deleteMemory(normalizeText(input?.memoryId), normalizeText(input?.runId));
    },

    async processDeliveryQueue(runId) {
      return deliveryWorker.processRun(runId);
    },

    async processDeliveryQueues() {
      return processDeliveryQueues();
    },

    startDeliveryWorker({ intervalMs = 2000 } = {}) {
      if (deliveryTimer) return { started: false };
      deliveryTimer = setInterval(() => {
        void processDeliveryQueues().catch((error) => {
          console.warn('[Swarm] Delivery worker tick failed:', error?.message || error);
        });
      }, intervalMs);
      if (typeof deliveryTimer.unref === 'function') deliveryTimer.unref();
      return { started: true, intervalMs };
    },

    stopDeliveryWorker() {
      if (!deliveryTimer) return { stopped: false };
      clearInterval(deliveryTimer);
      deliveryTimer = null;
      return { stopped: true };
    },

    async deliverMessage(messageId) {
      await deliveryWorker.processMessage(messageId);
      return store.getMessage(messageId);
    },

    async controlRun(input = {}) {
      const runId = normalizeText(input.runId);
      const action = normalizeText(input.action);
      if (!runId || !action) throw new Error('runId and action are required');

      if (action === 'pause') {
        store.updateRunStatus(runId, 'paused', { action });
        return { success: true, action };
      }
      if (action === 'resume') {
        store.updateRunStatus(runId, 'running', { action });
        return { success: true, action };
      }
      if (action === 'cancel') {
        const run = store.getRun(runId);
        const activeRuntimeAdapter = adapterForRun(run);
        let coordinatorStopped = false;
        let coordinatorStopError = '';
        if (typeof activeRuntimeAdapter.stopCoordinator === 'function') {
          try {
            const stopResult = await activeRuntimeAdapter.stopCoordinator({ run });
            coordinatorStopped = stopResult?.success !== false;
            coordinatorStopError = stopResult?.error || '';
            store.recordEvent(runId, coordinatorStopped ? 'swarm_coordinator_stopped' : 'swarm_coordinator_stop_failed', {
              action,
              coordinatorSessionId: run?.coordinatorSessionId || '',
              success: coordinatorStopped,
              error: coordinatorStopError,
              mode: stopResult?.mode || '',
              timestamp: now(),
            });
          } catch (error) {
            coordinatorStopError = error?.message || 'Failed to stop swarm coordinator.';
            store.recordEvent(runId, 'swarm_coordinator_stop_failed', {
              action,
              coordinatorSessionId: run?.coordinatorSessionId || '',
              success: false,
              error: coordinatorStopError,
              timestamp: now(),
            });
          }
        }
        let stoppedAgents = 0;
        let failedStops = 0;
        for (const agent of store.listAgents(runId)) {
          if (isTerminalAgent(agent) || !agent.taskId) continue;
          store.recordEvent(runId, 'swarm_agent_control_requested', {
            action: 'stop-agent',
            agentId: agent.id,
            taskId: agent.taskId,
          }, { agentId: agent.id });
          let result;
          try {
            result = await activeRuntimeAdapter.controlAgent({
              run,
              runId,
              agentId: agent.id,
              action: 'stop',
              taskId: agent.taskId,
              threadId: agent.threadId,
            });
          } catch (error) {
            result = { success: false, mode: 'direct', error: error?.message || 'Failed to stop swarm agent.' };
          }
          const success = result?.success !== false;
          if (success) stoppedAgents += 1;
          if (!success) failedStops += 1;
          const lastControl = { action: 'stop', ...result, success, timestamp: now() };
          store.upsertAgent({
            ...agent,
            status: success ? 'cancelled' : 'control_failed',
            metadata: {
              ...agent.metadata,
              runtimeStatus: success ? 'cancelled' : 'failed',
              lastControl,
            },
          });
          store.recordEvent(runId, success ? 'swarm_agent_control_accepted' : 'swarm_agent_control_failed', {
            action: 'stop-agent',
            agentId: agent.id,
            taskId: agent.taskId,
            threadId: agent.threadId,
            mode: lastControl.mode || '',
            success,
            error: lastControl.error || '',
            resultSummary: lastControl.resultSummary || lastControl.summary || '',
            timestamp: lastControl.timestamp,
          }, { agentId: agent.id });
        }
        store.updateRunStatus(runId, 'cancelled', {
          action,
          runtimeStatus: 'cancelled',
          stoppedAgents,
          failedStops,
          coordinatorStopped,
          coordinatorStopError,
        });
        return { success: failedStops === 0 && !coordinatorStopError, action, stoppedAgents, failedStops, coordinatorStopped };
      }
      if (action === 'reconcile-run') {
        const run = store.getRun(runId);
        const activeRuntimeAdapter = adapterForRun(run);
        let runtimeState = {};
        if (typeof activeRuntimeAdapter.reconcileRun === 'function') {
          try {
            runtimeState = await activeRuntimeAdapter.reconcileRun({
              run,
              agents: store.listAgents(runId),
              template: run?.template || null,
            }) || {};
          } catch (error) {
            runtimeState = { error: error?.message || 'Failed to reconcile swarm runtime.' };
          }
        }
        if (runtimeState.coordinatorSessionId) {
          store.updateRunRuntime(runId, {
            runtimeMode: run?.runtimeMode || 'coordinator-subagents',
            runtimeStatus: run?.runtimeStatus || 'running',
            coordinatorSessionId: runtimeState.coordinatorSessionId,
          });
        }
        const mappings = normalizeRuntimeMappings(runtimeState.mappings);
        let recoveredAgents = 0;
        let degradedAgents = 0;
        let preservedAgents = 0;
        for (const agent of store.listAgents(runId)) {
          const mapping = mappings.get(agent.id) || mappings.get(roleMappingKey(agent));
          if (mapping?.taskId) {
            recoveredAgents += agent.taskId ? 0 : 1;
            store.upsertAgent({
              ...agent,
              status: mapping.status || 'running',
              taskId: mapping.taskId,
              threadId: mapping.threadId || agent.threadId,
              metadata: {
                ...agent.metadata,
                runtimeStatus: mapping.status || 'running',
                lastReconciledAt: now(),
              },
            });
            continue;
          }
          const runtimeMode = agent.runtimeMode || agent.metadata?.runtimeMode || run?.runtimeMode || '';
          const shouldDegrade = runtimeMode !== 'local-control-plane'
            && ['queued', 'running'].includes(agent.status)
            && !agent.taskId;
          if (shouldDegrade) {
            degradedAgents += 1;
            store.upsertAgent({
              ...agent,
              status: 'degraded',
              metadata: {
                ...agent.metadata,
                runtimeStatus: 'degraded',
                lastReconciledAt: now(),
              },
            });
          } else if (agent.taskId) {
            preservedAgents += 1;
          }
        }
        const runtimeStatus = degradedAgents > 0 ? 'degraded' : (run?.runtimeStatus || 'running');
        store.updateRunRuntime(runId, { runtimeStatus });
        store.recordEvent(runId, 'swarm_run_reconciled', {
          action,
          recoveredAgents,
          degradedAgents,
          preservedAgents,
          runtimeStatus,
          error: runtimeState.error || '',
        });
        return { success: true, action, recoveredAgents, degradedAgents, preservedAgents };
      }
      if (action === 'retry-agent-spawn') {
        const agentId = normalizeText(input.agentId);
        const agent = store.getAgent(agentId);
        if (!agent) throw new Error('swarm agent not found');
        const run = store.getRun(runId);
        const template = run?.template || {};
        const role = (Array.isArray(template.roles) ? template.roles : []).find((candidate) => candidate.id === agent.roleId) || {
          id: agent.roleId,
          label: agent.label,
          agentTemplateId: agent.agentTemplateId,
          runtime: agent.metadata?.runtime || {},
          topics: agent.metadata?.topics || [],
        };
        const activeRuntimeAdapter = adapterForRun(run);
        const spawnRetryCount = Number(agent.metadata?.spawnRetryCount || 0) + 1;
        store.recordEvent(runId, 'swarm_agent_spawn_retry_requested', {
          action,
          agentId,
          roleId: agent.roleId,
          roleIndex: agent.roleIndex,
          spawnRetryCount,
          timestamp: now(),
        }, { agentId });
        let runtimeResult;
        try {
          runtimeResult = await activeRuntimeAdapter.spawnAgent({
            agent,
            run,
            template,
            role,
            roleIndex: agent.roleIndex,
            objective: run?.objective || '',
            sessionId: run?.sessionId || '',
            projectPath: run?.projectPath || '',
            launchAnswers: run?.launchAnswers || {},
          });
        } catch (error) {
          runtimeResult = {
            status: 'failed',
            error: error?.message || 'Swarm agent spawn retry failed.',
            mode: run?.runtimeMode || 'coordinator-subagents',
          };
        }
        const agentStatus = agentStatusFromRuntime(runtimeResult);
        const updatedAgent = store.upsertAgent({
          ...agent,
          status: agentStatus,
          taskId: runtimeResult?.taskId || '',
          threadId: runtimeResult?.threadId || '',
          metadata: {
            ...agent.metadata,
            runtimeMode: runtimeResult?.mode || run?.runtimeMode || 'coordinator-subagents',
            runtimeStatus: agentStatus,
            mode: runtimeResult?.mode || run?.runtimeMode || 'coordinator-subagents',
            spawnResult: runtimeResult || {},
            lastSpawnError: runtimeResult?.error || '',
            spawnRetryCount,
          },
        });
        store.recordEvent(runId, runtimeResult?.taskId ? 'swarm_agent_spawn_mapped' : 'swarm_agent_spawn_failed', {
          action,
          agentId,
          roleId: updatedAgent.roleId,
          taskId: updatedAgent.taskId,
          threadId: updatedAgent.threadId,
          status: updatedAgent.status,
          error: runtimeResult?.error || '',
          spawnRetryCount,
        }, { agentId });
        return {
          success: updatedAgent.status !== 'failed',
          action,
          agentId,
          taskId: updatedAgent.taskId,
          threadId: updatedAgent.threadId,
          error: runtimeResult?.error || '',
        };
      }
      if (action === 'retry-message' || action === 'replay-dead-letter') {
        const messageId = normalizeText(input.messageId);
        if (!messageId) throw new Error('messageId is required');
        const message = bus.replayDeadLetter(messageId);
        return { success: true, action, message };
      }
      if (['wait-agent', 'send-agent', 'followup-agent', 'stop-agent'].includes(action)) {
        const agentId = normalizeText(input.agentId);
        const agent = store.getAgent(agentId);
        if (!agent) throw new Error('swarm agent not found');
        const controlAction = action.replace(/-agent$/, '');
        store.recordEvent(runId, 'swarm_agent_control_requested', {
          action,
          agentId,
          taskId: agent.taskId,
          threadId: agent.threadId,
          timestamp: now(),
        }, { agentId });
        const activeRuntimeAdapter = adapterForRun(store.getRun(runId));
        const result = await activeRuntimeAdapter.controlAgent({
          run: store.getRun(runId),
          runId,
          agentId,
          action: controlAction,
          taskId: agent.taskId,
          threadId: agent.threadId,
          content: input.content || '',
          objective: input.objective || '',
        });
        const nextStatus = result?.success === false
          ? 'control_failed'
          : controlAction === 'stop'
            ? 'cancelled'
            : agent.status;
        const lastControl = {
          action: controlAction,
          ...result,
          success: result?.success !== false,
          timestamp: now(),
        };
        const nextMetadata = {
          ...agent.metadata,
          runtimeStatus: nextStatus,
          lastControl,
        };
        if (controlAction === 'wait') {
          nextMetadata.lastWaitResult = lastControl;
        }
        store.upsertAgent({
          ...agent,
          status: nextStatus,
          metadata: nextMetadata,
        });
        store.recordEvent(runId, result?.success === false ? 'swarm_agent_control_failed' : 'swarm_agent_control_accepted', {
          action,
          agentId,
          taskId: agent.taskId,
          threadId: agent.threadId,
          mode: lastControl.mode || '',
          success: lastControl.success,
          error: lastControl.error || '',
          resultSummary: lastControl.resultSummary || lastControl.summary || '',
          timestamp: lastControl.timestamp,
        }, { agentId });
        return {
          success: result?.success !== false,
          action,
          agentId,
          controlAction,
          mode: lastControl.mode,
          error: lastControl.error || '',
        };
      }

      throw new Error(`unsupported swarm control action: ${action}`);
    },
  };
}
