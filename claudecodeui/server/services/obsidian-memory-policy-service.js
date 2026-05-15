import path from 'path';

import {
  createMemoryCandidates as defaultCreateMemoryCandidates,
} from './obsidian-memory-service.js';
import {
  readObsidianBridgeConfig as defaultReadObsidianBridgeConfig,
} from './obsidian-bridge-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeText = (value = '') => readString(value).replace(/\s+/g, ' ');

const slug = (value = '') => normalizeText(value)
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'wiki';

const appendBlock = (existing = '', block = '') => (
  [readString(existing), readString(block)].filter(Boolean).join('\n\n')
);

const resolveProjectName = (data = {}) => {
  const options = data.options && typeof data.options === 'object' ? data.options : {};
  return readString(options.projectName)
    || readString(data.projectName)
    || readString(options.project)
    || (readString(options.projectPath || options.cwd) ? path.basename(readString(options.projectPath || options.cwd)) : '');
};

const providerForCommandType = (type = '') => {
  if (type === 'cursor-command') return 'cursor';
  if (type === 'codex-command') return 'codex';
  if (type === 'gemini-command') return 'gemini';
  return 'claude';
};

const extractPatternBody = (command, patterns) => {
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      return normalizeText(match[1] || match[2] || '');
    }
  }
  return '';
};

const zh = (...codes) => String.fromCodePoint(...codes);

const ZH_SAVE_VERBS = [
  zh(0x4fdd, 0x5b58, 0x5230),
  zh(0x5b58, 0x5230),
  zh(0x5199, 0x5165),
  zh(0x5199, 0x5230),
  zh(0x52a0, 0x5165),
  zh(0x6dfb, 0x52a0, 0x5230),
  zh(0x6c89, 0x6dc0, 0x5230),
  zh(0x8bb0, 0x5f55, 0x5230),
].join('|');

const ZH_WIKI_TARGETS = [
  'Obsidian',
  'Wiki',
  zh(0x77e5, 0x8bc6, 0x5e93),
  zh(0x9879, 0x76ee, 0x77e5, 0x8bc6, 0x5e93),
].join('|');

const ZH_REFERENTIAL_WORDS = [
  zh(0x8fd9, 0x4e2a),
  zh(0x8fd9, 0x6761),
  zh(0x8fd9, 0x4ef6, 0x4e8b),
  zh(0x8fd9, 0x6bb5),
  zh(0x521a, 0x624d, 0x90a3, 0x4e2a),
  zh(0x4e0a, 0x9762),
  zh(0x4ee5, 0x4e0a),
].join('|');

const WIKI_TARGET_PATTERN = String.raw`(?:obsidian|wiki|knowledge\s*base|kb)`;

const WIKI_BODY_PATTERNS = [
  new RegExp(String.raw`^\s*(?:save|add|write|persist|document)\s+(?:to|into)\s+${WIKI_TARGET_PATTERN}\s*[:\uFF1A-]\s*(.+)$`, 'i'),
  new RegExp(String.raw`^\s*(?:save|add|write|persist|document)\s+(.+?)\s+(?:to|into)\s+${WIKI_TARGET_PATTERN}\s*$`, 'i'),
  new RegExp(`^\\s*(?:${ZH_SAVE_VERBS})\\s*(?:${ZH_WIKI_TARGETS})\\s*[:\\uFF1A-]\\s*(.+)$`, 'i'),
  new RegExp(`^\\s*(?:\\u628a)?\\s*(.+?)\\s*(?:${ZH_SAVE_VERBS})\\s*(?:${ZH_WIKI_TARGETS})\\s*$`, 'i'),
];

const WIKI_REFERENTIAL_PATTERNS = [
  new RegExp(String.raw`^\s*(?:save|add|write|persist|document)\s+(?:this|that|the above|that answer|this answer)\s+(?:to|into)\s+${WIKI_TARGET_PATTERN}\s*[.!?]*$`, 'i'),
  new RegExp(String.raw`^\s*(?:save|add|write|persist|document)\s+(?:to|into)\s+${WIKI_TARGET_PATTERN}\s*[.!?]*$`, 'i'),
  new RegExp(`^\\s*(?:${ZH_SAVE_VERBS})\\s*(?:${ZH_WIKI_TARGETS})\\s*(?:${ZH_REFERENTIAL_WORDS})?\\s*[.!?\\u3002\\uFF01\\uFF1F]*$`, 'i'),
  new RegExp(`^\\s*(?:${ZH_REFERENTIAL_WORDS})\\s*(?:${ZH_SAVE_VERBS})\\s*(?:${ZH_WIKI_TARGETS})\\s*[.!?\\u3002\\uFF01\\uFF1F]*$`, 'i'),
];

