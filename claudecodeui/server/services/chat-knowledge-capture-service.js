import crypto from 'crypto';

import { db as defaultDb } from '../database/db.js';
import {
  OBSIDIAN_AUTO_CAPTURE_KEYS_SOURCE_INDEX_SQL,
  OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL,
} from '../database/schema.js';

import { createArtifact as defaultCreateArtifact } from './artifact-service.js';
import { createMemoryCandidates as defaultCreateMemoryCandidates } from './obsidian-memory-service.js';
import { readObsidianBridgeConfig as defaultReadObsidianBridgeConfig } from './obsidian-bridge-service.js';

const defaultIngestKnowledgeSourceToWiki = async (...args) => {
  const module = await import('./obsidian-wiki-service.js');
  return module.ingestKnowledgeSourceToWiki(...args);
};

const AUTO_CAPTURE_SOURCE = 'chat-auto-capture';
const MIN_EXPLICIT_CONTENT_LENGTH = 24;
const MIN_INFERRED_CONTENT_LENGTH = 120;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeWhitespace = (value) => readString(value).replace(/\s+/g, ' ');

const hashText = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex')
  .slice(0, 16);

const KNOWLEDGE_PROMPT_PATTERN = /(summary|summarize|recap|review|notes|document|decision|plan|adr|memory|obsidian|save|second\s*brain|aimemory|ai memory)/i;
const KNOWLEDGE_CONTENT_PATTERN = /(summary|decision|plan|next steps|follow-up|review notes|architecture|adr|memory|action items|preference|stable fact|reading notes|idea|reflection)/i;
const MEMORY_PATTERN = /(ai memory|aimemory|memory|preference|stable fact|remember|future response|from now on)/i;
const SECOND_BRAIN_PATTERN = /(second\s*brain|secondbrain|daily|journal|reading|book notes?|article notes?|idea|reflection|person|people|theme|topic)/i;
const SUMMARY_PATTERN = /(summary|summarize|recap|review notes?)/i;
const DECISION_PATTERN = /(decision|decided|adr|architecture decision)/i;
const PLAN_PATTERN = /(plan|next steps|action items|todo)/i;
const VALID_MODES = new Set(['project-knowledge', 'second-brain', 'ai-memory']);
const MODE_LABELS = {
  'project-knowledge': '项目知识库',
  'second-brain': '第二大脑',
  'ai-memory': 'AI 记忆',
};

const normalizeRoutingMode = (value, fallback) => (VALID_MODES.has(value) ? value : fallback);

const uniqueModes = (modes = []) => {
  const seen = new Set();
  return modes.filter((mode) => {
    if (!VALID_MODES.has(mode) || seen.has(mode)) return false;
    seen.add(mode);
    return true;
  });
};

const normalizeRoutingRules = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const directThreshold = Number(source.aiMemoryDirectWriteThreshold);
  const candidateThreshold = Number(source.aiMemoryCandidateThreshold);
  return {
    readingNotesMode: normalizeRoutingMode(source.readingNotesMode, 'second-brain'),
    projectKnowledgeMode: normalizeRoutingMode(source.projectKnowledgeMode, 'project-knowledge'),
    aiMemoryMode: normalizeRoutingMode(source.aiMemoryMode, 'ai-memory'),
    aiMemoryDirectWriteThreshold: Number.isFinite(directThreshold) ? Math.min(Math.max(directThreshold, 0.55), 0.99) : 0.85,
    aiMemoryCandidateThreshold: Number.isFinite(candidateThreshold) ? Math.min(Math.max(candidateThreshold, 0.1), 0.9) : 0.55,
  };
};

const signal = (label, pattern) => ({ label, pattern });

const SECOND_BRAIN_SIGNALS = [
  signal('second brain target', SECOND_BRAIN_PATTERN),
  signal('reading notes', /\b(reading notes?|book notes?|article notes?|evergreen notes?)\b/i),
  signal('idea', /\b(idea|ideas|insight|thought)\b/i),
  signal('person', /\b(person|people|profile|relationship|contact)\b/i),
  signal('reflection', /\b(reflection|journal|theme|topic|question)\b/i),
];

const AI_MEMORY_SIGNALS = [
  signal('ai memory target', MEMORY_PATTERN),
  signal('preference', /\b(user|human)\s+(prefers|likes|wants|expects|needs|usually|always|never)\b/i),
  signal('stable fact', /\b(durable user fact|stable fact|remember that|future chats?|future responses?|standing preference)\b/i),
  signal('durable decision', /\b(from now on|next time|always remember|keep this preference)\b/i),
];

