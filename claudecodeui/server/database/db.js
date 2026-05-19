import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import {
  CHECKPOINTS_PROJECT_INDEX_SQL,
  CHECKPOINTS_SESSION_INDEX_SQL,
  CHECKPOINTS_TABLE_SQL
} from '../services/checkpoint-service.js';
import { createHubUsageStore } from '../services/hub-usage-service.js';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';

import {
  APP_CONFIG_TABLE_SQL,
  USER_NOTIFICATION_PREFERENCES_TABLE_SQL,
  VAPID_KEYS_TABLE_SQL,
  PUSH_SUBSCRIPTIONS_TABLE_SQL,
  SESSION_NAMES_TABLE_SQL,
  SESSION_NAMES_LOOKUP_INDEX_SQL,
  SESSION_AGENT_BINDINGS_TABLE_SQL,
  SESSION_AGENT_BINDINGS_LOOKUP_INDEX_SQL,
  WORKTREE_DISPATCHES_TABLE_SQL,
  WORKTREE_DISPATCHES_PARENT_INDEX_SQL,
  WORKTREE_DISPATCHES_PATH_INDEX_SQL,
  WORKTREE_DISPATCHES_SESSION_INDEX_SQL,
  AUTOMATION_DEFINITIONS_TABLE_SQL,
  AUTOMATION_DEFINITIONS_INDEX_SQL,
  AUTOMATION_RUNS_TABLE_SQL,
  AUTOMATION_RUNS_INDEX_SQL,
  AUTOMATION_RUN_EVENTS_TABLE_SQL,
  AUTOMATION_RUN_EVENTS_INDEX_SQL,
  TRIAGE_ITEMS_TABLE_SQL,
  TRIAGE_ITEMS_INDEX_SQL,
  ARTIFACTS_TABLE_SQL,
  ARTIFACTS_INDEX_SQL,
  ARTIFACT_LINKS_TABLE_SQL,
  ARTIFACT_LINKS_INDEX_SQL,
  SESSION_CHECKPOINTS_TABLE_SQL,
  SESSION_CHECKPOINTS_INDEX_SQL,
  OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL,
  OBSIDIAN_AUTO_CAPTURE_KEYS_SOURCE_INDEX_SQL,
  REVIEW_COMMENTS_TABLE_SQL,
  REVIEW_COMMENTS_INDEX_SQL,
  ACTION_RUNS_TABLE_SQL,
  ACTION_RUNS_INDEX_SQL,
  ACTION_RUN_EVENTS_TABLE_SQL,
  ACTION_RUN_EVENTS_INDEX_SQL,
  HUB_USAGE_EVENTS_TABLE_SQL,
  HUB_USAGE_EVENTS_INDEX_SQL,
  SWARM_DEFINITIONS_TABLE_SQL,
  SWARM_RUNS_TABLE_SQL,
  SWARM_AGENTS_TABLE_SQL,
  SWARM_MESSAGES_TABLE_SQL,
  SWARM_MESSAGES_RUN_INDEX_SQL,
  SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL,
  SWARM_EVENTS_TABLE_SQL,
  SWARM_EVENTS_RUN_INDEX_SQL,
  SWARM_DELIVERY_TRACE_TABLE_SQL,
  SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL,
  SWARM_ARTIFACTS_TABLE_SQL,
  SWARM_MEMORY_TABLE_SQL,
  SWARM_MEMORY_RUN_INDEX_SQL,
  BRAIN_SESSIONS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  DATABASE_SCHEMA_SQL
} from './schema.js';

const __dirname = getModuleDir(import.meta.url);
// The compiled backend lives under dist-server/server/database, but the install root we log
// should still point at the project/app root. Resolving it here avoids build-layout drift.
const APP_ROOT = findAppRoot(__dirname);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(`Failed to create database directory ${dbDir}:`, error.message);
    throw error;
  }
}

// As part of 1.19.2 we are introducing a new location for auth.db. The below handles exisitng moving legacy database from install directory to new location
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

