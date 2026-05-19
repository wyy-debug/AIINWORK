export const APP_CONFIG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id INTEGER PRIMARY KEY,
  preferences_json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`;

export const VAPID_KEYS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS vapid_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const PUSH_SUBSCRIPTIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`;

export const SESSION_NAMES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS session_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  custom_name TEXT NOT NULL,
  pinned_at DATETIME,
  archived_at DATETIME,
  unread_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, provider)
);`;

export const SESSION_NAMES_LOOKUP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_session_names_lookup ON session_names(session_id, provider);`;

export const SESSION_AGENT_BINDINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS session_agent_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  agent_id TEXT NOT NULL,
  config_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, provider)
);`;

export const SESSION_AGENT_BINDINGS_LOOKUP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_session_agent_bindings_lookup ON session_agent_bindings(session_id, provider);`;

export const WORKTREE_DISPATCHES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS worktree_dispatches (
  id TEXT PRIMARY KEY,
  project_name TEXT,
  session_id TEXT,
  provider TEXT DEFAULT 'claude',
  parent_project_name TEXT NOT NULL,
  parent_project_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL UNIQUE,
  base_ref TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'managed',
  status TEXT NOT NULL DEFAULT 'created',
  agent_id TEXT,
  skills_json TEXT,
  app_bindings_json TEXT,
  task_prompt TEXT,
  display_name TEXT,
  branch_name TEXT,
  handoff_status TEXT,
  last_run_id TEXT,
  action_profile_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const WORKTREE_DISPATCHES_PARENT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_worktree_dispatches_parent ON worktree_dispatches(parent_project_name, status);`;
export const WORKTREE_DISPATCHES_PATH_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_worktree_dispatches_path ON worktree_dispatches(worktree_path);`;
export const WORKTREE_DISPATCHES_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_worktree_dispatches_session ON worktree_dispatches(session_id, provider);`;

export const AUTOMATION_DEFINITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS automation_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_name TEXT,
  project_path TEXT,
  prompt TEXT,
  target_mode TEXT NOT NULL DEFAULT 'triage-only',
  schedule_type TEXT NOT NULL DEFAULT 'manual',
  interval_minutes INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const AUTOMATION_DEFINITIONS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_automation_definitions_due ON automation_definitions(enabled, next_run_at);`;

export const AUTOMATION_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT,
  session_id TEXT,
  worktree_id TEXT,
  metadata_json TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  output TEXT,
  error TEXT,
  FOREIGN KEY (automation_id) REFERENCES automation_definitions(id) ON DELETE CASCADE
);`;

export const AUTOMATION_RUNS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, started_at);`;

export const AUTOMATION_RUN_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS automation_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES automation_runs(id) ON DELETE CASCADE
);`;

export const AUTOMATION_RUN_EVENTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_automation_run_events_run ON automation_run_events(run_id, created_at);`;

export const TRIAGE_ITEMS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS triage_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const TRIAGE_ITEMS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_triage_items_status ON triage_items(status, created_at);`;

export const ARTIFACTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  project_name TEXT,
  session_id TEXT,
  content TEXT,
  file_path TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const ARTIFACTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_artifacts_project_session ON artifacts(project_name, session_id, created_at);`;

export const ARTIFACT_LINKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS artifact_links (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  session_id TEXT,
  project_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);`;

export const ARTIFACT_LINKS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_artifact_links_source ON artifact_links(source_type, source_id, created_at);`;

export const SESSION_CHECKPOINTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  project_path TEXT,
  repository_root TEXT,
  profile_kind TEXT,
  permission_preset TEXT,
  permission_mode TEXT,
  before_status_json TEXT,
  after_status_json TEXT,
  patch TEXT,
  files_json TEXT,
  tool_calls_json TEXT,
  metadata_json TEXT,
  rollback_status TEXT NOT NULL DEFAULT 'available',
  rollback_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);`;

export const SESSION_CHECKPOINTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session ON session_checkpoints(session_id, provider, created_at);`;

