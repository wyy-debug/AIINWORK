import { readResolvedBrainRuntimeConfig } from './mtl-code-model-service.js';
import { createBrainHybridRetrievalService } from './brain-hybrid-retrieval-service.js';
import { buildBrainRecallPack } from './brain-recall-pack-service.js';
import { brainStore as defaultBrainStore } from './brain-store-service.js';
import {
  applyContextFusionGuardrailsToChatCommand,
  filterBrainRecallHitsAgainstObsidian,
} from './context-fusion-guardrail-service.js';

const readString = (value) => (typeof value === 'string' ? value.trim() : '');
const compactLine = (value = '', max = 220) => {
  const text = readString(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const appendPrompt = (existing, addition) => {
  const current = readString(existing);
  const next = readString(addition);
  if (!next) return current || undefined;
  return current ? `${current}\n\n${next}` : next;
};

function getCommandContext(data = {}, provider = 'claude') {
  const options = data?.options && typeof data.options === 'object' ? data.options : {};
  const sessionId = readString(options.sessionId)
    || readString(data.sessionId)
    || readString(options.clientSessionId)
    || readString(data.clientSessionId);
  const projectPath = readString(options.projectPath) || readString(options.cwd);
  const projectName = readString(options.projectName)
    || readString(data.projectName)
    || (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : '');
  return { sessionId, provider, projectName, projectPath };
}

function tokenize(text = '') {
  return [...new Set(String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 80))];
}

function matchesKeywords(node, keywords = []) {
  if (keywords.length === 0) return false;
  const haystack = `${node.title || ''} ${node.summary || ''}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function trimByTokenBudget(text = '', maxTokens = 1200) {
  const maxChars = Math.max(800, Number(maxTokens || 1200) * 4);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[Argus Brain Context truncated]` : text;
}

export function buildArgusBrainContextPrompt({ compaction = null, projectNodes = [], matchedNodes = [], hybridHits = [], diagnostics = {} } = {}) {
  if (!compaction && projectNodes.length === 0 && matchedNodes.length === 0 && hybridHits.length === 0) {
    return '';
  }
  const decisions = [
    ...(Array.isArray(compaction?.activeDecisions) ? compaction.activeDecisions : []),
    ...projectNodes.filter((node) => node.nodeType === 'decision').map((node) => node.summary || node.title),
    ...matchedNodes.filter((node) => node.nodeType === 'decision').map((node) => node.summary || node.title),
  ].map((item) => compactLine(item, 180)).filter(Boolean).slice(0, 6);
  const risks = [
    ...(Array.isArray(compaction?.openRisks) ? compaction.openRisks : []),
    ...projectNodes.filter((node) => node.nodeType === 'risk').map((node) => node.summary || node.title),
    ...matchedNodes.filter((node) => node.nodeType === 'risk').map((node) => node.summary || node.title),
  ].map((item) => compactLine(item, 180)).filter(Boolean).slice(0, 6);
  const refs = [
    ...(Array.isArray(compaction?.refs) ? compaction.refs : []),
    ...matchedNodes.flatMap((node) => Array.isArray(node.refIds) ? node.refIds : []),
  ].filter(Boolean).slice(0, 12);
  const relevantMemory = hybridHits
    .map((hit) => `${hit.title}: ${hit.summary || ''}`.trim())
    .map((item) => compactLine(item, 200))
    .filter(Boolean)
    .slice(0, 8);
  const lines = [
    '## Argus Brain Context',
    'Argus Brain is historical task state. Verify current files, code, settings, and runtime results before acting on it.',
    compaction?.currentGoal ? `Current goal: ${compactLine(compaction.currentGoal)}` : '',
    compaction?.mermaid ? ['Task canvas:', '```mermaid', compaction.mermaid, '```'].join('\n') : '',
    decisions.length ? ['Active decisions:', ...decisions.map((item) => `- ${item}`)].join('\n') : '',
    risks.length ? ['Open risks:', ...risks.map((item) => `- ${item}`)].join('\n') : '',
    relevantMemory.length ? ['Relevant memory:', ...relevantMemory.map((item) => `- ${item}`)].join('\n') : '',
    compaction?.nextAction ? `Next suggested action: ${compactLine(compaction.nextAction)}` : '',
    refs.length ? `Refs: ${refs.join(', ')}` : '',
    diagnostics.reason ? `Recall reason: ${diagnostics.reason}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function createBrainRecallService({
  store = defaultBrainStore,
  readConfig = readResolvedBrainRuntimeConfig,
  logger = console,
  hybridRetrieval = createBrainHybridRetrievalService({ store }),
} = {}) {
  const recall = async (data = {}, provider = 'claude') => {
    let config;
    try {
      config = await readConfig();
    } catch (error) {
      logger.warn?.('[Argus Brain] failed to read config:', error?.message || error);
      return { config: { enabled: false }, prompt: '', diagnostics: { enabled: false, error: error?.message || String(error) } };
    }
    if (config?.enabled === false) {
      return { config, prompt: '', diagnostics: { enabled: false, status: 'disabled' } };
    }

    const context = getCommandContext(data, provider);
    if (!context.sessionId && !context.projectName) {
      return { config, prompt: '', diagnostics: { enabled: true, status: 'no-scope' } };
    }

    try {
      const compaction = context.sessionId
        ? store.getLatestCompaction({ sessionId: context.sessionId, provider })
        : null;
      const projectNodes = context.projectName
        ? store.listProjectNodes({
          projectName: context.projectName,
          provider,
          types: ['decision', 'risk'],
          limit: 12,
        })
        : [];
      const keywords = tokenize(data.command);
      const matchedNodes = context.projectName
        ? store.listProjectNodes({ projectName: context.projectName, provider, limit: 30 })
          .filter((node) => matchesKeywords(node, keywords))
          .slice(0, 8)
        : [];
      const retrieval = config?.hybridRetrieval?.enabled === false
        ? { hits: [], diagnostics: { mode: 'disabled', degraded: false, warnings: [] } }
        : await hybridRetrieval.retrieve({
          query: data.command || '',
          sessionId: context.sessionId,
          provider,
          projectName: context.projectName,
          limit: config?.hybridRetrieval?.limit || 8,
          vectorTimeoutMs: config?.hybridRetrieval?.vectorTimeoutMs || 80,
        });
      const dedupedRetrieval = filterBrainRecallHitsAgainstObsidian(
        retrieval.hits,
        data?.options?.obsidianContext?.sources || [],
      );
      const retrievalHits = dedupedRetrieval.hits;
      const legacyPrompt = buildArgusBrainContextPrompt({
        compaction,
        projectNodes,
        matchedNodes,
        hybridHits: retrievalHits,
        diagnostics: {
          reason: compaction ? 'latest session compaction' : retrievalHits.length ? 'hybrid retrieval' : matchedNodes.length ? 'keyword matched project nodes' : 'project decisions and risks',
        },
      });
      const recallPack = buildBrainRecallPack({
        command: data.command || '',
        maxTokens: config.maxInjectedTokens || 1200,
        compaction,
        retrievalHits,
      });
      const prompt = trimByTokenBudget(recallPack.prompt || legacyPrompt, config.maxInjectedTokens);
      const diagnostics = {
        enabled: true,
        used: Boolean(prompt),
        status: prompt ? 'injected' : 'empty',
        recallHits: [
          ...(compaction ? [{ kind: 'compaction', id: compaction.id }] : []),
          ...retrievalHits.map((hit) => ({ kind: hit.kind, id: hit.id, title: hit.title, score: hit.score, reasons: hit.reasons })),
          ...projectNodes.map((node) => ({ kind: 'project-node', id: node.id, type: node.nodeType })),
          ...matchedNodes.map((node) => ({ kind: 'keyword-node', id: node.id, type: node.nodeType })),
        ].slice(0, 20),
        dedupedAgainstObsidian: dedupedRetrieval.removed,
        recallPack: recallPack.diagnostics,
        retrieval: retrieval.diagnostics,
        currentGoal: compaction?.currentGoal || '',
        nextAction: compaction?.nextAction || '',
        openRisks: compaction?.openRisks || projectNodes.filter((node) => node.nodeType === 'risk').map((node) => node.summary || node.title),
        activeDecisions: compaction?.activeDecisions || projectNodes.filter((node) => node.nodeType === 'decision').map((node) => node.summary || node.title),
        latestCompactionId: compaction?.id || '',
      };
      return { config, prompt, diagnostics };
    } catch (error) {
      logger.warn?.('[Argus Brain] recall failed:', error?.message || error);
      return { config, prompt: '', diagnostics: { enabled: true, used: false, status: 'error', error: error?.message || String(error) } };
    }
  };

  const applyToChatCommand = async (data = {}, provider = 'claude') => {
    const { config, prompt, diagnostics } = await recall(data, provider);
    const options = data?.options && typeof data.options === 'object' ? data.options : {};
    return applyContextFusionGuardrailsToChatCommand({
      ...data,
      options: {
        ...options,
        appendSystemPrompt: prompt
          ? appendPrompt(options.appendSystemPrompt, prompt)
          : options.appendSystemPrompt,
        brainRuntime: config,
        brainRecall: diagnostics,
        runtimeDiagnostics: {
          ...(options.runtimeDiagnostics || {}),
          brainRuntime: {
            ...(config || {}),
            recall: diagnostics,
          },
          appendSystemPromptLength: prompt
            ? String(appendPrompt(options.appendSystemPrompt, prompt) || '').length
            : options.runtimeDiagnostics?.appendSystemPromptLength,
        },
      },
    });
  };

  return {
    applyToChatCommand,
    recall,
  };
}

export const brainRecallService = createBrainRecallService();