// app_config must exist before any other module imports (auth.js reads the JWT secret at load time).
// runMigrations() also creates this table, but it runs too late for existing installations
// where auth.js is imported before initializeDatabase() is called.
db.exec(APP_CONFIG_TABLE_SQL);

// Show app installation path prominently
const appInstallPath = APP_ROOT;
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    db.exec(USER_NOTIFICATION_PREFERENCES_TABLE_SQL);
    db.exec(VAPID_KEYS_TABLE_SQL);
    db.exec(PUSH_SUBSCRIPTIONS_TABLE_SQL);
    db.exec(APP_CONFIG_TABLE_SQL);
    db.exec(SESSION_NAMES_TABLE_SQL);
    const sessionNameColumns = db.prepare("PRAGMA table_info(session_names)").all();
    const sessionNameColumnNames = sessionNameColumns.map(col => col.name);
    for (const [columnName, columnSql] of [
      ['pinned_at', 'ALTER TABLE session_names ADD COLUMN pinned_at DATETIME'],
      ['archived_at', 'ALTER TABLE session_names ADD COLUMN archived_at DATETIME'],
      ['unread_at', 'ALTER TABLE session_names ADD COLUMN unread_at DATETIME'],
    ]) {
      if (!sessionNameColumnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column to session_names`);
        db.exec(columnSql);
      }
    }
    db.exec(SESSION_NAMES_LOOKUP_INDEX_SQL);
    db.exec(SESSION_AGENT_BINDINGS_TABLE_SQL);
    const sessionAgentBindingColumns = db.prepare("PRAGMA table_info(session_agent_bindings)").all();
    const sessionAgentBindingColumnNames = sessionAgentBindingColumns.map(col => col.name);
    if (!sessionAgentBindingColumnNames.includes('config_json')) {
      console.log('Running migration: Adding config_json column to session_agent_bindings');
      db.exec('ALTER TABLE session_agent_bindings ADD COLUMN config_json TEXT');
    }
    db.exec(SESSION_AGENT_BINDINGS_LOOKUP_INDEX_SQL);
    db.exec(WORKTREE_DISPATCHES_TABLE_SQL);
    const worktreeColumns = db.prepare("PRAGMA table_info(worktree_dispatches)").all();
    const worktreeColumnNames = worktreeColumns.map(col => col.name);
    for (const [columnName, columnSql] of [
      ['project_name', 'ALTER TABLE worktree_dispatches ADD COLUMN project_name TEXT'],
      ['provider', "ALTER TABLE worktree_dispatches ADD COLUMN provider TEXT DEFAULT 'claude'"],
      ['branch_name', 'ALTER TABLE worktree_dispatches ADD COLUMN branch_name TEXT'],
      ['handoff_status', 'ALTER TABLE worktree_dispatches ADD COLUMN handoff_status TEXT'],
      ['last_run_id', 'ALTER TABLE worktree_dispatches ADD COLUMN last_run_id TEXT'],
      ['action_profile_id', 'ALTER TABLE worktree_dispatches ADD COLUMN action_profile_id TEXT'],
    ]) {
      if (!worktreeColumnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column to worktree_dispatches`);
        db.exec(columnSql);
      }
    }
    db.exec(WORKTREE_DISPATCHES_PARENT_INDEX_SQL);
    db.exec(WORKTREE_DISPATCHES_PATH_INDEX_SQL);
    db.exec(WORKTREE_DISPATCHES_SESSION_INDEX_SQL);
    db.exec(AUTOMATION_DEFINITIONS_TABLE_SQL);
    const automationColumns = db.prepare("PRAGMA table_info(automation_definitions)").all();
    const automationColumnNames = automationColumns.map(col => col.name);
    if (!automationColumnNames.includes('target_mode')) {
      console.log('Running migration: Adding target_mode column to automation_definitions');
      db.exec("ALTER TABLE automation_definitions ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'triage-only'");
    }
    db.exec(AUTOMATION_DEFINITIONS_INDEX_SQL);
    db.exec(AUTOMATION_RUNS_TABLE_SQL);
    const automationRunColumns = db.prepare("PRAGMA table_info(automation_runs)").all();
    const automationRunColumnNames = automationRunColumns.map(col => col.name);
    for (const [columnName, columnSql] of [
      ['trigger_type', 'ALTER TABLE automation_runs ADD COLUMN trigger_type TEXT'],
      ['session_id', 'ALTER TABLE automation_runs ADD COLUMN session_id TEXT'],
      ['worktree_id', 'ALTER TABLE automation_runs ADD COLUMN worktree_id TEXT'],
      ['metadata_json', 'ALTER TABLE automation_runs ADD COLUMN metadata_json TEXT'],
    ]) {
      if (!automationRunColumnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column to automation_runs`);
        db.exec(columnSql);
      }
    }
    db.exec(AUTOMATION_RUNS_INDEX_SQL);
    db.exec(AUTOMATION_RUN_EVENTS_TABLE_SQL);
    db.exec(AUTOMATION_RUN_EVENTS_INDEX_SQL);
    db.exec(TRIAGE_ITEMS_TABLE_SQL);
    db.exec(TRIAGE_ITEMS_INDEX_SQL);
    db.exec(ARTIFACTS_TABLE_SQL);
    db.exec(ARTIFACTS_INDEX_SQL);
    db.exec(ARTIFACT_LINKS_TABLE_SQL);
    db.exec(ARTIFACT_LINKS_INDEX_SQL);
    db.exec(SESSION_CHECKPOINTS_TABLE_SQL);
    db.exec(SESSION_CHECKPOINTS_INDEX_SQL);
    db.exec(OBSIDIAN_AUTO_CAPTURE_KEYS_TABLE_SQL);
    db.exec(OBSIDIAN_AUTO_CAPTURE_KEYS_SOURCE_INDEX_SQL);
    db.exec(REVIEW_COMMENTS_TABLE_SQL);
    db.exec(REVIEW_COMMENTS_INDEX_SQL);
    db.exec(ACTION_RUNS_TABLE_SQL);
    db.exec(ACTION_RUNS_INDEX_SQL);
    db.exec(ACTION_RUN_EVENTS_TABLE_SQL);
    db.exec(ACTION_RUN_EVENTS_INDEX_SQL);
    db.exec(HUB_USAGE_EVENTS_TABLE_SQL);
    db.exec(HUB_USAGE_EVENTS_INDEX_SQL);
    db.exec(SWARM_DEFINITIONS_TABLE_SQL);
    db.exec(SWARM_RUNS_TABLE_SQL);
    const swarmRunColumns = db.prepare("PRAGMA table_info(swarm_runs)").all();
    const swarmRunColumnNames = swarmRunColumns.map(col => col.name);
    for (const [columnName, columnSql] of [
      ['runtime_mode', "ALTER TABLE swarm_runs ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'local-control-plane'"],
      ['runtime_status', "ALTER TABLE swarm_runs ADD COLUMN runtime_status TEXT NOT NULL DEFAULT 'queued'"],
      ['coordinator_session_id', 'ALTER TABLE swarm_runs ADD COLUMN coordinator_session_id TEXT'],
    ]) {
      if (!swarmRunColumnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column to swarm_runs`);
        db.exec(columnSql);
      }
    }
    db.exec(SWARM_AGENTS_TABLE_SQL);
    db.exec(SWARM_MESSAGES_TABLE_SQL);
    const swarmMessageColumns = db.prepare("PRAGMA table_info(swarm_messages)").all();
    const swarmMessageColumnNames = swarmMessageColumns.map(col => col.name);
    for (const [columnName, columnSql] of [
      ['next_attempt_at_ms', 'ALTER TABLE swarm_messages ADD COLUMN next_attempt_at_ms INTEGER'],
      ['delivery_mode', 'ALTER TABLE swarm_messages ADD COLUMN delivery_mode TEXT'],
    ]) {
      if (!swarmMessageColumnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column to swarm_messages`);
        db.exec(columnSql);
      }
    }
    db.exec(SWARM_MESSAGES_RUN_INDEX_SQL);
    db.exec(SWARM_MESSAGES_IDEMPOTENCY_INDEX_SQL);
    db.exec(SWARM_EVENTS_TABLE_SQL);
    db.exec(SWARM_EVENTS_RUN_INDEX_SQL);
    db.exec(SWARM_DELIVERY_TRACE_TABLE_SQL);
    db.exec(SWARM_DELIVERY_TRACE_MESSAGE_INDEX_SQL);
    db.exec(SWARM_ARTIFACTS_TABLE_SQL);
    db.exec(SWARM_MEMORY_TABLE_SQL);
    db.exec(SWARM_MEMORY_RUN_INDEX_SQL);
    db.exec(CHECKPOINTS_TABLE_SQL);
    db.exec(CHECKPOINTS_SESSION_INDEX_SQL);
    db.exec(CHECKPOINTS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_SESSIONS_TABLE_SQL);
    db.exec(BRAIN_SESSIONS_LOOKUP_INDEX_SQL);
    db.exec(BRAIN_SESSIONS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_EVENTS_TABLE_SQL);
    db.exec(BRAIN_EVENTS_SESSION_INDEX_SQL);
    db.exec(BRAIN_EVENTS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_EVENTS_CHECKPOINT_INDEX_SQL);
    db.exec(BRAIN_EVENTS_ARTIFACT_INDEX_SQL);
    db.exec(BRAIN_REFS_TABLE_SQL);
    db.exec(BRAIN_REFS_SESSION_INDEX_SQL);
    db.exec(BRAIN_REFS_EVENT_INDEX_SQL);
    db.exec(BRAIN_REFS_REF_INDEX_SQL);
    db.exec(BRAIN_NODES_TABLE_SQL);
    db.exec(BRAIN_NODES_SESSION_INDEX_SQL);
    db.exec(BRAIN_NODES_PROJECT_INDEX_SQL);
    db.exec(BRAIN_COMPACTIONS_TABLE_SQL);
    db.exec(BRAIN_COMPACTIONS_SESSION_INDEX_SQL);
    db.exec(BRAIN_COMPACTIONS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_ATOMS_TABLE_SQL);
    db.exec(BRAIN_ATOMS_SESSION_INDEX_SQL);
    db.exec(BRAIN_ATOMS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_ATOMS_STABLE_INDEX_SQL);
    db.exec(BRAIN_SCENARIOS_TABLE_SQL);
    db.exec(BRAIN_SCENARIOS_SESSION_INDEX_SQL);
    db.exec(BRAIN_SCENARIOS_PROJECT_INDEX_SQL);
    db.exec(BRAIN_PROJECT_PROFILES_TABLE_SQL);
    db.exec(BRAIN_PROJECT_PROFILES_INDEX_SQL);
    db.exec(BRAIN_RETRIEVAL_RUNS_TABLE_SQL);
    db.exec(BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL);
    db.exec(BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL);

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    db.exec(DATABASE_SCHEMA_SQL);
    console.log('Database initialized successfully');
    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal — logged but not thrown)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  }
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

const DEFAULT_NOTIFICATION_PREFERENCES = {
  channels: {
    inApp: false,
    webPush: false
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true
  }
};

const normalizeNotificationPreferences = (value) => {
  const source = value && typeof value === 'object' ? value : {};

  return {
    channels: {
      inApp: source.channels?.inApp === true,
      webPush: source.channels?.webPush === true
    },
    events: {
      actionRequired: source.events?.actionRequired !== false,
      stop: source.events?.stop !== false,
      error: source.events?.error !== false
    }
  };
};

const notificationPreferencesDb = {
  getPreferences: (userId) => {
    try {
      const row = db.prepare('SELECT preferences_json FROM user_notification_preferences WHERE user_id = ?').get(userId);
      if (!row) {
        const defaults = normalizeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
        db.prepare(
          'INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
        ).run(userId, JSON.stringify(defaults));
        return defaults;
      }

      let parsed;
      try {
        parsed = JSON.parse(row.preferences_json);
      } catch {
        parsed = DEFAULT_NOTIFICATION_PREFERENCES;
      }
      return normalizeNotificationPreferences(parsed);
    } catch (err) {
      throw err;
    }
  },

  updatePreferences: (userId, preferences) => {
    try {
      const normalized = normalizeNotificationPreferences(preferences);
      db.prepare(
        `INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           preferences_json = excluded.preferences_json,
           updated_at = CURRENT_TIMESTAMP`
      ).run(userId, JSON.stringify(normalized));
      return normalized;
    } catch (err) {
      throw err;
    }
  }
};

const pushSubscriptionsDb = {
  saveSubscription: (userId, endpoint, keysP256dh, keysAuth) => {
    try {
      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           keys_p256dh = excluded.keys_p256dh,
           keys_auth = excluded.keys_auth`
      ).run(userId, endpoint, keysP256dh, keysAuth);
    } catch (err) {
      throw err;
    }
  },

  getSubscriptions: (userId) => {
    try {
      return db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?').all(userId);
    } catch (err) {
      throw err;
    }
  },

  removeSubscription: (endpoint) => {
    try {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    } catch (err) {
      throw err;
    }
  },

  removeAllForUser: (userId) => {
    try {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  }
};