export const REVIEW_COMMENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  file_path TEXT,
  line_number INTEGER,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

export const REVIEW_COMMENTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_review_comments_project ON review_comments(project_name, file_path, created_at);`;

export const ACTION_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS action_runs (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  action_type TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  output TEXT,
  exit_code INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME
);`;

export const ACTION_RUNS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_action_runs_project ON action_runs(project_name, started_at);`;

export const ACTION_RUN_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS action_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES action_runs(id) ON DELETE CASCADE
);`;

export const ACTION_RUN_EVENTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_action_run_events_run ON action_run_events(run_id, created_at);`;

export const HUB_USAGE_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS hub_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  user_id INTEGER,
  ip_address TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT,
  project_name TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  used_mcp INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT
);`;

export const HUB_USAGE_EVENTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_hub_usage_events_day_ip_user
  ON hub_usage_events(usage_date, ip_address, user_id, provider);`;

export const SWARM_DEFINITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_definitions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  manifest_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`;

export const SWARM_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_mode TEXT NOT NULL DEFAULT 'local-control-plane',
  runtime_status TEXT NOT NULL DEFAULT 'queued',
  coordinator_session_id TEXT,
  objective TEXT,
  session_id TEXT,
  project_path TEXT,
  template_json TEXT,
  launch_answers_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);`;

export const SWARM_AGENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_agents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_index INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  status TEXT NOT NULL,
  task_id TEXT,
  thread_id TEXT,
  agent_template_id TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MESSAGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT,
  topic TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  ttl_ms INTEGER NOT NULL DEFAULT 300000,
  ack_policy TEXT NOT NULL DEFAULT 'at_least_once',
  retry_limit INTEGER NOT NULL DEFAULT 3,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER,
  delivery_mode TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  error TEXT,
  delivered_to TEXT,
  acked_by TEXT,
  created_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER,
  acked_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MESSAGES_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_messages_run ON swarm_messages(run_id, status, created_at_ms);`;
export const SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_messages_idempotency ON swarm_messages(run_id, idempotency_key);`;

export const SWARM_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  message_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_EVENTS_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_events_run ON swarm_events(run_id, created_at_ms);`;

export const SWARM_DELIVERY_TRACE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_delivery_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  payload_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES swarm_messages(id) ON DELETE CASCADE
);`;

export const SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_delivery_trace_message ON swarm_delivery_trace(message_id, created_at_ms);`;

export const SWARM_ARTIFACTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS swarm_memory (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  promoteable INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES swarm_runs(id) ON DELETE CASCADE
);`;

export const SWARM_MEMORY_RUN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_swarm_memory_run ON swarm_memory(run_id, created_at_ms);`;

export const BRAIN_SESSIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  project_path TEXT,
  model_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  event_count INTEGER NOT NULL DEFAULT 0,
  latest_compaction_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_id, provider)
);`;

export const BRAIN_SESSIONS_LOOKUP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_sessions_lookup ON brain_sessions(session_id, provider);`;
export const BRAIN_SESSIONS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_sessions_project ON brain_sessions(project_name, updated_at_ms);`;

export const BRAIN_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  checkpoint_id TEXT,
  artifact_id TEXT,
  event_type TEXT NOT NULL,
  role TEXT,
  title TEXT,
  content TEXT,
  payload_json TEXT,
  created_at_ms INTEGER NOT NULL
);`;

export const BRAIN_EVENTS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_events_session ON brain_events(session_id, provider, created_at_ms);`;
export const BRAIN_EVENTS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_events_project ON brain_events(project_name, event_type, created_at_ms);`;
export const BRAIN_EVENTS_CHECKPOINT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_events_checkpoint ON brain_events(checkpoint_id);`;
export const BRAIN_EVENTS_ARTIFACT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_events_artifact ON brain_events(artifact_id);`;

