import { createArtifact as defaultCreateArtifact } from './artifact-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const ACTION_KIND = {
  'send-note': 'obsidian-note',
  'send-selection': 'obsidian-selection',
  'ask-note': 'obsidian-ask',
  'create-memory': 'obsidian-memory-candidate',
};

export class ObsidianBridgeIngressError extends Error {
  constructor(message, { code = 'OBSIDIAN_INGRESS_ERROR', statusCode = 400 } = {}) {
    super(message);
    this.name = 'ObsidianBridgeIngressError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const normalizeIp = (value = '') => String(value || '').replace(/^::ffff:/, '');

export const isLoopbackAddress = (value = '') => {
  const ip = normalizeIp(value);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '';
};

export const assertLoopbackIngress = (req) => {
  const remoteAddress = req?.socket?.remoteAddress || req?.connection?.remoteAddress || req?.ip || '';
  if (!isLoopbackAddress(remoteAddress) && !isLoopbackAddress(req?.ip)) {
    throw new ObsidianBridgeIngressError('Obsidian ingress only accepts loopback requests.', {
      code: 'OBSIDIAN_INGRESS_LOOPBACK_ONLY',
      statusCode: 403,
    });
  }
};

export const assertIngressToken = (headers = {}, expectedToken = '') => {
  const authorization = headers.authorization || headers.Authorization || '';
  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    throw new ObsidianBridgeIngressError('Unauthorized Obsidian ingress request.', {
      code: 'OBSIDIAN_INGRESS_UNAUTHORIZED',
      statusCode: 401,
    });
  }
};

const normalizeNote = (note = {}) => {
  const source = note && typeof note === 'object' ? note : {};
  return {
    vaultId: readString(source.vaultId),
    vaultName: readString(source.vaultName),
    path: readString(source.path),
    title: readString(source.title) || readString(source.path).split('/').pop()?.replace(/\.md$/i, '') || 'Obsidian note',
    content: typeof source.content === 'string' ? source.content : '',
    selection: typeof source.selection === 'string' ? source.selection : '',
    properties: source.properties && typeof source.properties === 'object' ? source.properties : {},
    headings: Array.isArray(source.headings) ? source.headings : [],
    links: Array.isArray(source.links) ? source.links : [],
  };
};

const contentForAction = (action, note) => {
  if (action === 'send-selection' || action === 'create-memory') {
    return note.selection || note.content;
  }
  return note.content || note.selection;
};

const appendTextForAction = (action, note, content) => {
  const header = action === 'ask-note'
    ? `基于当前 Obsidian 笔记「${note.title}」继续：`
    : `Obsidian ${note.selection ? 'selection' : 'note'}: ${note.title}`;
  return [header, `Path: ${note.path}`, '', content].filter(Boolean).join('\n');
};

export const handleObsidianIngress = async (payload = {}, {
  createArtifact = defaultCreateArtifact,
  broadcast = () => {},
} = {}) => {
  const action = readString(payload.action);
  const kind = ACTION_KIND[action];
  if (!kind) {
    throw new ObsidianBridgeIngressError('Unsupported Obsidian ingress action.', {
      code: 'OBSIDIAN_INGRESS_BAD_ACTION',
      statusCode: 400,
    });
  }

  const note = normalizeNote(payload.note);
  const content = contentForAction(action, note);
  if (!note.path || !content) {
    throw new ObsidianBridgeIngressError('Obsidian ingress requires a note path and content.', {
      code: 'OBSIDIAN_INGRESS_BAD_NOTE',
      statusCode: 400,
    });
  }

  const artifactResult = await createArtifact({
    kind,
    title: note.title,
    projectName: readString(payload.projectName),
    sessionId: readString(payload.sessionId),
    content,
    metadata: {
      source: 'obsidian',
      action,
      vaultId: note.vaultId,
      vaultName: note.vaultName,
      notePath: note.path,
      properties: note.properties,
      headings: note.headings,
      links: note.links,
    },
  }, { autoExport: false });

  const artifact = artifactResult.artifact || artifactResult;
  const message = {
    type: 'obsidian_inbox_item',
    action,
    artifact,
    note,
    appendText: appendTextForAction(action, note, content),
    createdAt: new Date().toISOString(),
  };
  broadcast(message);

  return {
    success: true,
    artifact,
    appendText: message.appendText,
  };
};