// Session custom names database operations
const sessionNamesDb = {
  // Set (insert or update) a custom session name
  setName: (sessionId, provider, customName) => {
    db.prepare(`
      INSERT INTO session_names (session_id, provider, custom_name)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, provider)
      DO UPDATE SET custom_name = excluded.custom_name, updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, provider, customName);
  },

  // Get a single custom session name
  getName: (sessionId, provider) => {
    const row = db.prepare(
      'SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?'
    ).get(sessionId, provider);
    return row?.custom_name || null;
  },

  // Batch lookup — returns Map<sessionId, customName>
  getNames: (sessionIds, provider) => {
    if (!sessionIds.length) return new Map();
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT session_id, custom_name FROM session_names
       WHERE session_id IN (${placeholders}) AND provider = ?`
    ).all(...sessionIds, provider);
    return new Map(rows.map(r => [r.session_id, r.custom_name]));
  },

  getMetadataForSessions: (sessionIds, provider) => {
    if (!sessionIds.length) return new Map();
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT session_id, custom_name, pinned_at, archived_at, unread_at FROM session_names
       WHERE session_id IN (${placeholders}) AND provider = ?`
    ).all(...sessionIds, provider);
    return new Map(rows.map(row => [row.session_id, {
      customName: row.custom_name || '',
      pinnedAt: row.pinned_at || null,
      archivedAt: row.archived_at || null,
      unreadAt: row.unread_at || null,
    }]));
  },

  setMetadata: (sessionId, provider, metadata = {}) => {
    const existing = db.prepare(
      'SELECT custom_name, pinned_at, archived_at, unread_at FROM session_names WHERE session_id = ? AND provider = ?'
    ).get(sessionId, provider) || {};
    const existingName = existing.custom_name || '';
    const nextPinnedAt = Object.prototype.hasOwnProperty.call(metadata, 'pinned')
      ? metadata.pinned ? new Date().toISOString() : null
      : existing.pinned_at || null;
    const nextArchivedAt = Object.prototype.hasOwnProperty.call(metadata, 'archived')
      ? metadata.archived ? new Date().toISOString() : null
      : existing.archived_at || null;
    const nextUnreadAt = Object.prototype.hasOwnProperty.call(metadata, 'unread')
      ? metadata.unread ? new Date().toISOString() : null
      : existing.unread_at || null;
    db.prepare(`
      INSERT INTO session_names (session_id, provider, custom_name, pinned_at, archived_at, unread_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider)
      DO UPDATE SET
        pinned_at = excluded.pinned_at,
        archived_at = excluded.archived_at,
        unread_at = excluded.unread_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      sessionId,
      provider,
      existingName,
      nextPinnedAt,
      nextArchivedAt,
      nextUnreadAt,
    );
  },

  // Delete a custom session name
  deleteName: (sessionId, provider) => {
    return db.prepare(
      'DELETE FROM session_names WHERE session_id = ? AND provider = ?'
    ).run(sessionId, provider).changes > 0;
  },
};