export const BRAIN_REFS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_refs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  event_id TEXT,
  checkpoint_id TEXT,
  artifact_id TEXT,
  ref_type TEXT NOT NULL,
  ref_id TEXT,
  label TEXT,
  content TEXT,
  metadata_json TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  pruned_at_ms INTEGER,
  FOREIGN KEY (event_id) REFERENCES brain_events(id) ON DELETE CASCADE
);`;

export const BRAIN_REFS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_refs_session ON brain_refs(session_id, provider, created_at_ms);`;
export const BRAIN_REFS_EVENT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_refs_event ON brain_refs(event_id);`;
export const BRAIN_REFS_REF_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_refs_ref ON brain_refs(ref_type, ref_id);`;

export const BRAIN_NODES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_nodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  node_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 1,
  source_event_ids_json TEXT,
  ref_ids_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`;

export const BRAIN_NODES_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_nodes_session ON brain_nodes(session_id, provider, node_type, updated_at_ms);`;
export const BRAIN_NODES_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_nodes_project ON brain_nodes(project_name, node_type, updated_at_ms);`;

export const BRAIN_COMPACTIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  mermaid TEXT,
  summary TEXT,
  current_goal TEXT,
  completed_steps_json TEXT,
  active_decisions_json TEXT,
  open_risks_json TEXT,
  next_action TEXT,
  source_event_start_id TEXT,
  source_event_end_id TEXT,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  refs_json TEXT,
  created_at_ms INTEGER NOT NULL
);`;

export const BRAIN_COMPACTIONS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_compactions_session ON brain_compactions(session_id, provider, created_at_ms);`;
export const BRAIN_COMPACTIONS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_compactions_project ON brain_compactions(project_name, created_at_ms);`;

export const BRAIN_ATOMS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_atoms (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  atom_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  stable_key TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  superseded_by_id TEXT,
  conflict_reason TEXT,
  entities_json TEXT,
  source_event_ids_json TEXT,
  ref_ids_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_id, provider, stable_key)
);`;

export const BRAIN_ATOMS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_atoms_session ON brain_atoms(session_id, provider, atom_type, updated_at_ms);`;
export const BRAIN_ATOMS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_atoms_project ON brain_atoms(project_name, atom_type, updated_at_ms);`;
export const BRAIN_ATOMS_STABLE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_atoms_stable ON brain_atoms(session_id, provider, stable_key);`;

export const BRAIN_SCENARIOS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_scenarios (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  scenario_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  atom_ids_json TEXT,
  metrics_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_id, provider, scenario_key)
);`;

export const BRAIN_SCENARIOS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_scenarios_session ON brain_scenarios(session_id, provider, updated_at_ms);`;
export const BRAIN_SCENARIOS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_scenarios_project ON brain_scenarios(project_name, updated_at_ms);`;

export const BRAIN_PROJECT_PROFILES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_project_profiles (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  profile_type TEXT NOT NULL DEFAULT 'working-memory',
  summary TEXT,
  content_json TEXT,
  source_atom_ids_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(project_name, provider, profile_type)
);`;

export const BRAIN_PROJECT_PROFILES_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_project_profiles_lookup ON brain_project_profiles(project_name, provider, profile_type);`;

export const BRAIN_RETRIEVAL_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS brain_retrieval_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_name TEXT,
  query TEXT,
  mode TEXT NOT NULL DEFAULT 'hybrid',
  hit_count INTEGER NOT NULL DEFAULT 0,
  hits_json TEXT,
  metrics_json TEXT,
  created_at_ms INTEGER NOT NULL
);`;

export const BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_retrieval_runs_session ON brain_retrieval_runs(session_id, provider, created_at_ms);`;
export const BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_brain_retrieval_runs_project ON brain_retrieval_runs(project_name, created_at_ms);`;

export const DATABASE_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  is_active BOOLEAN DEFAULT 1,
  git_name TEXT,
  git_email TEXT,
  has_completed_onboarding BOOLEAN DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key_name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

CREATE TABLE IF NOT EXISTS user_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_name TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  credential_value TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${USER_NOTIFICATION_PREFERENCES_TABLE_SQL}

