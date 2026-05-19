import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ARTIFACTS_TABLE_SQL,
  ARTIFACT_LINKS_TABLE_SQL,
  SESSION_CHECKPOINTS_TABLE_SQL,
  SWARM_EVENTS_TABLE_SQL,
  SWARM_RUNS_TABLE_SQL,
} from '../../database/schema.js';
import { createSessionTimelineService } from '../session-timeline-service.js';

describe('session timeline service', () => {
  const dbs = [];

  afterEach(() => {
    while (dbs.length) dbs.pop().close();
  });

  function createDb() {
    const db = new Database(':memory:');
    dbs.push(db);
    db.exec(`
      ${SESSION_CHECKPOINTS_TABLE_SQL}
      ${ARTIFACTS_TABLE_SQL}
      ${ARTIFACT_LINKS_TABLE_SQL}
      ${SWARM_RUNS_TABLE_SQL}
      ${SWARM_EVENTS_TABLE_SQL}
    `);
    return db;
  }

  it('aggregates checkpoints, artifacts, subagents, and redacts nested secrets', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO session_checkpoints (
        id, session_id, provider, project_name, files_json, tool_calls_json,
        profile_kind, permission_preset, permission_mode, rollback_status,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'checkpoint-1',
      'session-1',
      'claude',
      'App',
      JSON.stringify([{ path: 'src/a.ts', status: ' M' }]),
      JSON.stringify([{ kind: 'permission_request', toolName: 'Bash', apiToken: 'secret-token' }]),
      'build',
      'auto-edit',
      'acceptEdits',
      'available',
      '2026-05-18T01:00:00.000Z',
      '2026-05-18T01:01:00.000Z',
    );
    db.prepare(`
      INSERT INTO artifacts (id, kind, title, project_name, session_id, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'artifact-1',
      'review-flow',
      'Review Flow',
      'App',
      'session-1',
      '# Review',
      JSON.stringify({ source: 'review-flow', secretKey: 'abc' }),
      '2026-05-18T01:02:00.000Z',
    );
    db.prepare(`
      INSERT INTO swarm_runs (id, template_id, status, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run('run-1', 'review-swarm', 'running', Date.parse('2026-05-18T01:03:00.000Z'), Date.parse('2026-05-18T01:03:00.000Z'));
    db.prepare(`
      INSERT INTO swarm_events (id, run_id, agent_id, message_id, type, payload_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'swarm-event-1',
      'run-1',
      'agent-1',
      'message-1',
      'subagent_started',
      JSON.stringify({ sessionId: 'session-1', promptText: 'do private thing' }),
      Date.parse('2026-05-18T01:03:00.000Z'),
    );

    const timeline = createSessionTimelineService({ db }).buildTimeline({
      sessionId: 'session-1',
      provider: 'claude',
      projectName: 'App',
    });

    expect(timeline.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'checkpoint',
      'permission_blocked',
      'artifact',
      'subagent',
    ]));
    expect(timeline.events.find((event) => event.type === 'permission_blocked').payload.apiToken).toBe('[redacted]');
    expect(timeline.events.find((event) => event.type === 'artifact').payload.metadata.secretKey).toBe('[redacted]');
    expect(timeline.events.find((event) => event.type === 'subagent').payload.payload.promptText).toBe('[redacted]');
  });
});