const SESSION_BINDING_NO_AGENT_ID = '__session_context__';

const sessionAgentBindingsDb = {
  setAgent: (sessionId, provider, agentId, configuration = null) => {
    const configJson = configuration && typeof configuration === 'object'
      ? JSON.stringify(configuration)
      : null;
    const storedAgentId = agentId || SESSION_BINDING_NO_AGENT_ID;
    db.prepare(`
      INSERT INTO session_agent_bindings (session_id, provider, agent_id, config_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, provider)
      DO UPDATE SET agent_id = excluded.agent_id, config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, provider, storedAgentId, configJson);
  },

  getBinding: (sessionId, provider) => {
    const row = db.prepare(
      'SELECT agent_id, config_json FROM session_agent_bindings WHERE session_id = ? AND provider = ?'
    ).get(sessionId, provider);
    if (!row?.agent_id) {
      return null;
    }
    let configuration = null;
    if (row.config_json) {
      try {
        configuration = JSON.parse(row.config_json);
      } catch {
        configuration = null;
      }
    }
    const agentId = row.agent_id === SESSION_BINDING_NO_AGENT_ID ? '' : row.agent_id;
    return {
      agentId,
      configuration,
    };
  },

  getAgentId: (sessionId, provider) => {
    return sessionAgentBindingsDb.getBinding(sessionId, provider)?.agentId || null;
  },

  deleteAgent: (sessionId, provider) => {
    return db.prepare(
      'DELETE FROM session_agent_bindings WHERE session_id = ? AND provider = ?'
    ).run(sessionId, provider).changes > 0;
  },

  deleteAgentFromAllSessions: (agentId) => {
    return db.prepare(
      'DELETE FROM session_agent_bindings WHERE agent_id = ?'
    ).run(agentId).changes;
  },
};

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapWorktreeDispatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectName: row.project_name || '',
    sessionId: row.session_id || null,
    provider: row.provider || 'claude',
    parentProjectName: row.parent_project_name,
    parentProjectPath: row.parent_project_path,
    worktreePath: row.worktree_path,
    baseRef: row.base_ref,
    baseCommit: row.base_commit,
    mode: row.mode,
    status: row.status,
    agentId: row.agent_id || '',
    skills: parseJsonArray(row.skills_json).filter((item) => typeof item === 'string'),
    appBindings: parseJsonArray(row.app_bindings_json),
    taskPrompt: row.task_prompt || '',
    displayName: row.display_name || '',
    branchName: row.branch_name || '',
    handoffStatus: row.handoff_status || '',
    lastRunId: row.last_run_id || '',
    actionProfileId: row.action_profile_id || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const worktreeDispatchesDb = {
  create: (dispatch) => {
    const normalized = {
      provider: 'claude',
      mode: 'managed',
      status: 'created',
      skills: [],
      appBindings: [],
      ...dispatch,
    };
    db.prepare(`
      INSERT INTO worktree_dispatches (
        id, project_name, session_id, provider, parent_project_name, parent_project_path,
        worktree_path, base_ref, base_commit, mode, status, agent_id, skills_json,
        app_bindings_json, task_prompt, display_name, branch_name, handoff_status,
        last_run_id, action_profile_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.id,
      normalized.projectName || null,
      normalized.sessionId || null,
      normalized.provider || 'claude',
      normalized.parentProjectName,
      normalized.parentProjectPath,
      normalized.worktreePath,
      normalized.baseRef,
      normalized.baseCommit,
      normalized.mode || 'managed',
      normalized.status || 'created',
      normalized.agentId || null,
      JSON.stringify(Array.isArray(normalized.skills) ? normalized.skills : []),
      JSON.stringify(Array.isArray(normalized.appBindings) ? normalized.appBindings : []),
      normalized.taskPrompt || null,
      normalized.displayName || null,
      normalized.branchName || null,
      normalized.handoffStatus || null,
      normalized.lastRunId || null,
      normalized.actionProfileId || null,
    );
    return worktreeDispatchesDb.getById(normalized.id);
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM worktree_dispatches WHERE id = ?').get(id);
    return mapWorktreeDispatch(row);
  },

  getByWorktreePath: (worktreePath) => {
    const row = db.prepare('SELECT * FROM worktree_dispatches WHERE worktree_path = ? AND status != ?').get(worktreePath, 'archived');
    return mapWorktreeDispatch(row);
  },

  listByParentProjectName: (parentProjectName) => {
    const rows = db.prepare(`
      SELECT * FROM worktree_dispatches
      WHERE parent_project_name = ? AND status != 'archived'
      ORDER BY created_at DESC
    `).all(parentProjectName);
    return rows.map(mapWorktreeDispatch);
  },

  updateProjectName: (id, projectName) => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET project_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(projectName || null, id);
    return worktreeDispatchesDb.getById(id);
  },

  updateSession: (id, sessionId, provider = 'claude') => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET session_id = ?, provider = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId || null, provider || 'claude', id);
    return worktreeDispatchesDb.getById(id);
  },

  updateStatus: (id, status) => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);
    return worktreeDispatchesDb.getById(id);
  },

  updateBranch: (id, branchName) => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET branch_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(branchName || null, id);
    return worktreeDispatchesDb.getById(id);
  },

  updateHandoff: (id, handoffStatus) => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET handoff_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(handoffStatus || null, id);
    return worktreeDispatchesDb.getById(id);
  },

  updateActionRun: (id, lastRunId, actionProfileId = null) => {
    db.prepare(`
      UPDATE worktree_dispatches
      SET last_run_id = ?, action_profile_id = COALESCE(?, action_profile_id), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(lastRunId || null, actionProfileId || null, id);
    return worktreeDispatchesDb.getById(id);
  },
};

// Apply custom session names from the database (overrides CLI-generated summaries)
function applyCustomSessionNames(sessions, provider) {
  if (!sessions?.length) return;
  try {
    const ids = sessions.map(s => s.id);
    const metadataBySession = sessionNamesDb.getMetadataForSessions(ids, provider);
    for (const session of sessions) {
      const metadata = metadataBySession.get(session.id);
      if (!metadata) continue;
      if (metadata.customName) session.summary = metadata.customName;
      session.pinnedAt = metadata.pinnedAt;
      session.archivedAt = metadata.archivedAt;
      session.unreadAt = metadata.unreadAt;
      session.isPinned = Boolean(metadata.pinnedAt);
      session.isArchived = Boolean(metadata.archivedAt);
      session.isUnread = Boolean(metadata.unreadAt);
    }
  } catch (error) {
    console.warn(`[DB] Failed to apply custom session names for ${provider}:`, error.message);
  }
}

// App config database operations
const appConfigDb = {
  get: (key) => {
    try {
      const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
      return row?.value || null;
    } catch (err) {
      return null;
    }
  },

  set: (key, value) => {
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  },

  getOrCreateJwtSecret: () => {
    let secret = appConfigDb.get('jwt_secret');
    if (!secret) {
      secret = crypto.randomBytes(64).toString('hex');
      appConfigDb.set('jwt_secret', secret);
    }
    return secret;
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

const hubUsageDb = createHubUsageStore(db);

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionNamesDb,
  sessionAgentBindingsDb,
  worktreeDispatchesDb,
  applyCustomSessionNames,
  appConfigDb,
  hubUsageDb,
  githubTokensDb // Backward compatibility
};