${VAPID_KEYS_TABLE_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SQL}

${SESSION_NAMES_TABLE_SQL}

${SESSION_NAMES_LOOKUP_INDEX_SQL}

${SESSION_AGENT_BINDINGS_TABLE_SQL}

${SESSION_AGENT_BINDINGS_LOOKUP_INDEX_SQL}

${WORKTREE_DISPATCHES_TABLE_SQL}

${WORKTREE_DISPATCHES_PARENT_INDEX_SQL}

${WORKTREE_DISPATCHES_PATH_INDEX_SQL}

${WORKTREE_DISPATCHES_SESSION_INDEX_SQL}

${AUTOMATION_DEFINITIONS_TABLE_SQL}

${AUTOMATION_DEFINITIONS_INDEX_SQL}

${AUTOMATION_RUNS_TABLE_SQL}

${AUTOMATION_RUNS_INDEX_SQL}

${AUTOMATION_RUN_EVENTS_TABLE_SQL}

${AUTOMATION_RUN_EVENTS_INDEX_SQL}

${TRIAGE_ITEMS_TABLE_SQL}

${TRIAGE_ITEMS_INDEX_SQL}

${ARTIFACTS_TABLE_SQL}

${ARTIFACTS_INDEX_SQL}

${ARTIFACT_LINKS_TABLE_SQL}

${ARTIFACT_LINKS_INDEX_SQL}

${SESSION_CHECKPOINTS_TABLE_SQL}

${SESSION_CHECKPOINTS_INDEX_SQL}

${REVIEW_COMMENTS_TABLE_SQL}

${REVIEW_COMMENTS_INDEX_SQL}

${ACTION_RUNS_TABLE_SQL}

${ACTION_RUNS_INDEX_SQL}

${ACTION_RUN_EVENTS_TABLE_SQL}

${ACTION_RUN_EVENTS_INDEX_SQL}

${HUB_USAGE_EVENTS_TABLE_SQL}

${HUB_USAGE_EVENTS_INDEX_SQL}

${SWARM_DEFINITIONS_TABLE_SQL}

${SWARM_RUNS_TABLE_SQL}

${SWARM_AGENTS_TABLE_SQL}

${SWARM_MESSAGES_TABLE_SQL}

${SWARM_MESSAGES_RUN_INDEX_SQL}

${SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL}

${SWARM_EVENTS_TABLE_SQL}

${SWARM_EVENTS_RUN_INDEX_SQL}

${SWARM_DELIVERY_TRACE_TABLE_SQL}

${SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL}

${SWARM_ARTIFACTS_TABLE_SQL}

${SWARM_MEMORY_TABLE_SQL}

${SWARM_MEMORY_RUN_INDEX_SQL}

${BRAIN_SESSIONS_TABLE_SQL}

${BRAIN_SESSIONS_LOOKUP_INDEX_SQL}

${BRAIN_SESSIONS_PROJECT_INDEX_SQL}

${BRAIN_EVENTS_TABLE_SQL}

${BRAIN_EVENTS_SESSION_INDEX_SQL}

${BRAIN_EVENTS_PROJECT_INDEX_SQL}

${BRAIN_EVENTS_CHECKPOINT_INDEX_SQL}

${BRAIN_EVENTS_ARTIFACT_INDEX_SQL}

${BRAIN_REFS_TABLE_SQL}

${BRAIN_REFS_SESSION_INDEX_SQL}

${BRAIN_REFS_EVENT_INDEX_SQL}

${BRAIN_REFS_REF_INDEX_SQL}

${BRAIN_NODES_TABLE_SQL}

${BRAIN_NODES_SESSION_INDEX_SQL}

${BRAIN_NODES_PROJECT_INDEX_SQL}

${BRAIN_COMPACTIONS_TABLE_SQL}

${BRAIN_COMPACTIONS_SESSION_INDEX_SQL}

${BRAIN_COMPACTIONS_PROJECT_INDEX_SQL}

${APP_CONFIG_TABLE_SQL}
`;