const PROJECT_KNOWLEDGE_SIGNALS = [
  signal('project implementation', /\b(project|code|repository|implementation|architecture|api|bug|test|review|module|workflow|release|smoke)\b/i),
  signal('project decision', /\b(decision|plan|adr|action items?|next steps?)\b/i),
  signal('project summary', /\b(project summary|implementation summary|code review|test plan|release notes?)\b/i),
];

const countMarkdownBullets = (content) => (
  (content.match(/^\s*(?:[-*+]|\d+\.)\s+\S/gm) || []).length
);

const countMarkdownHeadings = (content) => (
  (content.match(/^#{1,6}\s+\S/gm) || []).length
);

const matchedSignals = (combined, signals) => signals
  .filter(({ pattern }) => pattern.test(combined))
  .map(({ label }) => label);

const firstHeading = (content) => {
  const match = content.match(/^#{1,3}\s+(.+)$/m);
  return normalizeWhitespace(match?.[1] || '');
};

const buildSourceId = ({
  sourceId = '',
  sessionId = '',
  messageKey = '',
  timestamp = '',
  content = '',
} = {}) => {
  const provided = readString(sourceId);
  if (provided) return provided;
  return [
    'chat',
    readString(sessionId) || 'no-session',
    readString(messageKey) || readString(timestamp) || 'message',
    hashText(content),
  ].join(':');
};

const buildContentHash = ({
  sessionId = '',
  provider = '',
  timestamp = '',
  content = '',
} = {}) => hashText([
  readString(sessionId) || 'no-session',
  readString(provider) || 'assistant',
  readString(timestamp) || 'no-time',
  normalizeWhitespace(content),
].join('\n'));

const buildIdempotencyKey = ({ sourceId = '', contentHash = '' } = {}) => (
  contentHash ? `content:${contentHash}` : `source:${hashText(sourceId)}`
);

const safeJson = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const parseJson = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const ensureAutoCaptureKeysTable = (db) => {
  db.exec(OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL);
  db.exec(OBSIDIAN_AUTO_CAPTURE_KEYS_SOURCE_INDEX_SQL);
};

const defaultClaimCaptureKey = ({ sourceId = '', contentHash = '' } = {}, db = defaultDb) => {
  ensureAutoCaptureKeysTable(db);
  const idempotencyKey = buildIdempotencyKey({ sourceId, contentHash });
  const insert = db.prepare(`
    INSERT OR IGNORE INTO obsidian_auto_capture_keys (idempotency_key, source_id, content_hash, status)
    VALUES (?, ?, ?, 'in_progress')
  `).run(idempotencyKey, sourceId || null, contentHash || null);
  const row = db.prepare(`
    SELECT * FROM obsidian_auto_capture_keys
    WHERE idempotency_key = ?
       OR (? <> '' AND source_id = ?)
       OR (? <> '' AND content_hash = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(idempotencyKey, sourceId, sourceId, contentHash, contentHash);
  return {
    claimed: insert.changes > 0,
    idempotencyKey,
    row,
  };
};

const defaultCompleteCaptureKey = ({
  idempotencyKey = '',
  artifactId = '',
  status = 'captured',
  error = null,
} = {}, db = defaultDb) => {
  if (!idempotencyKey) return;
  ensureAutoCaptureKeysTable(db);
  db.prepare(`
    UPDATE obsidian_auto_capture_keys
    SET artifact_id = COALESCE(NULLIF(?, ''), artifact_id),
        status = ?,
        error_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE idempotency_key = ?
  `).run(artifactId || '', status, error ? safeJson(error) : null, idempotencyKey);
};

const chooseModeDetails = ({ content, userPrompt, defaultMode, routingRules = {} }) => {
  const rules = normalizeRoutingRules(routingRules);
  const combined = `${userPrompt}\n${content}`;
  const signalMatches = {
    'project-knowledge': matchedSignals(combined, PROJECT_KNOWLEDGE_SIGNALS),
    'second-brain': matchedSignals(combined, SECOND_BRAIN_SIGNALS),
    'ai-memory': matchedSignals(combined, AI_MEMORY_SIGNALS),
  };
  const routingScores = Object.fromEntries(
    Object.entries(signalMatches).map(([mode, signals]) => [mode, signals.length]),
  );

  let mode = defaultMode || 'project-knowledge';
  if (
    routingScores['ai-memory'] >= 2
    && routingScores['ai-memory'] >= routingScores['second-brain']
    && routingScores['ai-memory'] >= routingScores['project-knowledge']
  ) {
    mode = 'ai-memory';
  } else if (
    routingScores['second-brain'] >= 2
    && routingScores['second-brain'] >= routingScores['project-knowledge']
  ) {
    mode = 'second-brain';
  } else if (routingScores['ai-memory'] >= 1 && MEMORY_PATTERN.test(combined)) {
    mode = 'ai-memory';
  } else if (routingScores['second-brain'] >= 1 && SECOND_BRAIN_PATTERN.test(combined)) {
    mode = 'second-brain';
  }

  const applyRule = (candidateMode) => {
    if (candidateMode === 'second-brain') return rules.readingNotesMode;
    if (candidateMode === 'ai-memory') return rules.aiMemoryMode;
    return rules.projectKnowledgeMode;
  };

  mode = applyRule(mode);
  const matchedModes = uniqueModes(
    Object.entries(routingScores)
      .filter(([, score]) => score > 0)
      .map(([candidateMode]) => applyRule(candidateMode)),
  );
  const routingModes = uniqueModes([mode, ...matchedModes]);

  const routingSignals = signalMatches[mode] || [];
  const reasonSignals = routingSignals.length > 0 ? routingSignals.join(', ') : '默认规则';
  return {
    mode,
    routingMode: mode,
    routingScores,
    routingSignals,
    routingReason: `命中 ${reasonSignals}，路由到 ${MODE_LABELS[mode] || mode}。`,
    routingModes: routingModes.length > 0 ? routingModes : [mode],
  };
};

const chooseKind = ({ content, userPrompt, mode }) => {
  const combined = `${userPrompt}\n${content}`;
  if (mode === 'ai-memory') return 'ai-memory';
  if (SUMMARY_PATTERN.test(combined)) return 'session-summary';
  if (DECISION_PATTERN.test(combined)) return 'decision';
  if (PLAN_PATTERN.test(combined)) return 'plan';
  return 'knowledge';
};

const buildTitle = ({ content, timestamp }) => {
  const heading = firstHeading(content);
  if (heading) return heading.slice(0, 120);
  const date = new Date(timestamp || Date.now());
  const stamp = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 16).replace('T', ' ')
    : date.toISOString().slice(0, 16).replace('T', ' ');
  return `Chat summary - ${stamp}`;
};

const isStableMemoryAssessment = (assessment = {}) => (
  assessment.mode === 'ai-memory'
  && assessment.confidence >= 0.85
  && (assessment.routingSignals || []).some((signalLabel) => /stable fact|preference|durable decision/i.test(signalLabel))
);

const memoryCapturePolicyForAssessment = (assessment = {}, routingRules = {}) => {
  const rules = normalizeRoutingRules(routingRules);
  if (assessment.mode !== 'ai-memory') return 'not-memory';
  if (assessment.confidence >= rules.aiMemoryDirectWriteThreshold && isStableMemoryAssessment(assessment)) return 'direct';
  if (assessment.confidence >= rules.aiMemoryCandidateThreshold) return 'candidate';
  return 'skip';
};

export const assessChatKnowledgeCapture = ({
  content = '',
  userPrompt = '',
  defaultMode = 'project-knowledge',
  timestamp = '',
  routingRules = {},
} = {}) => {
  const cleanContent = readString(content);
  const cleanPrompt = readString(userPrompt);
  const emptyRoutingScores = {
    'project-knowledge': 0,
    'second-brain': 0,
    'ai-memory': 0,
  };

  if (!cleanContent) {
    return {
      shouldCapture: false,
      reason: 'empty',
      confidence: 0,
      mode: defaultMode,
      routingMode: defaultMode,
      routingScores: emptyRoutingScores,
      routingSignals: [],
      routingReason: '没有可写入的 assistant 内容。',
      routingConfidence: 0,
    };
  }

  const routing = chooseModeDetails({
    content: cleanContent,
    userPrompt: cleanPrompt,
    defaultMode,
    routingRules,
  });

  const promptLooksExplicit = KNOWLEDGE_PROMPT_PATTERN.test(cleanPrompt);
  if (cleanContent.length < (promptLooksExplicit ? MIN_EXPLICIT_CONTENT_LENGTH : MIN_INFERRED_CONTENT_LENGTH)) {
    return {
      shouldCapture: false,
      reason: 'not_knowledge',
      confidence: 0.15,
      ...routing,
      routingConfidence: 0.15,
    };
  }

  let confidence = 0;
  if (promptLooksExplicit) confidence += 0.35;
  if (KNOWLEDGE_CONTENT_PATTERN.test(cleanContent)) confidence += 0.3;
  if (countMarkdownHeadings(cleanContent) > 0) confidence += 0.15;
  if (countMarkdownBullets(cleanContent) >= 2) confidence += 0.15;
  if (cleanContent.length >= 500) confidence += 0.1;
  if (cleanContent.length >= 1200) confidence += 0.1;

  confidence = Math.min(confidence, 0.95);
  if (confidence < 0.55) {
    return {
      shouldCapture: false,
      reason: 'not_knowledge',
      confidence,
      ...routing,
      routingConfidence: confidence,
    };
  }

  const assessment = {
    shouldCapture: true,
    reason: promptLooksExplicit ? 'prompt_requested_knowledge_capture' : 'assistant_response_looks_like_knowledge',
    confidence,
    mode: routing.mode,
    ...routing,
    routingConfidence: confidence,
    kind: chooseKind({
      content: cleanContent,
      userPrompt: cleanPrompt,
      mode: routing.mode,
    }),
    title: buildTitle({
      content: cleanContent,
      timestamp,
    }),
  };
  return {
    ...assessment,
    memoryCapturePolicy: memoryCapturePolicyForAssessment(assessment, routingRules),
  };
};

const defaultFindExistingCapture = (sourceId, fingerprint = {}, db = defaultDb) => {
  const contentHash = readString(fingerprint.contentHash);
  if (!sourceId && !contentHash) return null;
  return db.prepare(`
    SELECT id, kind, title, project_name, session_id, metadata_json, created_at, updated_at
    FROM artifacts
    WHERE json_extract(COALESCE(metadata_json, '{}'), '$.source') = ?
      AND (
        json_extract(COALESCE(metadata_json, '{}'), '$.sourceId') = ?
        OR (? <> '' AND json_extract(COALESCE(metadata_json, '{}'), '$.contentHash') = ?)
      )
    ORDER BY created_at DESC
    LIMIT 1
  `).get(AUTO_CAPTURE_SOURCE, sourceId, contentHash, contentHash) || null;
};

export const createChatKnowledgeCaptureService = ({
  db = defaultDb,
  createArtifact = defaultCreateArtifact,
  createMemoryCandidates = defaultCreateMemoryCandidates,
  readObsidianBridgeConfig = defaultReadObsidianBridgeConfig,
  ingestKnowledgeSourceToWiki = defaultIngestKnowledgeSourceToWiki,
  findExistingCapture = (sourceId, fingerprint) => defaultFindExistingCapture(sourceId, fingerprint, db),
  claimCaptureKey = (fingerprint) => defaultClaimCaptureKey(fingerprint, db),
  completeCaptureKey = (patch) => defaultCompleteCaptureKey(patch, db),
} = {}) => {
  const autoCaptureChatKnowledge = async (payload = {}) => {
    const config = readObsidianBridgeConfig({ includeToken: false });
    if (!config.enabled || !config.autoExportKnowledgeArtifacts) {
      return {
        success: true,
        captured: false,
        reason: 'disabled',
      };
    }

    const content = readString(payload.content);
    const sourceId = buildSourceId({
      sourceId: payload.sourceId,
      sessionId: payload.sessionId,
      messageKey: payload.messageKey,
      timestamp: payload.timestamp,
      content,
    });
    const contentHash = buildContentHash({
      sessionId: payload.sessionId,
      provider: payload.provider,
      timestamp: payload.timestamp,
      content,
    });
    const fingerprint = {
      contentHash,
      sessionId: payload.sessionId,
      provider: payload.provider,
      timestamp: payload.timestamp,
    };

    const claim = claimCaptureKey({ sourceId, contentHash });
    if (!claim.claimed) {
      const existingForClaim = findExistingCapture(sourceId, fingerprint);
      if (existingForClaim) {
        return {
          success: true,
          captured: false,
          reason: 'duplicate',
          artifactId: existingForClaim.id,
          status: 'duplicate',
        };
      }
      if (claim.row?.status !== 'in_progress') {
        // A stale idempotency row without an artifact should not permanently block recapture.
      } else {
        return {
          success: true,
          captured: false,
          reason: 'in_progress',
          artifactId: claim.row?.artifact_id || '',
          status: claim.row?.status || 'in_progress',
          error: parseJson(claim.row?.error_json).message || '',
        };
      }
    }

    const completeClaim = (patch) => completeCaptureKey({
      idempotencyKey: claim.idempotencyKey,
      ...patch,
    });

    const existing = findExistingCapture(sourceId, {
      ...fingerprint,
    });
    if (existing) {
      completeClaim({ artifactId: existing.id, status: 'duplicate' });
      return {
        success: true,
        captured: false,
        reason: 'duplicate',
        artifactId: existing.id,
      };
    }

    const assessment = assessChatKnowledgeCapture({
      content,
      userPrompt: payload.previousUserPrompt || payload.userPrompt || '',
      defaultMode: config.defaultMode || 'project-knowledge',
      timestamp: payload.timestamp,
      routingRules: config.routingRules || {},
    });
    if (!assessment.shouldCapture) {
      completeClaim({ status: 'skipped' });
      return {
        success: true,
        captured: false,
        reason: assessment.reason,
        confidence: assessment.confidence,
        mode: assessment.mode,
        routingMode: assessment.routingMode,
        routingScores: assessment.routingScores,
        routingSignals: assessment.routingSignals,
        routingReason: assessment.routingReason,
        routingConfidence: assessment.routingConfidence,
        routingModes: assessment.routingModes || [assessment.mode],
      };
    }

    if (assessment.memoryCapturePolicy === 'candidate') {
      const candidates = createMemoryCandidates({
        candidates: [{
          kind: 'fact',
          text: content.slice(0, 1200),
          confidence: assessment.confidence,
          stableKey: `chat:${contentHash}`,
          status: 'pending',
        }],
        source: {
          sourceId,
          sessionId: readString(payload.sessionId),
          projectName: readString(payload.projectName),
          title: assessment.title,
          provider: readString(payload.provider),
        },
      });
      completeClaim({ status: 'candidate' });
      return {
        success: true,
        captured: true,
        status: 'candidate',
        reason: 'memory_candidate',
        confidence: assessment.confidence,
        mode: assessment.mode,
        kind: assessment.kind,
        candidates: candidates.candidates || [],
        routingMode: assessment.routingMode,
        routingScores: assessment.routingScores,
        routingSignals: assessment.routingSignals,
        routingReason: assessment.routingReason,
        routingConfidence: assessment.routingConfidence,
        routingModes: assessment.routingModes || [assessment.mode],
      };
    }

    const metadata = {
      source: AUTO_CAPTURE_SOURCE,
      sourceId,
      contentHash,
      provider: readString(payload.provider),
      previousUserPrompt: normalizeWhitespace(payload.previousUserPrompt || payload.userPrompt || '').slice(0, 1000),
      messageTimestamp: payload.timestamp || '',
      obsidianMode: assessment.mode,
      obsidianModes: assessment.routingModes || [assessment.mode],
      autoCaptureReason: assessment.reason,
      confidence: assessment.confidence,
      routingMode: assessment.routingMode,
      routingModes: assessment.routingModes || [assessment.mode],
      routingScores: assessment.routingScores,
      routingSignals: assessment.routingSignals,
      routingReason: assessment.routingReason,
      routingConfidence: assessment.routingConfidence,
      memoryCapturePolicy: assessment.memoryCapturePolicy,
      kind: assessment.kind,
    };

    try {
      const result = config.wikiPrimaryEnabled === true
        ? await ingestKnowledgeSourceToWiki({
          source: AUTO_CAPTURE_SOURCE,
          sourceId,
          title: assessment.title,
          projectName: readString(payload.projectName),
          sessionId: readString(payload.sessionId),
          content,
          kind: assessment.kind,
          metadata,
          modes: assessment.routingModes || [assessment.mode],
        })
        : await createArtifact({
          kind: assessment.kind,
          title: assessment.title,
          projectName: readString(payload.projectName),
          sessionId: readString(payload.sessionId),
          content,
          metadata,
        });
      completeClaim({ artifactId: result.artifact?.id || result.artifactId || '', status: 'captured' });

      return {
        success: true,
        captured: true,
        status: 'captured',
        reason: assessment.reason,
        confidence: assessment.confidence,
        mode: assessment.mode,
        kind: assessment.kind,
        artifact: result.artifact,
        artifactId: result.artifact?.id || result.artifactId || '',
        obsidianBridge: result.obsidianBridge,
        routingMode: assessment.routingMode,
        routingScores: assessment.routingScores,
        routingSignals: assessment.routingSignals,
        routingReason: assessment.routingReason,
        routingConfidence: assessment.routingConfidence,
        routingModes: assessment.routingModes || [assessment.mode],
      };
    } catch (error) {
      completeClaim({
        status: 'failed',
        error: { message: error?.message || 'Auto capture failed.' },
      });
      throw error;
    }
  };

  return {
    autoCaptureChatKnowledge,
  };
};

export const chatKnowledgeCaptureService = createChatKnowledgeCaptureService();
export const autoCaptureChatKnowledge = (...args) => chatKnowledgeCaptureService.autoCaptureChatKnowledge(...args);
export const buildChatKnowledgeContentHash = buildContentHash;