const REFERENTIAL_BODY_PATTERNS = [
  /^(?:this|that|the above|that answer|this answer)$/i,
  new RegExp(`^(?:${ZH_REFERENTIAL_WORDS})$`, 'i'),
];

const classifyWikiKind = (text = '') => {
  const value = normalizeText(text).toLowerCase();
  if (/(decision|decided|adr|chosen|approved)/i.test(value)
    || /(\u51b3\u5b9a|\u51b3\u7b56|\u5df2\u5b9a|\u65b9\u6848)/i.test(value)) {
    return 'decision';
  }
  if (/(linear|jira|slack|grafana|dashboard|url|link|wiki|docs?|where to find|reference)/i.test(value)
    || /(\u94fe\u63a5|\u5730\u5740|\u770b\u677f|\u6587\u6863|\u8d44\u6599|\u53c2\u8003)/i.test(value)) {
    return 'reference';
  }
  if (/(project|deadline|release|freeze|milestone|incident|architecture|runtime)/i.test(value)
    || /(\u9879\u76ee|\u4e0a\u7ebf|\u53d1\u5e03|\u91cc\u7a0b\u7891|\u4e8b\u6545|\u67b6\u6784|\u8fd0\u884c\u65f6)/i.test(value)) {
    return 'project';
  }
  if (/(preference|pref|always|never|from now on|going forward|future responses?|concise|verbose)/i.test(value)
    || /(\u504f\u597d|\u56de\u7b54|\u7b80\u6d01|\u4ee5\u540e|\u4e0d\u8981|\u522b)/i.test(value)) {
    return 'preference';
  }
  if (/(react|node|typescript|javascript|python|golang|go\b|rust)/i.test(value)
    || /(\u6280\u672f|\u6846\u67b6)/i.test(value)) {
    return 'technology';
  }
  return 'fact';
};

const parseExplicitWikiIntent = (command = '') => {
  const cleanCommand = normalizeText(command);
  if (!cleanCommand) {
    return { intent: 'none', text: '', kind: 'fact' };
  }

  if (WIKI_REFERENTIAL_PATTERNS.some((pattern) => pattern.test(cleanCommand))) {
    return {
      intent: 'wiki',
      text: '',
      kind: 'reference',
      referential: true,
    };
  }

  const text = extractPatternBody(cleanCommand, WIKI_BODY_PATTERNS);
  if (!text) {
    return { intent: 'none', text: '', kind: 'fact' };
  }

  if (REFERENTIAL_BODY_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      intent: 'wiki',
      text: '',
      kind: 'reference',
      referential: true,
    };
  }

  return {
    intent: 'wiki',
    text,
    kind: classifyWikiKind(text),
  };
};

export const detectExplicitWikiIntent = (command = '') => parseExplicitWikiIntent(command).intent;
export const detectExplicitMemoryIntent = detectExplicitWikiIntent;

const sourceForData = (data = {}, parsed = {}) => ({
  source: 'explicit-wiki-command',
  provider: providerForCommandType(data.type),
  sessionId: readString(data.options?.sessionId || data.sessionId),
  projectName: resolveProjectName(data),
  command: readString(data.command).slice(0, 1000),
  intent: parsed.intent,
});

const buildWikiCandidate = (text, kind, source) => ({
  kind,
  text,
  confidence: 1,
  stableKey: `wiki:${kind}:${slug(text)}`,
  status: 'pending',
  action: 'save-to-wiki',
  target: 'wiki',
  source,
});

const withObsidianWiki = (data = {}, obsidianWiki = {}) => ({
  ...data,
  options: {
    ...(data.options || {}),
    obsidianWiki,
  },
});

const normalizeExplicitWikiContext = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const text = normalizeText(value.text || value.content || value.summary);
  if (!text) {
    return null;
  }
  return {
    text: text.slice(0, 4000),
    messageId: readString(value.messageId || value.id),
    messageType: readString(value.messageType || value.type),
  };
};

const resolveWikiText = (data = {}, parsed = {}) => {
  if (!parsed.referential) {
    return normalizeText(parsed.text);
  }
  return normalizeExplicitWikiContext(data.options?.explicitWikiContext)?.text || '';
};

