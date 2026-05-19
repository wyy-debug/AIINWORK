import { describe, expect, it } from 'vitest';

import { createBrainHybridRetrievalService } from '../brain-hybrid-retrieval-service.js';
import { createBrainPostTurnExtractionService } from '../brain-post-turn-extraction-service.js';
import { createMemoryBrainStore } from './brain-test-store.mjs';

describe('Brain post-turn extraction', () => {
  it('deduplicates repeated turns by stable key, fuzzy text, entity overlap, and source refs', () => {
    const { store } = createMemoryBrainStore();
    const first = store.addEvent({
      sessionId: 'post-turn-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision: use RRF recall for checkout retries',
      content: 'Decision: use RRF recall for checkout retries in server/routes/checkouts.js.',
      refs: [{ refType: 'raw_text', refId: 'decision-a', label: 'Decision A', content: 'use RRF recall' }],
    });
    const repeated = store.addEvent({
      sessionId: 'post-turn-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision - Use RRF recall for checkout retry handling',
      content: 'We decided to use RRF recall for server/routes/checkouts.js checkout retry work.',
      refs: [{ refType: 'raw_text', refId: 'decision-b', label: 'Decision B', content: 'use RRF recall again' }],
    });
    const extraction = createBrainPostTurnExtractionService({ store });

    const firstResult = extraction.extractPostTurn({
      sessionId: 'post-turn-1',
      projectName: 'Argus',
      events: [first],
    });
    const secondResult = extraction.extractPostTurn({
      sessionId: 'post-turn-1',
      projectName: 'Argus',
      events: [repeated],
    });
    const atoms = store.listAtoms({ sessionId: 'post-turn-1', status: '', limit: 20 });

    expect(firstResult.extractedAtoms).toHaveLength(1);
    expect(secondResult.dedupedCount).toBe(1);
    expect(atoms.filter((atom) => atom.atomType === 'decision')).toHaveLength(1);
    expect(atoms[0].sourceEventIds).toEqual(expect.arrayContaining([first.id, repeated.id]));
    expect(atoms[0].refIds).toEqual(expect.arrayContaining([
      first.refs[0].id,
      repeated.refs[0].id,
    ]));
  });

  it('supersedes conflicting decisions so only the active decision is recalled', async () => {
    const { store } = createMemoryBrainStore();
    const extraction = createBrainPostTurnExtractionService({ store });
    const oldDecision = store.addEvent({
      sessionId: 'conflict-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision: use polling for bridge health',
      content: 'Decision: use polling for integration bridge health.',
    });
    const newDecision = store.addEvent({
      sessionId: 'conflict-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Decision: replace polling with event stream for bridge health',
      content: 'Replace polling with event stream for integration bridge health diagnostics.',
    });

    extraction.extractPostTurn({ sessionId: 'conflict-1', projectName: 'Argus', events: [oldDecision] });
    const result = extraction.extractPostTurn({ sessionId: 'conflict-1', projectName: 'Argus', events: [newDecision] });
    const allAtoms = store.listAtoms({ sessionId: 'conflict-1', status: '', limit: 20 });
    const retrieval = await createBrainHybridRetrievalService({ store, vectorAdapter: null }).retrieve({
      query: 'bridge health polling',
      sessionId: 'conflict-1',
      projectName: 'Argus',
    });

    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ previousStatus: 'active', newStatus: 'superseded' }),
    ]));
    expect(allAtoms.find((atom) => atom.title.includes('use polling'))?.status).toBe('superseded');
    expect(retrieval.hits.map((hit) => hit.title).join('\n')).not.toContain('use polling');
    expect(retrieval.hits[0].title).toContain('replace polling');
  });

  it('learns lessons from failed verification followed by successful fixes and recalls them later', async () => {
    const { store } = createMemoryBrainStore();
    const extraction = createBrainPostTurnExtractionService({ store });
    const failed = store.addEvent({
      sessionId: 'lesson-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Vitest failed on rollback route',
      content: 'vitest failed because rollback route leaked raw evidence into prompt.',
    });
    const fixed = store.addEvent({
      sessionId: 'lesson-1',
      projectName: 'Argus',
      eventType: 'tool_result',
      title: 'Fixed rollback route raw evidence leak',
      content: 'Fixed by keeping raw evidence behind node drill-down. vitest passed.',
    });

    const result = extraction.extractPostTurn({
      sessionId: 'lesson-1',
      projectName: 'Argus',
      events: [failed, fixed],
    });
    const lesson = result.extractedAtoms.find((atom) => atom.atomType === 'lesson');
    const retrieval = await createBrainHybridRetrievalService({ store, vectorAdapter: null }).retrieve({
      query: 'future vitest failed raw evidence prompt leak rollback',
      sessionId: 'lesson-1',
      projectName: 'Argus',
    });

    expect(lesson?.summary).toContain('raw evidence');
    expect(retrieval.hits[0]).toMatchObject({ id: lesson.id, kind: 'atom' });
  });

  it('returns a non-blocking failure result when storage extraction throws', () => {
    const warnings = [];
    const extraction = createBrainPostTurnExtractionService({
      store: {
        listRefs() {
          throw new Error('database locked');
        },
      },
      logger: { warn: (...args) => warnings.push(args.join(' ')) },
    });

    const result = extraction.extractPostTurn({
      sessionId: 'failure-1',
      projectName: 'Argus',
      events: [{ id: 'event-1', eventType: 'tool_result', title: 'Decision: keep going' }],
    });

    expect(result).toMatchObject({
      extractedAtoms: [],
      failed: true,
      blocking: false,
      error: 'database locked',
    });
    expect(warnings.join('\n')).toContain('database locked');
  });
});
