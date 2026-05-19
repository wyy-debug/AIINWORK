import crypto from 'node:crypto';

import { db as defaultDb } from '../database/db.js';

const nowMs = () => Date.now();
const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const readString = (value) => (typeof value === 'string' ? value.trim() : '');

const safeJson = (value, fallback = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const mapSession = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  projectPath: row.project_path || '',
  modelProfileId: row.model_profile_id || '',
  status: row.status || 'active',
  eventCount: Number(row.event_count || 0),
  latestCompactionId: row.latest_compaction_id || '',
  createdAtMs: Number(row.created_at_ms || 0),
  updatedAtMs: Number(row.updated_at_ms || 0),
});

const mapEvent = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  checkpointId: row.checkpoint_id || '',
  artifactId: row.artifact_id || '',
  eventType: row.event_type,
  role: row.role || '',
  title: row.title || '',
  content: row.content || '',
  payload: parseJson(row.payload_json, {}),
  createdAtMs: Number(row.created_at_ms || 0),
});

const mapRef = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  eventId: row.event_id || '',
  checkpointId: row.checkpoint_id || '',
  artifactId: row.artifact_id || '',
  refType: row.ref_type,
  refId: row.ref_id || '',
  label: row.label || '',
  content: row.content || '',
  metadata: parseJson(row.metadata_json, {}),
  sizeBytes: Number(row.size_bytes || 0),
  createdAtMs: Number(row.created_at_ms || 0),
  prunedAtMs: row.pruned_at_ms ? Number(row.pruned_at_ms) : null,
});

const mapNode = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  nodeType: row.node_type,
  title: row.title,
  summary: row.summary || '',
  status: row.status || 'active',
  confidence: Number(row.confidence || 1),
  sourceEventIds: parseJson(row.source_event_ids_json, []),
  refIds: parseJson(row.ref_ids_json, []),
  createdAtMs: Number(row.created_at_ms || 0),
  updatedAtMs: Number(row.updated_at_ms || 0),
});

const mapCompaction = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  mermaid: row.mermaid || '',
  summary: row.summary || '',
  currentGoal: row.current_goal || '',
  completedSteps: parseJson(row.completed_steps_json, []),
  activeDecisions: parseJson(row.active_decisions_json, []),
  openRisks: parseJson(row.open_risks_json, []),
  nextAction: row.next_action || '',
  sourceEventStartId: row.source_event_start_id || '',
  sourceEventEndId: row.source_event_end_id || '',
  sourceEventCount: Number(row.source_event_count || 0),
  tokenEstimate: Number(row.token_estimate || 0),
  refs: parseJson(row.refs_json, []),
  createdAtMs: Number(row.created_at_ms || 0),
});

const mapAtom = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  atomType: row.atom_type,
  title: row.title,
  summary: row.summary || '',
  status: row.status || 'active',
  stableKey: row.stable_key,
  confidence: Number(row.confidence || 1),
  pinned: Boolean(row.pinned),
  supersededById: row.superseded_by_id || '',
  conflictReason: row.conflict_reason || '',
  entities: parseJson(row.entities_json, []),
  sourceEventIds: parseJson(row.source_event_ids_json, []),
  refIds: parseJson(row.ref_ids_json, []),
  createdAtMs: Number(row.created_at_ms || 0),
  updatedAtMs: Number(row.updated_at_ms || 0),
});

const mapScenario = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  scenarioKey: row.scenario_key,
  title: row.title,
  summary: row.summary || '',
  status: row.status || 'active',
  atomIds: parseJson(row.atom_ids_json, []),
  metrics: parseJson(row.metrics_json, {}),
  createdAtMs: Number(row.created_at_ms || 0),
  updatedAtMs: Number(row.updated_at_ms || 0),
});

const mapProjectProfile = (row) => row && ({
  id: row.id,
  projectName: row.project_name || '',
  provider: row.provider || 'claude',
  profileType: row.profile_type || 'working-memory',
  summary: row.summary || '',
  content: parseJson(row.content_json, {}),
  sourceAtomIds: parseJson(row.source_atom_ids_json, []),
  createdAtMs: Number(row.created_at_ms || 0),
  updatedAtMs: Number(row.updated_at_ms || 0),
});

const mapRetrievalRun = (row) => row && ({
  id: row.id,
  sessionId: row.session_id || '',
  provider: row.provider || 'claude',
  projectName: row.project_name || '',
  query: row.query || '',
  mode: row.mode || 'hybrid',
  hitCount: Number(row.hit_count || 0),
  hits: parseJson(row.hits_json, []),
  metrics: parseJson(row.metrics_json, {}),
  createdAtMs: Number(row.created_at_ms || 0),
});

