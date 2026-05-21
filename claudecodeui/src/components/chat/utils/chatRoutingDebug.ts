const SECRET_KEY_PATTERN = /(token|secret|password|authorization|auth|cookie|key)/i;
const MAX_STRING_LENGTH = 600;

type RoutingDebugDetails = Record<string, unknown>;

function sanitizeValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }

  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item, index) => sanitizeValue(`${key}.${index}`, item));
  }
  if (typeof value === 'object') {
    return sanitizeDetails(value as RoutingDebugDetails);
  }
  return String(value);
}

function sanitizeDetails(details: RoutingDebugDetails): RoutingDebugDetails {
  const output: RoutingDebugDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'command' || key === 'content' || key === 'messageContent') {
      if (typeof value === 'string') {
        output[`${key}Length`] = value.length;
      }
      continue;
    }
    output[key] = sanitizeValue(key, value);
  }
  return output;
}

export function buildChatRoutingDebugPayload(event: string, details: RoutingDebugDetails = {}) {
  return {
    type: 'argus-routing-debug',
    event,
    details: sanitizeDetails(details),
  };
}

export function emitChatRoutingDebug(
  sendMessage: ((message: unknown) => void) | null | undefined,
  event: string,
  details: RoutingDebugDetails = {},
) {
  if (!sendMessage) {
    return;
  }
  try {
    sendMessage(buildChatRoutingDebugPayload(event, details));
  } catch (error) {
    console.warn('[ArgusRoutingDebug] failed to emit client routing event:', error);
  }
}