export const applyExplicitWikiIntentToChatCommand = async (data = {}, {
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  createMemoryCandidates = defaultCreateMemoryCandidates,
} = {}) => {
  const command = typeof data.command === 'string' ? data.command : '';
  const parsed = parseExplicitWikiIntent(command);
  if (parsed.intent === 'none') {
    return data;
  }

  const text = resolveWikiText(data, parsed);
  if (!text) {
    return withObsidianWiki(data, {
      used: true,
      intent: 'save-to-wiki',
      status: 'needs-context',
      kind: parsed.kind,
      text: parsed.text,
      message: 'No explicit wiki context was available; no Obsidian candidate was created.',
    });
  }

  const config = readObsidianBridgeConfig({ includeToken: false });
  if (!config.enabled) {
    return withObsidianWiki(data, {
      used: true,
      intent: 'save-to-wiki',
      status: 'disabled',
      kind: parsed.referential ? classifyWikiKind(text) : parsed.kind,
      text,
      message: 'Obsidian bridge is disabled; wiki candidate was not created.',
    });
  }

  try {
    const source = sourceForData(data, parsed);
    const explicitWikiContext = normalizeExplicitWikiContext(data.options?.explicitWikiContext);
    const kind = parsed.referential ? classifyWikiKind(text) : parsed.kind;
    const candidateResult = await createMemoryCandidates({
      candidates: [buildWikiCandidate(text, kind, {
        ...source,
        ...(explicitWikiContext ? { explicitWikiContext } : {}),
      })],
      source,
    });
    const candidateIds = (candidateResult.candidates || []).map((candidate) => candidate.id).filter(Boolean);
    return withObsidianWiki(data, {
      used: true,
      intent: 'save-to-wiki',
      status: 'candidate-created',
      kind,
      text,
      referential: Boolean(parsed.referential),
      candidateIds,
      candidates: candidateResult.candidates || [],
    });
  } catch (error) {
    return withObsidianWiki(data, {
      used: true,
      intent: 'save-to-wiki',
      status: 'error',
      text,
      error: error?.message || String(error || 'Failed to create Obsidian wiki candidate.'),
    });
  }
};

export const applyExplicitMemoryIntentToChatCommand = applyExplicitWikiIntentToChatCommand;

export const buildObsidianWikiPolicyPrompt = () => [
  '# Obsidian Wiki Policy',
  '',
  'Obsidian is the primary AI memory store and project Wiki readback source. Local MEMORY.md is only an offline fallback when the bridge cannot write.',
  '',
  'Use Wiki and AI memory context only when it is relevant to the current user request. Treat it as historical material, not proof of current repository, file, flag, API, or runtime state.',
  '',
  'Current code, files, settings, and external facts can drift. Verify current state with tools before recommending an action that depends on freshness.',
  '',
  'Automatic memory extraction is handled by the host after assistant turns. Do not claim that Obsidian saved a memory unless an Obsidian result, candidate, or fallback status is explicitly provided by the host.',
  '',
  'Explicit requests to save to Obsidian, write to Wiki, or persist to the knowledge base are handled by the host as auditable Obsidian candidates.',
  '',
  '/init and project guidance templates are not memory writes.',
].join('\n');

export const buildObsidianMemoryPolicyPrompt = buildObsidianWikiPolicyPrompt;

export const applyObsidianWikiPolicyPromptToChatCommand = (data = {}, {
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
} = {}) => {
  const command = typeof data.command === 'string' ? data.command : '';
  if (!command.trim()) {
    return data;
  }

  const config = readObsidianBridgeConfig({ includeToken: false });
  if (!config.enabled) {
    return data;
  }

  const prompt = buildObsidianWikiPolicyPrompt();
  if (data.type === 'claude-command') {
    const appendSystemPrompt = appendBlock(data.options?.appendSystemPrompt, prompt);
    return {
      ...data,
      options: {
        ...(data.options || {}),
        appendSystemPrompt,
        obsidianWikiPolicy: { injected: true },
      },
    };
  }

  return {
    ...data,
    command: [prompt, '', command].join('\n'),
    options: {
      ...(data.options || {}),
      obsidianWikiPolicy: { injected: true },
    },
  };
};

export const applyObsidianMemoryPolicyPromptToChatCommand = applyObsidianWikiPolicyPromptToChatCommand;
