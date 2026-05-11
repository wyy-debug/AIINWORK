import crypto from 'crypto';

function id() {
  return `swarm_message_${crypto.randomUUID()}`;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
}

function deliveryModeFor(input = {}) {
  if (normalizeText(input.toAgentId)) return 'direct';
  if (normalizeText(input.topic) === '*') return 'broadcast';
  return normalizeText(input.topic) ? 'topic' : 'broadcast';
}

function retryBackoffMs(attempts) {
  return attempts <= 1 ? 2000 : 10000;
}

export function createSwarmMessageBus({ store, now = () => Date.now(), messageSizeLimit = 32768 } = {}) {
  if (!store) {
    throw new Error('createSwarmMessageBus requires a store');
  }

  function trace(message, status, patch = {}) {
    if (!message?.id || typeof store.recordDeliveryTrace !== 'function') return null;
    return store.recordDeliveryTrace({
      runId: message.runId,
      messageId: message.id,
      agentId: normalizeText(patch.agentId),
      status,
      error: normalizeText(patch.error),
      payload: patch.payload || {},
      createdAt: now(),
    });
  }

  return {
    publish(input = {}) {
      const runId = normalizeText(input.runId);
      if (!runId) throw new Error('runId is required');
      const idempotencyKey = normalizeText(input.idempotencyKey);
      const existing = store.findMessageByIdempotencyKey(runId, idempotencyKey);
      if (existing) return existing;

      const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
      const limit = Number.isFinite(Number(input.messageSizeLimit)) ? Number(input.messageSizeLimit) : messageSizeLimit;
      if (byteLength(payload) > limit) {
        throw new Error(`swarm message payload exceeds ${limit} bytes`);
      }

      const message = store.createMessage({
        id: normalizeText(input.id) || id(),
        runId,
        fromAgentId: normalizeText(input.fromAgentId),
        toAgentId: normalizeText(input.toAgentId),
        topic: normalizeText(input.topic),
        type: normalizeText(input.type) || 'message',
        payload,
        priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
        ttlMs: Number.isFinite(Number(input.ttlMs)) ? Number(input.ttlMs) : 300000,
        ackPolicy: normalizeText(input.ackPolicy) || 'at_least_once',
        retryLimit: Number.isFinite(Number(input.retryLimit)) ? Number(input.retryLimit) : 3,
        idempotencyKey,
        correlationId: normalizeText(input.correlationId),
        causationId: normalizeText(input.causationId),
        status: 'published',
        nextAttemptAt: now(),
        deliveryMode: deliveryModeFor(input),
        createdAt: now(),
      });
      store.recordEvent(runId, 'swarm_message_published', {
        messageId: message.id,
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        topic: message.topic,
        messageType: message.type,
        deliveryMode: message.deliveryMode,
      }, { messageId: message.id, agentId: message.fromAgentId });
      trace(message, 'published', {
        agentId: message.fromAgentId,
        payload: {
          deliveryMode: message.deliveryMode,
          nextAttemptAt: message.nextAttemptAt,
        },
      });
      return message;
    },

    deliver(messageId, agentId, options = {}) {
      const current = store.getMessage(messageId);
      if (!current) throw new Error('swarm message not found');
      const delivered = store.updateMessage(messageId, {
        status: 'delivered',
        deliveryMode: normalizeText(options.deliveryMode) || current.deliveryMode,
        deliveredTo: normalizeText(agentId),
        deliveredAt: now(),
        nextAttemptAt: null,
      });
      store.recordEvent(current.runId, 'swarm_message_delivered', {
        messageId,
        agentId: normalizeText(agentId),
        deliveryMode: delivered.deliveryMode,
      }, { messageId, agentId: normalizeText(agentId) });
      trace(delivered, 'delivered', {
        agentId,
        payload: { deliveryMode: delivered.deliveryMode },
      });
      return delivered;
    },

    ack(messageId, agentId) {
      const current = store.getMessage(messageId);
      if (!current) throw new Error('swarm message not found');
      const acknowledged = store.updateMessage(messageId, {
        status: 'acknowledged',
        ackedBy: normalizeText(agentId),
        ackedAt: now(),
        nextAttemptAt: null,
      });
      store.recordEvent(current.runId, 'swarm_message_acknowledged', {
        messageId,
        agentId: normalizeText(agentId),
      }, { messageId, agentId: normalizeText(agentId) });
      trace(acknowledged, 'acknowledged', { agentId });
      return acknowledged;
    },

    failDelivery(messageId, error = '', options = {}) {
      const current = store.getMessage(messageId);
      if (!current) throw new Error('swarm message not found');
      const attempts = current.attempts + 1;
      const deadLettered = attempts > current.retryLimit;
      const updated = store.updateMessage(messageId, {
        status: deadLettered ? 'dead_lettered' : 'retry_scheduled',
        attempts,
        nextAttemptAt: deadLettered ? null : now() + retryBackoffMs(attempts),
        error: normalizeText(error),
        deliveredTo: '',
        deliveredAt: null,
      });
      trace(current, 'failed', {
        agentId: normalizeText(options.agentId),
        error,
        payload: { attempts },
      });
      store.recordEvent(current.runId, 'swarm_message_delivery_failed', {
        messageId,
        attempts,
        nextAttemptAt: updated.nextAttemptAt,
        error: normalizeText(error),
      }, { messageId });
      store.recordEvent(current.runId, deadLettered ? 'swarm_message_dead_lettered' : 'swarm_message_retry_scheduled', {
        messageId,
        attempts,
        error: normalizeText(error),
      }, { messageId });
      trace(updated, deadLettered ? 'dead_lettered' : 'retry_scheduled', {
        error,
        payload: {
          attempts,
          nextAttemptAt: updated.nextAttemptAt,
        },
      });
      return updated;
    },

    expireDue(runId) {
      const expired = [];
      for (const message of store.listExpirableMessages(runId, now())) {
        const updated = store.updateMessage(message.id, {
          status: 'expired',
          error: 'TTL expired',
        });
        store.recordEvent(message.runId, 'swarm_message_expired', {
          messageId: message.id,
        }, { messageId: message.id });
        trace(updated, 'expired', { error: 'TTL expired' });
        expired.push(updated);
      }
      return expired;
    },

    replayDeadLetter(messageId) {
      const current = store.getMessage(messageId);
      if (!current) throw new Error('swarm message not found');
      if (!['dead_lettered', 'retry_scheduled'].includes(current.status)) return current;
      const updated = store.updateMessage(messageId, {
        status: 'published',
        attempts: 0,
        error: '',
        nextAttemptAt: now(),
        deliveredTo: '',
        ackedBy: '',
        deliveredAt: null,
        ackedAt: null,
      });
      store.recordEvent(current.runId, 'swarm_message_replayed', { messageId }, { messageId });
      trace(updated, 'replayed', {
        payload: { nextAttemptAt: updated.nextAttemptAt },
      });
      return updated;
    },

    replayMessages({ runId, messageIds = [], statusFilter = 'dead_lettered' } = {}) {
      const ids = Array.isArray(messageIds) ? messageIds.map(normalizeText).filter(Boolean) : [];
      const candidates = ids.length
        ? ids.map((messageId) => store.getMessage(messageId)).filter(Boolean)
        : store.listMessagesByStatus(runId, normalizeText(statusFilter) || 'dead_lettered');
      return candidates
        .filter((message) => ['dead_lettered', 'retry_scheduled'].includes(message.status))
        .map((message) => this.replayDeadLetter(message.id));
    },
  };
}
