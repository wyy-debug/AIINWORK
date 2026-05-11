const DIRECT_CONTROL_SUBTYPES = {
  wait: 'wait_agent',
  send: 'send_message',
  followup: 'followup_task',
  stop: 'stop_task',
};

const FALLBACK_ELIGIBLE_ACTIONS = new Set(['wait', 'send', 'followup', 'stop']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAction(value) {
  const action = normalizeText(value).toLowerCase();
  return ['wait', 'send', 'followup', 'stop'].includes(action) ? action : '';
}

export function normalizeSubagentTaskControlInput(input = {}) {
  const action = normalizeAction(input.action);
  const sessionId = normalizeText(input.sessionId);
  const taskId = normalizeText(input.taskId);
  const content = normalizeText(input.content ?? input.message ?? input.objective);
  const clientMessageId = normalizeText(input.clientMessageId);

  return {
    action,
    sessionId,
    taskId,
    content,
    ...(clientMessageId ? { clientMessageId } : {}),
  };
}

export function buildSubagentControlFallbackPrompt(input = {}) {
  const control = normalizeSubagentTaskControlInput(input);
  if (control.action === 'send') {
    return [
      `Call send_message for background task ${control.taskId}.`,
      'Use this message exactly as parent guidance for that task:',
      control.content,
    ].filter(Boolean).join('\n\n');
  }
  if (control.action === 'followup') {
    return [
      `Call followup_task for background task ${control.taskId}.`,
      'Create the follow-up with this objective:',
      control.content,
    ].filter(Boolean).join('\n\n');
  }
  if (control.action === 'stop') {
    return `Stop or close background task ${control.taskId}. If close_agent is available, call close_agent for that task.`;
  }
  return `Call wait_agent for background task ${control.taskId} and summarize the latest status, blockers, result, and next action.`;
}

export function buildSubagentDirectControlPayload(input = {}, requestId, options = {}) {
  const control = normalizeSubagentTaskControlInput(input);
  const supportedDirectActions = new Set(Array.isArray(options.supportedDirectActions)
    ? options.supportedDirectActions
    : ['stop']);
  if (!control.action || !control.taskId || !supportedDirectActions.has(control.action)) {
    return null;
  }

  const subtype = DIRECT_CONTROL_SUBTYPES[control.action];
  const request = {
    subtype,
    task_id: control.taskId,
  };
  if (control.action === 'send' || control.action === 'followup') {
    request.message = control.content;
  }

  return {
    type: 'control_request',
    request_id: requestId,
    request,
  };
}

function buildControlEvent(type, control, payload = {}) {
  return {
    type,
    taskId: control.taskId,
    timestamp: Date.now(),
    payload: {
      action: control.action,
      taskId: control.taskId,
      ...payload,
    },
  };
}

function failureResult(control, mode, error, fallbackUsed = false) {
  return {
    success: false,
    mode,
    fallbackUsed,
    error: error || 'Subagent control failed.',
    action: control.action,
    taskId: control.taskId,
  };
}

export async function dispatchSubagentTaskControl({
  action,
  sessionId,
  taskId,
  content = '',
  sendDirectControl,
  sendGuidance,
  emitEvent,
} = {}) {
  const control = normalizeSubagentTaskControlInput({ action, sessionId, taskId, content });
  const emit = typeof emitEvent === 'function' ? emitEvent : () => {};
  emit(buildControlEvent('control_requested', control, { mode: 'direct' }));

  if (!control.action || !control.sessionId || !control.taskId) {
    const result = failureResult(control, 'direct', 'Missing subagent control target.');
    emit(buildControlEvent('control_failed', control, { mode: result.mode, error: result.error }));
    return result;
  }

  const directResult = typeof sendDirectControl === 'function'
    ? await sendDirectControl(control)
    : { success: false, unsupported: true, error: 'Direct subagent control is unavailable.' };
  if (directResult?.success) {
    const result = {
      success: true,
      mode: 'direct',
      fallbackUsed: false,
      action: control.action,
      taskId: control.taskId,
    };
    emit(buildControlEvent('control_accepted', control, result));
    return result;
  }

  if (FALLBACK_ELIGIBLE_ACTIONS.has(control.action) && typeof sendGuidance === 'function') {
    const guidance = buildSubagentControlFallbackPrompt(control);
    const fallbackResult = await sendGuidance(guidance, control);
    if (fallbackResult?.success) {
      const result = {
        success: true,
        mode: 'fallback-guidance',
        fallbackUsed: true,
        action: control.action,
        taskId: control.taskId,
      };
      emit(buildControlEvent('control_accepted', control, result));
      return result;
    }
    const result = failureResult(
      control,
      'fallback-guidance',
      fallbackResult?.error || directResult?.error || 'Subagent control fallback failed.',
      true,
    );
    emit(buildControlEvent('control_failed', control, {
      mode: result.mode,
      fallbackUsed: true,
      error: result.error,
    }));
    return result;
  }

  const result = failureResult(control, 'direct', directResult?.error || 'Direct subagent control is unsupported.');
  emit(buildControlEvent('control_failed', control, { mode: result.mode, error: result.error }));
  return result;
}