export function createBrainStore({ db = defaultDb } = {}) {
  const ensureSession = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    projectPath = '',
    modelProfileId = '',
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return null;
    }
    const timestamp = nowMs();
    const existing = db.prepare(
      'SELECT * FROM brain_sessions WHERE session_id = ? AND provider = ?',
    ).get(cleanSessionId, provider || 'claude');
    if (existing) {
      db.prepare(`
        UPDATE brain_sessions
        SET project_name = COALESCE(?, project_name),
            project_path = COALESCE(?, project_path),
            model_profile_id = COALESCE(?, model_profile_id),
            updated_at_ms = ?
        WHERE id = ?
      `).run(projectName || null, projectPath || null, modelProfileId || null, timestamp, existing.id);
      return mapSession(db.prepare('SELECT * FROM brain_sessions WHERE id = ?').get(existing.id));
    }
    const id = createId('brain_session');
    db.prepare(`
      INSERT INTO brain_sessions (
        id, session_id, provider, project_name, project_path, model_profile_id,
        created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      projectPath || null,
      modelProfileId || null,
      timestamp,
      timestamp,
    );
    return mapSession(db.prepare('SELECT * FROM brain_sessions WHERE id = ?').get(id));
  };

  const addEvent = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    projectPath = '',
    modelProfileId = '',
    checkpointId = '',
    artifactId = '',
    eventType = 'event',
    role = '',
    title = '',
    content = '',
    payload = {},
    refs = [],
    createdAtMs = nowMs(),
  } = {}) => {
    const session = ensureSession({ sessionId, provider, projectName, projectPath, modelProfileId });
    if (!session) {
      return null;
    }
    const id = createId('brain_event');
    const cleanContent = readString(content);
    db.prepare(`
      INSERT INTO brain_events (
        id, session_id, provider, project_name, checkpoint_id, artifact_id,
        event_type, role, title, content, payload_json, created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      session.sessionId,
      session.provider,
      projectName || session.projectName || null,
      checkpointId || null,
      artifactId || null,
      eventType,
      role || null,
      title || null,
      cleanContent || null,
      safeJson(payload),
      createdAtMs,
    );
    db.prepare(`
      UPDATE brain_sessions
      SET event_count = event_count + 1, updated_at_ms = ?
      WHERE session_id = ? AND provider = ?
    `).run(createdAtMs, session.sessionId, session.provider);

    const eventRefs = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const created = addRef({
        ...ref,
        sessionId: session.sessionId,
        provider: session.provider,
        projectName: projectName || session.projectName,
        checkpointId: checkpointId || ref.checkpointId || '',
        artifactId: artifactId || ref.artifactId || '',
        eventId: id,
        createdAtMs,
      });
      if (created) {
        eventRefs.push(created);
      }
    }
    return {
      ...mapEvent(db.prepare('SELECT * FROM brain_events WHERE id = ?').get(id)),
      refs: eventRefs,
    };
  };

  const addRef = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    eventId = '',
    checkpointId = '',
    artifactId = '',
    refType = 'raw',
    refId = '',
    label = '',
    content = '',
    metadata = {},
    createdAtMs = nowMs(),
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return null;
    }
    const id = createId('brain_ref');
    const cleanContent = typeof content === 'string' ? content : '';
    db.prepare(`
      INSERT INTO brain_refs (
        id, session_id, provider, project_name, event_id, checkpoint_id, artifact_id,
        ref_type, ref_id, label, content, metadata_json, size_bytes, created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      eventId || null,
      checkpointId || null,
      artifactId || null,
      refType || 'raw',
      refId || null,
      label || null,
      cleanContent || null,
      safeJson(metadata),
      Buffer.byteLength(cleanContent, 'utf8'),
      createdAtMs,
    );
    return mapRef(db.prepare('SELECT * FROM brain_refs WHERE id = ?').get(id));
  };

  const upsertNode = ({
    id,
    sessionId = '',
    provider = 'claude',
    projectName = '',
    nodeType = 'step',
    title = '',
    summary = '',
    status = 'active',
    confidence = 1,
    sourceEventIds = [],
    refIds = [],
    createdAtMs = nowMs(),
    updatedAtMs = nowMs(),
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    const cleanTitle = readString(title);
    if (!cleanSessionId || !cleanTitle) {
      return null;
    }
    const nodeId = id || createId('brain_node');
    db.prepare(`
      INSERT INTO brain_nodes (
        id, session_id, provider, project_name, node_type, title, summary, status,
        confidence, source_event_ids_json, ref_ids_json, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_name = excluded.project_name,
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        confidence = excluded.confidence,
        source_event_ids_json = excluded.source_event_ids_json,
        ref_ids_json = excluded.ref_ids_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      nodeId,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      nodeType || 'step',
      cleanTitle,
      summary || null,
      status || 'active',
      Number.isFinite(Number(confidence)) ? Number(confidence) : 1,
      safeJson(Array.isArray(sourceEventIds) ? sourceEventIds : []),
      safeJson(Array.isArray(refIds) ? refIds : []),
      createdAtMs,
      updatedAtMs,
    );
    return mapNode(db.prepare('SELECT * FROM brain_nodes WHERE id = ?').get(nodeId));
  };

  const addCompaction = ({
    id = createId('brain_compaction'),
    sessionId = '',
    provider = 'claude',
    projectName = '',
    mermaid = '',
    summary = '',
    currentGoal = '',
    completedSteps = [],
    activeDecisions = [],
    openRisks = [],
    nextAction = '',
    sourceEventStartId = '',
    sourceEventEndId = '',
    sourceEventCount = 0,
    tokenEstimate = 0,
    refs = [],
    createdAtMs = nowMs(),
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return null;
    }
    db.prepare(`
      INSERT INTO brain_compactions (
        id, session_id, provider, project_name, mermaid, summary, current_goal,
        completed_steps_json, active_decisions_json, open_risks_json, next_action,
        source_event_start_id, source_event_end_id, source_event_count,
        token_estimate, refs_json, created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      mermaid || null,
      summary || null,
      currentGoal || null,
      safeJson(completedSteps, []),
      safeJson(activeDecisions, []),
      safeJson(openRisks, []),
      nextAction || null,
      sourceEventStartId || null,
      sourceEventEndId || null,
      Number(sourceEventCount) || 0,
      Number(tokenEstimate) || 0,
      safeJson(refs, []),
      createdAtMs,
    );
    db.prepare(`
      UPDATE brain_sessions
      SET latest_compaction_id = ?, updated_at_ms = ?
      WHERE session_id = ? AND provider = ?
    `).run(id, createdAtMs, cleanSessionId, provider || 'claude');
    return mapCompaction(db.prepare('SELECT * FROM brain_compactions WHERE id = ?').get(id));
  };

  const listEvents = ({ sessionId = '', provider = 'claude', afterMs = 0, limit = 200 } = {}) => {
    const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    return db.prepare(`
      SELECT * FROM brain_events
      WHERE session_id = ? AND provider = ? AND created_at_ms >= ?
      ORDER BY created_at_ms ASC
      LIMIT ?
    `).all(sessionId, provider || 'claude', Number(afterMs) || 0, cappedLimit).map(mapEvent);
  };

  const listRefs = ({ sessionId = '', provider = 'claude', projectName = '', includePruned = false, limit = 500 } = {}) => {
    const clauses = ['provider = ?'];
    const params = [provider || 'claude'];
    if (readString(sessionId)) {
      clauses.push('session_id = ?');
      params.push(sessionId);
    }
    if (readString(projectName)) {
      clauses.push('project_name = ?');
      params.push(projectName);
    }
    if (!includePruned) {
      clauses.push('pruned_at_ms IS NULL');
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    return db.prepare(`
      SELECT id, session_id, provider, project_name, event_id, checkpoint_id,
             artifact_id, ref_type, ref_id, label, content,
             metadata_json, size_bytes, created_at_ms, pruned_at_ms
      FROM brain_refs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at_ms ASC
      LIMIT ?
    `).all(...params, cappedLimit).map(mapRef);
  };

  const listProjectNodes = ({ projectName = '', provider = 'claude', types = [], limit = 20 } = {}) => {
    if (!readString(projectName)) {
      return [];
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const allowedTypes = Array.isArray(types) ? types.filter(Boolean) : [];
    const rows = allowedTypes.length
      ? db.prepare(`
          SELECT * FROM brain_nodes
          WHERE project_name = ? AND provider = ? AND status = 'active'
            AND node_type IN (${allowedTypes.map(() => '?').join(',')})
          ORDER BY updated_at_ms DESC
          LIMIT ?
        `).all(projectName, provider || 'claude', ...allowedTypes, cappedLimit)
      : db.prepare(`
          SELECT * FROM brain_nodes
          WHERE project_name = ? AND provider = ? AND status = 'active'
          ORDER BY updated_at_ms DESC
          LIMIT ?
        `).all(projectName, provider || 'claude', cappedLimit);
    return rows.map(mapNode);
  };

  const upsertAtom = ({
    id,
    sessionId = '',
    provider = 'claude',
    projectName = '',
    atomType = 'step',
    title = '',
    summary = '',
    status = 'active',
    stableKey = '',
    confidence = 1,
    pinned = false,
    supersededById = '',
    conflictReason = '',
    entities = [],
    sourceEventIds = [],
    refIds = [],
    createdAtMs = nowMs(),
    updatedAtMs = nowMs(),
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    const cleanTitle = readString(title);
    const cleanStableKey = readString(stableKey) || `${atomType}:${cleanTitle.toLowerCase()}`;
    if (!cleanSessionId || !cleanTitle || !cleanStableKey) {
      return null;
    }
    const atomId = id || createId('brain_atom');
    db.prepare(`
      INSERT INTO brain_atoms (
        id, session_id, provider, project_name, atom_type, title, summary, status,
        stable_key, confidence, pinned, superseded_by_id, conflict_reason,
        entities_json, source_event_ids_json, ref_ids_json, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider, stable_key) DO UPDATE SET
        project_name = excluded.project_name,
        atom_type = excluded.atom_type,
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        confidence = MAX(brain_atoms.confidence, excluded.confidence),
        pinned = excluded.pinned,
        superseded_by_id = excluded.superseded_by_id,
        conflict_reason = excluded.conflict_reason,
        entities_json = excluded.entities_json,
        source_event_ids_json = excluded.source_event_ids_json,
        ref_ids_json = excluded.ref_ids_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      atomId,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      atomType || 'step',
      cleanTitle,
      summary || null,
      status || 'active',
      cleanStableKey,
      Number.isFinite(Number(confidence)) ? Number(confidence) : 1,
      pinned ? 1 : 0,
      supersededById || null,
      conflictReason || null,
      safeJson(Array.isArray(entities) ? entities : []),
      safeJson(Array.isArray(sourceEventIds) ? sourceEventIds : []),
      safeJson(Array.isArray(refIds) ? refIds : []),
      createdAtMs,
      updatedAtMs,
    );
    return mapAtom(db.prepare(`
      SELECT * FROM brain_atoms
      WHERE session_id = ? AND provider = ? AND stable_key = ?
      LIMIT 1
    `).get(cleanSessionId, provider || 'claude', cleanStableKey));
  };

  const getAtom = ({ atomId = '' } = {}) => (
    mapAtom(db.prepare('SELECT * FROM brain_atoms WHERE id = ?').get(atomId))
  );

  const updateAtom = ({
    atomId = '',
    status,
    pinned,
    supersededById,
    conflictReason,
    sourceEventIds,
    refIds,
    updatedAtMs = nowMs(),
  } = {}) => {
    const existing = getAtom({ atomId });
    if (!existing) {
      return null;
    }
    const nextStatus = readString(status) || existing.status;
    const nextPinned = typeof pinned === 'boolean' ? pinned : existing.pinned;
    const nextSupersededById = typeof supersededById === 'string' ? supersededById : existing.supersededById;
    const nextConflictReason = typeof conflictReason === 'string' ? conflictReason : existing.conflictReason;
    const nextSourceEventIds = Array.isArray(sourceEventIds) ? sourceEventIds : existing.sourceEventIds;
    const nextRefIds = Array.isArray(refIds) ? refIds : existing.refIds;
    db.prepare(`
      UPDATE brain_atoms
      SET status = ?,
          pinned = ?,
          superseded_by_id = ?,
          conflict_reason = ?,
          source_event_ids_json = ?,
          ref_ids_json = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(
      nextStatus,
      nextPinned ? 1 : 0,
      nextSupersededById || null,
      nextConflictReason || null,
      safeJson(nextSourceEventIds, []),
      safeJson(nextRefIds, []),
      updatedAtMs,
      atomId,
    );
    return getAtom({ atomId });
  };

  const listAtoms = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    types = [],
    status = 'active',
    limit = 80,
  } = {}) => {
    const clauses = ['provider = ?'];
    const params = [provider || 'claude'];
    if (readString(sessionId)) {
      clauses.push('session_id = ?');
      params.push(sessionId);
    }
    if (readString(projectName)) {
      clauses.push('project_name = ?');
      params.push(projectName);
    }
    if (readString(status)) {
      clauses.push('status = ?');
      params.push(status);
    }
    const allowedTypes = Array.isArray(types) ? types.filter(Boolean) : [];
    if (allowedTypes.length > 0) {
      clauses.push(`atom_type IN (${allowedTypes.map(() => '?').join(',')})`);
      params.push(...allowedTypes);
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 80, 1), 500);
    return db.prepare(`
      SELECT * FROM brain_atoms
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at_ms DESC
      LIMIT ?
    `).all(...params, cappedLimit).map(mapAtom);
  };

  const upsertScenario = ({
    id,
    sessionId = '',
    provider = 'claude',
    projectName = '',
    scenarioKey = '',
    title = '',
    summary = '',
    status = 'active',
    atomIds = [],
    metrics = {},
    createdAtMs = nowMs(),
    updatedAtMs = nowMs(),
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    const cleanScenarioKey = readString(scenarioKey);
    const cleanTitle = readString(title);
    if (!cleanSessionId || !cleanScenarioKey || !cleanTitle) {
      return null;
    }
    const scenarioId = id || createId('brain_scenario');
    db.prepare(`
      INSERT INTO brain_scenarios (
        id, session_id, provider, project_name, scenario_key, title, summary, status,
        atom_ids_json, metrics_json, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider, scenario_key) DO UPDATE SET
        project_name = excluded.project_name,
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        atom_ids_json = excluded.atom_ids_json,
        metrics_json = excluded.metrics_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      scenarioId,
      cleanSessionId,
      provider || 'claude',
      projectName || null,
      cleanScenarioKey,
      cleanTitle,
      summary || null,
      status || 'active',
      safeJson(Array.isArray(atomIds) ? atomIds : []),
      safeJson(metrics || {}),
      createdAtMs,
      updatedAtMs,
    );
    return mapScenario(db.prepare(`
      SELECT * FROM brain_scenarios
      WHERE session_id = ? AND provider = ? AND scenario_key = ?
      LIMIT 1
    `).get(cleanSessionId, provider || 'claude', cleanScenarioKey));
  };

  const listScenarios = ({ sessionId = '', provider = 'claude', projectName = '', limit = 20 } = {}) => {
    const clauses = ['provider = ?'];
    const params = [provider || 'claude'];
    if (readString(sessionId)) {
      clauses.push('session_id = ?');
      params.push(sessionId);
    }
    if (readString(projectName)) {
      clauses.push('project_name = ?');
      params.push(projectName);
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return db.prepare(`
      SELECT * FROM brain_scenarios
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at_ms DESC
      LIMIT ?
    `).all(...params, cappedLimit).map(mapScenario);
  };

  const upsertProjectProfile = ({
    id,
    provider = 'claude',
    projectName = '',
    profileType = 'working-memory',
    summary = '',
    content = {},
    sourceAtomIds = [],
    createdAtMs = nowMs(),
    updatedAtMs = nowMs(),
  } = {}) => {
    const cleanProjectName = readString(projectName);
    if (!cleanProjectName) {
      return null;
    }
    const profileId = id || createId('brain_profile');
    db.prepare(`
      INSERT INTO brain_project_profiles (
        id, project_name, provider, profile_type, summary, content_json,
        source_atom_ids_json, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_name, provider, profile_type) DO UPDATE SET
        summary = excluded.summary,
        content_json = excluded.content_json,
        source_atom_ids_json = excluded.source_atom_ids_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      profileId,
      cleanProjectName,
      provider || 'claude',
      profileType || 'working-memory',
      summary || null,
      safeJson(content || {}),
      safeJson(Array.isArray(sourceAtomIds) ? sourceAtomIds : []),
      createdAtMs,
      updatedAtMs,
    );
    return mapProjectProfile(db.prepare(`
      SELECT * FROM brain_project_profiles
      WHERE project_name = ? AND provider = ? AND profile_type = ?
      LIMIT 1
    `).get(cleanProjectName, provider || 'claude', profileType || 'working-memory'));
  };

  const getProjectProfile = ({ provider = 'claude', projectName = '', profileType = 'working-memory' } = {}) => (
    mapProjectProfile(db.prepare(`
      SELECT * FROM brain_project_profiles
      WHERE project_name = ? AND provider = ? AND profile_type = ?
      LIMIT 1
    `).get(projectName, provider || 'claude', profileType || 'working-memory'))
  );

  const addRetrievalRun = ({
    id = createId('brain_retrieval'),
    sessionId = '',
    provider = 'claude',
    projectName = '',
    query = '',
    mode = 'hybrid',
    hits = [],
    metrics = {},
    createdAtMs = nowMs(),
  } = {}) => {
    db.prepare(`
      INSERT INTO brain_retrieval_runs (
        id, session_id, provider, project_name, query, mode, hit_count,
        hits_json, metrics_json, created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId || null,
      provider || 'claude',
      projectName || null,
      query || null,
      mode || 'hybrid',
      Array.isArray(hits) ? hits.length : 0,
      safeJson(Array.isArray(hits) ? hits : []),
      safeJson(metrics || {}),
      createdAtMs,
    );
    return mapRetrievalRun(db.prepare('SELECT * FROM brain_retrieval_runs WHERE id = ?').get(id));
  };

  const listRetrievalRuns = ({ sessionId = '', provider = 'claude', projectName = '', limit = 20 } = {}) => {
    const clauses = ['provider = ?'];
    const params = [provider || 'claude'];
    if (readString(sessionId)) {
      clauses.push('session_id = ?');
      params.push(sessionId);
    }
    if (readString(projectName)) {
      clauses.push('project_name = ?');
      params.push(projectName);
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return db.prepare(`
      SELECT * FROM brain_retrieval_runs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(...params, cappedLimit).map(mapRetrievalRun);
  };

  const getLatestCompaction = ({ sessionId = '', provider = 'claude' } = {}) => (
    mapCompaction(db.prepare(`
      SELECT * FROM brain_compactions
      WHERE session_id = ? AND provider = ?
      ORDER BY created_at_ms DESC
      LIMIT 1
    `).get(sessionId, provider || 'claude'))
  );

  const getNodeDetail = ({
    nodeId = '',
    sessionId = '',
    provider = 'claude',
    includeRefContent = false,
  } = {}) => {
    const node = mapNode(db.prepare('SELECT * FROM brain_nodes WHERE id = ?').get(nodeId));
    if (!node || (sessionId && node.sessionId !== sessionId) || (provider && node.provider !== provider)) {
      return null;
    }
    const eventIds = Array.isArray(node.sourceEventIds) ? node.sourceEventIds : [];
    const refIds = Array.isArray(node.refIds) ? node.refIds : [];
    const events = eventIds.length
      ? db.prepare(`SELECT * FROM brain_events WHERE id IN (${eventIds.map(() => '?').join(',')}) ORDER BY created_at_ms ASC`)
        .all(...eventIds).map(mapEvent)
      : [];
    const contentColumn = includeRefContent ? 'content' : 'NULL AS content';
    const refs = refIds.length
      ? db.prepare(`
          SELECT id, session_id, provider, project_name, event_id, checkpoint_id,
                 artifact_id, ref_type, ref_id, label, ${contentColumn},
                 metadata_json, size_bytes, created_at_ms, pruned_at_ms
          FROM brain_refs
          WHERE id IN (${refIds.map(() => '?').join(',')})
          ORDER BY created_at_ms ASC
        `).all(...refIds).map(mapRef)
      : [];
    const atoms = db.prepare(`
      SELECT * FROM brain_atoms
      WHERE session_id = ? AND provider = ? AND status = 'active'
      ORDER BY updated_at_ms DESC
      LIMIT 20
    `).all(node.sessionId, node.provider).map(mapAtom)
      .filter((atom) => (
        atom.sourceEventIds.some((eventId) => eventIds.includes(eventId))
        || atom.refIds.some((refId) => refIds.includes(refId))
      ));
    return { node, events, refs, atoms };
  };

  const getDiagnostics = ({ sessionId = '', provider = 'claude', projectName = '' } = {}) => {
    const session = sessionId
      ? mapSession(db.prepare('SELECT * FROM brain_sessions WHERE session_id = ? AND provider = ?').get(sessionId, provider || 'claude'))
      : null;
    const latestCompaction = session ? getLatestCompaction({ sessionId, provider }) : null;
    const nodes = session
      ? db.prepare(`
          SELECT * FROM brain_nodes
          WHERE session_id = ? AND provider = ? AND status != 'archived'
          ORDER BY updated_at_ms DESC
          LIMIT 40
        `).all(sessionId, provider || 'claude').map(mapNode)
      : [];
    const refs = session
      ? db.prepare(`
          SELECT id, session_id, provider, project_name, event_id, checkpoint_id,
                 artifact_id, ref_type, ref_id, label, NULL AS content,
                 metadata_json, size_bytes, created_at_ms, pruned_at_ms
          FROM brain_refs
          WHERE session_id = ? AND provider = ? AND pruned_at_ms IS NULL
          ORDER BY created_at_ms DESC
          LIMIT 30
        `).all(sessionId, provider || 'claude').map(mapRef)
      : [];
    const atoms = session
      ? listAtoms({ sessionId, provider, limit: 40 })
      : [];
    const scenarios = session
      ? listScenarios({ sessionId, provider, limit: 12 })
      : [];
    const effectiveProjectName = projectName || session?.projectName || '';
    const projectProfile = effectiveProjectName
      ? getProjectProfile({ projectName: effectiveProjectName, provider })
      : null;
    const retrievalRuns = listRetrievalRuns({
      sessionId,
      provider,
      projectName: effectiveProjectName,
      limit: 8,
    });
    const compactedEventCount = latestCompaction?.sourceEventCount || 0;
    const totalContentBytes = session
      ? db.prepare(`
          SELECT COALESCE(SUM(size_bytes), 0) AS total
          FROM brain_refs
          WHERE session_id = ? AND provider = ? AND pruned_at_ms IS NULL
        `).get(sessionId, provider || 'claude')?.total || 0
      : 0;
    return {
      enabled: true,
      session,
      projectName: projectName || session?.projectName || '',
      latestCompaction,
      nodes,
      refs,
      atoms,
      scenarios,
      projectProfile,
      retrievalRuns,
      compactedEventCount,
      tokenReductionEstimate: latestCompaction
        ? Math.max(0, Math.round((totalContentBytes / 4) - latestCompaction.tokenEstimate))
        : 0,
    };
  };

  const inspectSession = ({ sessionId = '', provider = 'claude', projectName = '' } = {}) => {
    const diagnostics = getDiagnostics({ sessionId, provider, projectName });
    const recentEvents = sessionId
      ? listEvents({ sessionId, provider, limit: 80 }).slice(-40)
      : [];
    return {
      ...diagnostics,
      recentEvents,
      layers: {
        l0Events: recentEvents.length,
        l1Atoms: diagnostics.atoms?.length || 0,
        l2Scenarios: diagnostics.scenarios?.length || 0,
        l3ProjectProfile: Boolean(diagnostics.projectProfile),
      },
    };
  };

  const previewRetention = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    perSessionMaxEvents = 1000,
    perProjectMaxCompactions = 80,
    rawRefsMaxSizeBytes = 5_000_000,
  } = {}) => {
    const eventCount = sessionId
      ? db.prepare('SELECT COUNT(*) AS count FROM brain_events WHERE session_id = ? AND provider = ?')
        .get(sessionId, provider || 'claude')?.count || 0
      : 0;
    const rawBytes = sessionId
      ? db.prepare(`
          SELECT COALESCE(SUM(size_bytes), 0) AS total FROM brain_refs
          WHERE session_id = ? AND provider = ? AND pruned_at_ms IS NULL
        `).get(sessionId, provider || 'claude')?.total || 0
      : 0;
    const compactionCount = projectName
      ? db.prepare('SELECT COUNT(*) AS count FROM brain_compactions WHERE project_name = ?')
        .get(projectName)?.count || 0
      : 0;
    return {
      sessionId,
      provider,
      projectName,
      eventCount,
      rawBytes,
      compactionCount,
      wouldPruneEvents: Math.max(0, Number(eventCount) - Math.max(Number(perSessionMaxEvents) || 1000, 1)),
      wouldPruneRawBytes: Math.max(0, Number(rawBytes) - Math.max(Number(rawRefsMaxSizeBytes) || 5_000_000, 1)),
      wouldPruneCompactions: Math.max(0, Number(compactionCount) - Math.max(Number(perProjectMaxCompactions) || 80, 1)),
    };
  };

  const exportSession = ({ sessionId = '', provider = 'claude' } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return null;
    }
    return {
      version: 1,
      exportedAtMs: nowMs(),
      provider: provider || 'claude',
      session: mapSession(db.prepare('SELECT * FROM brain_sessions WHERE session_id = ? AND provider = ?').get(cleanSessionId, provider || 'claude')),
      events: db.prepare('SELECT * FROM brain_events WHERE session_id = ? AND provider = ? ORDER BY created_at_ms ASC')
        .all(cleanSessionId, provider || 'claude').map(mapEvent),
      refs: db.prepare('SELECT * FROM brain_refs WHERE session_id = ? AND provider = ? ORDER BY created_at_ms ASC')
        .all(cleanSessionId, provider || 'claude').map(mapRef),
      nodes: db.prepare('SELECT * FROM brain_nodes WHERE session_id = ? AND provider = ? ORDER BY updated_at_ms ASC')
        .all(cleanSessionId, provider || 'claude').map(mapNode),
      compactions: db.prepare('SELECT * FROM brain_compactions WHERE session_id = ? AND provider = ? ORDER BY created_at_ms ASC')
        .all(cleanSessionId, provider || 'claude').map(mapCompaction),
      atoms: listAtoms({ sessionId: cleanSessionId, provider, status: '', limit: 500 }),
      scenarios: listScenarios({ sessionId: cleanSessionId, provider, limit: 200 }),
      retrievalRuns: listRetrievalRuns({ sessionId: cleanSessionId, provider, limit: 200 }),
    };
  };

  const repairSession = ({ sessionId = '', provider = 'claude' } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return { repaired: false, deletedDanglingRefs: 0, updatedSessions: 0 };
    }
    const deletedDanglingRefs = db.prepare(`
      DELETE FROM brain_refs
      WHERE session_id = ? AND provider = ? AND event_id IS NOT NULL
        AND event_id NOT IN (SELECT id FROM brain_events WHERE session_id = ? AND provider = ?)
    `).run(cleanSessionId, provider || 'claude', cleanSessionId, provider || 'claude').changes;
    const eventCount = db.prepare('SELECT COUNT(*) AS count FROM brain_events WHERE session_id = ? AND provider = ?')
      .get(cleanSessionId, provider || 'claude')?.count || 0;
    const latestCompaction = getLatestCompaction({ sessionId: cleanSessionId, provider });
    const updatedSessions = db.prepare(`
      UPDATE brain_sessions
      SET event_count = ?, latest_compaction_id = ?, updated_at_ms = ?
      WHERE session_id = ? AND provider = ?
    `).run(Number(eventCount), latestCompaction?.id || null, nowMs(), cleanSessionId, provider || 'claude').changes;
    return {
      repaired: true,
      deletedDanglingRefs,
      updatedSessions,
      eventCount: Number(eventCount),
      latestCompactionId: latestCompaction?.id || '',
    };
  };

  const importSession = ({ packageData = {}, overwrite = false } = {}) => {
    const data = packageData && typeof packageData === 'object' ? packageData : {};
    const session = data.session;
    if (!session?.sessionId) {
      return { imported: false, reason: 'missing-session' };
    }
    if (overwrite) {
      clearSession({ sessionId: session.sessionId, provider: session.provider || data.provider || 'claude' });
    }
    ensureSession({
      sessionId: session.sessionId,
      provider: session.provider || data.provider || 'claude',
      projectName: session.projectName || '',
      projectPath: session.projectPath || '',
      modelProfileId: session.modelProfileId || '',
    });
    for (const event of Array.isArray(data.events) ? data.events : []) {
      db.prepare(`
        INSERT OR IGNORE INTO brain_events (
          id, session_id, provider, project_name, checkpoint_id, artifact_id,
          event_type, role, title, content, payload_json, created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.sessionId,
        event.provider || 'claude',
        event.projectName || null,
        event.checkpointId || null,
        event.artifactId || null,
        event.eventType || 'event',
        event.role || null,
        event.title || null,
        event.content || null,
        safeJson(event.payload || {}),
        event.createdAtMs || nowMs(),
      );
    }
    for (const ref of Array.isArray(data.refs) ? data.refs : []) {
      db.prepare(`
        INSERT OR IGNORE INTO brain_refs (
          id, session_id, provider, project_name, event_id, checkpoint_id, artifact_id,
          ref_type, ref_id, label, content, metadata_json, size_bytes, created_at_ms,
          pruned_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ref.id,
        ref.sessionId,
        ref.provider || 'claude',
        ref.projectName || null,
        ref.eventId || null,
        ref.checkpointId || null,
        ref.artifactId || null,
        ref.refType || 'raw',
        ref.refId || null,
        ref.label || null,
        ref.content || null,
        safeJson(ref.metadata || {}),
        Number(ref.sizeBytes) || Buffer.byteLength(ref.content || '', 'utf8'),
        ref.createdAtMs || nowMs(),
        ref.prunedAtMs || null,
      );
    }
    for (const node of Array.isArray(data.nodes) ? data.nodes : []) {
      upsertNode(node);
    }
    for (const atom of Array.isArray(data.atoms) ? data.atoms : []) {
      upsertAtom(atom);
    }
    for (const scenario of Array.isArray(data.scenarios) ? data.scenarios : []) {
      upsertScenario(scenario);
    }
    for (const compaction of Array.isArray(data.compactions) ? data.compactions : []) {
      addCompaction(compaction);
    }
    repairSession({ sessionId: session.sessionId, provider: session.provider || data.provider || 'claude' });
    return { imported: true, sessionId: session.sessionId };
  };

  const clearSession = ({ sessionId = '', provider = 'claude' } = {}) => {
    const cleanSessionId = readString(sessionId);
    if (!cleanSessionId) {
      return { deleted: 0 };
    }
    const run = db.transaction(() => {
      const refs = db.prepare('DELETE FROM brain_refs WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const nodes = db.prepare('DELETE FROM brain_nodes WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const compactions = db.prepare('DELETE FROM brain_compactions WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const atoms = db.prepare('DELETE FROM brain_atoms WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const scenarios = db.prepare('DELETE FROM brain_scenarios WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const retrievalRuns = db.prepare('DELETE FROM brain_retrieval_runs WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const events = db.prepare('DELETE FROM brain_events WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      const sessions = db.prepare('DELETE FROM brain_sessions WHERE session_id = ? AND provider = ?').run(cleanSessionId, provider || 'claude').changes;
      return refs + nodes + compactions + atoms + scenarios + retrievalRuns + events + sessions;
    });
    return { deleted: run() };
  };

  const clearProject = ({ projectName = '' } = {}) => {
    const cleanProjectName = readString(projectName);
    if (!cleanProjectName) {
      return { deleted: 0 };
    }
    const run = db.transaction(() => {
      const refs = db.prepare('DELETE FROM brain_refs WHERE project_name = ?').run(cleanProjectName).changes;
      const nodes = db.prepare('DELETE FROM brain_nodes WHERE project_name = ?').run(cleanProjectName).changes;
      const compactions = db.prepare('DELETE FROM brain_compactions WHERE project_name = ?').run(cleanProjectName).changes;
      const atoms = db.prepare('DELETE FROM brain_atoms WHERE project_name = ?').run(cleanProjectName).changes;
      const scenarios = db.prepare('DELETE FROM brain_scenarios WHERE project_name = ?').run(cleanProjectName).changes;
      const profiles = db.prepare('DELETE FROM brain_project_profiles WHERE project_name = ?').run(cleanProjectName).changes;
      const retrievalRuns = db.prepare('DELETE FROM brain_retrieval_runs WHERE project_name = ?').run(cleanProjectName).changes;
      const events = db.prepare('DELETE FROM brain_events WHERE project_name = ?').run(cleanProjectName).changes;
      const sessions = db.prepare('DELETE FROM brain_sessions WHERE project_name = ?').run(cleanProjectName).changes;
      return refs + nodes + compactions + atoms + scenarios + profiles + retrievalRuns + events + sessions;
    });
    return { deleted: run() };
  };

  const migrateSessionId = ({ fromSessionId = '', toSessionId = '', provider = 'claude' } = {}) => {
    const from = readString(fromSessionId);
    const to = readString(toSessionId);
    if (!from || !to || from === to) {
      return { migrated: false };
    }
    const run = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM brain_sessions WHERE session_id = ? AND provider = ?').get(to, provider || 'claude');
      if (existing) {
        db.prepare('DELETE FROM brain_sessions WHERE session_id = ? AND provider = ?').run(from, provider || 'claude');
      } else {
        db.prepare('UPDATE brain_sessions SET session_id = ?, updated_at_ms = ? WHERE session_id = ? AND provider = ?')
          .run(to, nowMs(), from, provider || 'claude');
      }
      for (const table of ['brain_events', 'brain_refs', 'brain_nodes', 'brain_compactions', 'brain_atoms', 'brain_scenarios', 'brain_retrieval_runs']) {
        db.prepare(`UPDATE ${table} SET session_id = ? WHERE session_id = ? AND provider = ?`).run(to, from, provider || 'claude');
      }
    });
    run();
    return { migrated: true };
  };

  const pruneRetention = ({
    sessionId = '',
    provider = 'claude',
    projectName = '',
    perSessionMaxEvents = 1000,
    perProjectMaxCompactions = 80,
    rawRefsMaxSizeBytes = 5_000_000,
  } = {}) => {
    const cleanSessionId = readString(sessionId);
    const timestamp = nowMs();
    let prunedRefs = 0;
    let prunedEvents = 0;
    if (cleanSessionId) {
      const overflowEvents = db.prepare(`
        SELECT id FROM brain_events
        WHERE session_id = ? AND provider = ?
        ORDER BY created_at_ms DESC
        LIMIT -1 OFFSET ?
      `).all(cleanSessionId, provider || 'claude', Math.max(Number(perSessionMaxEvents) || 1000, 1));
      if (overflowEvents.length > 0) {
        const ids = overflowEvents.map((row) => row.id);
        const placeholders = ids.map(() => '?').join(',');
        prunedRefs += db.prepare(`UPDATE brain_refs SET pruned_at_ms = ? WHERE event_id IN (${placeholders})`)
          .run(timestamp, ...ids).changes;
        prunedEvents += db.prepare(`DELETE FROM brain_events WHERE id IN (${placeholders})`)
          .run(...ids).changes;
      }

      const total = db.prepare(`
        SELECT COALESCE(SUM(size_bytes), 0) AS total FROM brain_refs
        WHERE session_id = ? AND provider = ? AND pruned_at_ms IS NULL
      `).get(cleanSessionId, provider || 'claude')?.total || 0;
      if (Number(total) > Number(rawRefsMaxSizeBytes)) {
        const candidates = db.prepare(`
          SELECT id, size_bytes FROM brain_refs
          WHERE session_id = ? AND provider = ? AND pruned_at_ms IS NULL
          ORDER BY created_at_ms ASC
        `).all(cleanSessionId, provider || 'claude');
        let remaining = Number(total);
        const ids = [];
        for (const ref of candidates) {
          if (remaining <= Number(rawRefsMaxSizeBytes)) break;
          ids.push(ref.id);
          remaining -= Number(ref.size_bytes || 0);
        }
        if (ids.length > 0) {
          prunedRefs += db.prepare(`UPDATE brain_refs SET content = NULL, pruned_at_ms = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
            .run(timestamp, ...ids).changes;
        }
      }
    }

    if (readString(projectName)) {
      const overflowCompactions = db.prepare(`
        SELECT id FROM brain_compactions
        WHERE project_name = ?
        ORDER BY created_at_ms DESC
        LIMIT -1 OFFSET ?
      `).all(projectName, Math.max(Number(perProjectMaxCompactions) || 80, 1));
      if (overflowCompactions.length > 0) {
        db.prepare(`DELETE FROM brain_compactions WHERE id IN (${overflowCompactions.map(() => '?').join(',')})`)
          .run(...overflowCompactions.map((row) => row.id));
      }
    }
    return { prunedRefs, prunedEvents };
  };

  return {
    addCompaction,
    addEvent,
    addRef,
    addRetrievalRun,
    clearProject,
    clearSession,
    ensureSession,
    exportSession,
    getDiagnostics,
    getLatestCompaction,
    getAtom,
    getNodeDetail,
    getProjectProfile,
    importSession,
    inspectSession,
    listAtoms,
    listEvents,
    listRefs,
    listRetrievalRuns,
    listProjectNodes,
    listScenarios,
    migrateSessionId,
    previewRetention,
    pruneRetention,
    repairSession,
    updateAtom,
    upsertAtom,
    upsertProjectProfile,
    upsertScenario,
    upsertNode,
  };
}

export const brainStore = createBrainStore();
