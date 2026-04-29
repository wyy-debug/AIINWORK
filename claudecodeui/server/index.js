#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import { spawn } from 'child_process';
import fs, { promises as fsPromises } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import cors from 'cors';
import express from 'express';
import mime from 'mime-types';
import pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';

import { AppError, createNormalizedMessage } from '@/shared/utils.js';

import { getConnectableHost } from '../shared/networkHosts.js';

import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, resolveToolApproval, getPendingApprovalsForSession, reconnectSessionWriter } from './claude-sdk.js';
import { IS_PLATFORM } from './constants/config.js';
import { spawnCursor, abortCursorSession, isCursorSessionActive, getActiveCursorSessions } from './cursor-cli.js';
import { initializeDatabase, sessionNamesDb, sessionAgentBindingsDb, applyCustomSessionNames } from './database/db.js';
import { spawnGemini, abortGeminiSession, isGeminiSessionActive, getActiveGeminiSessions } from './gemini-cli.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import { queryCodex, abortCodexSession, isCodexSessionActive, getActiveCodexSessions } from './openai-codex.js';
import {
    getProjects,
    getSessions,
    getStandaloneConversationProject,
    getStandaloneConversationProjectName,
    renameProject,
    deleteSession,
    deleteProject,
    extractProjectDirectory,
    clearProjectDirectoryCache,
    searchConversations,
} from './projects.js';
import agentRepositoryRoutes from './routes/agent-repository.js';
import agentRoutes from './routes/agent.js';
import agentsRoutes from './routes/agents.js';
import authRoutes from './routes/auth.js';
import codexRoutes from './routes/codex.js';
import commandsRoutes from './routes/commands.js';
import cursorRoutes from './routes/cursor.js';
import geminiRoutes from './routes/gemini.js';
import gitRoutes from './routes/git.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import messagesRoutes from './routes/messages.js';
import pluginsRoutes from './routes/plugins.js';
import projectsRoutes, { WORKSPACES_ROOT, validateWorkspacePath } from './routes/projects.js';
import providerRoutes from './modules/providers/provider.routes.js';
import sessionAgentRoutes from './routes/session-agents.js';
import settingsRoutes from './routes/settings.js';
import taskmasterRoutes from './routes/taskmaster.js';
import userRoutes from './routes/user.js';
import worktreeRoutes from './routes/worktrees.js';
import sessionManager from './sessionManager.js';
import { resolveAgentRuntime, resolveSkillReferences } from './services/agent-config-service.js';
import { readResolvedOpenMythosRuntimeConfig } from './services/mtl-code-model-service.js';
import { configureWebPush } from './services/vapid-keys.js';
import { c } from './utils/colors.js';
import { startEnabledPluginServers, stopAllPlugins, getPluginPort } from './utils/plugin-process-manager.js';
import { findAppRoot, getModuleDir } from './utils/runtime-paths.js';
import { stripAnsiSequences, normalizeDetectedUrl, extractUrlsFromText, shouldAutoOpenUrlFromOutput } from './utils/url-detection.js';

const __dirname = getModuleDir(import.meta.url);
// The server source runs from /server, while the compiled output runs from /dist-server/server.
// Resolving the app root once keeps every repo-level lookup below aligned across both layouts.
const APP_ROOT = findAppRoot(__dirname);
const installMode = fs.existsSync(path.join(APP_ROOT, '.git')) ? 'git' : 'npm';

console.log('SERVER_PORT from env:', process.env.SERVER_PORT);

const VALID_PROVIDERS = ['claude', 'codex', 'cursor', 'gemini'];
const MTL_CODE_DEFAULT_CLI = 'mtl-code';

function uniquePaths(paths) {
    return [...new Set(paths.filter(Boolean))];
}

function getMtlCodeHomeDir() {
    return process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

function getLegacyClaudeHomeDir() {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getClaudeProviderHomeDirs() {
    return uniquePaths([getMtlCodeHomeDir(), getLegacyClaudeHomeDir()]);
}

function resolveMtlCodeCliCommand() {
    return process.env.MTL_CODE_CLI_PATH || process.env.CLAUDE_CLI_PATH || MTL_CODE_DEFAULT_CLI;
}

function findClaudeProviderProjectDir(projectName) {
    for (const homeDir of getClaudeProviderHomeDirs()) {
        const projectDir = path.join(homeDir, 'projects', projectName);
        if (fs.existsSync(projectDir)) {
            return projectDir;
        }
    }

    return path.join(getMtlCodeHomeDir(), 'projects', projectName);
}

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [
    { provider: 'claude', rootPath: path.join(getMtlCodeHomeDir(), 'projects') },
    { provider: 'claude', rootPath: path.join(getLegacyClaudeHomeDir(), 'projects') },
    { provider: 'cursor', rootPath: path.join(os.homedir(), '.cursor', 'chats') },
    { provider: 'codex', rootPath: path.join(os.homedir(), '.codex', 'sessions') },
    { provider: 'gemini', rootPath: path.join(os.homedir(), '.gemini', 'projects') },
    { provider: 'gemini_sessions', rootPath: path.join(os.homedir(), '.gemini', 'sessions') }
];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const WATCHER_DEBOUNCE_MS = 300;
let projectsWatchers = [];
let projectsWatcherDebounceTimer = null;
const connectedClients = new Set();
let isGetProjectsRunning = false; // Flag to prevent reentrant calls

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Setup file system watchers for Claude, Cursor, and Codex project/session folders
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;

    if (projectsWatcherDebounceTimer) {
        clearTimeout(projectsWatcherDebounceTimer);
        projectsWatcherDebounceTimer = null;
    }

    await Promise.all(
        projectsWatchers.map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close watcher:', error);
            }
        })
    );
    projectsWatchers = [];

    const debouncedUpdate = (eventType, filePath, provider, rootPath) => {
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
        }

        projectsWatcherDebounceTimer = setTimeout(async () => {
            // Prevent reentrant calls
            if (isGetProjectsRunning) {
                return;
            }

            try {
                isGetProjectsRunning = true;

                // Clear project directory cache when files change
                clearProjectDirectoryCache();

                // Get updated projects list
                const updatedProjects = await getProjects(broadcastProgress);

                // Notify all connected clients about the project changes
                const updateMessage = JSON.stringify({
                    type: 'projects_updated',
                    projects: updatedProjects,
                    timestamp: new Date().toISOString(),
                    changeType: eventType,
                    changedFile: path.relative(rootPath, filePath),
                    watchProvider: provider
                });

                connectedClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updateMessage);
                    }
                });

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
            } finally {
                isGetProjectsRunning = false;
            }
        }, WATCHER_DEBOUNCE_MS);
    };

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            // Initialize chokidar watcher with optimized settings
            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 10, // Reasonable depth limit
                awaitWriteFinish: {
                    stabilityThreshold: 100, // Wait 100ms for file to stabilize
                    pollInterval: 50
                }
            });

            // Set up event listeners
            watcher
                .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                .on('error', (error) => {
                    console.error(`[ERROR] ${provider} watcher error:`, error);
                })
                .on('ready', () => {
                });

            projectsWatchers.push(watcher);
        } catch (error) {
            console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
        }
    }

    if (projectsWatchers.length === 0) {
        console.error('[ERROR] Failed to setup any provider watchers');
    }
}


const app = express();
const server = http.createServer(app);

const ptySessionsMap = new Map();
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (IS_PLATFORM) {
            const user = authenticateWebSocket(null); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Normal mode: verify token
        // Extract token from query parameters or headers
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token') ||
            info.req.headers.authorization?.split(' ')[1];

        // Verify token
        const user = authenticateWebSocket(token);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('[OK] WebSocket authenticated for user:', user.username);
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

app.use(cors({ exposedHeaders: ['X-Refreshed-Token'] }));
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode
    });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// Cursor API Routes (protected)
app.use('/api/cursor', authenticateToken, cursorRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Gemini API Routes (protected)
app.use('/api/gemini', authenticateToken, geminiRoutes);

// Plugins API Routes (protected)
app.use('/api/plugins', authenticateToken, pluginsRoutes);

// Agent template and skill repository routes (protected)
app.use('/api/agent-repository', authenticateToken, agentRepositoryRoutes);

// Agent profile configuration routes (protected)
app.use('/api/agents', authenticateToken, agentsRoutes);

// Unified session messages route (protected)
app.use('/api/sessions', authenticateToken, sessionAgentRoutes);
app.use('/api/sessions', authenticateToken, messagesRoutes);

// Managed Git worktree dispatch routes (protected)
app.use('/api', authenticateToken, worktreeRoutes);

// Unified provider MCP routes (protected)
app.use('/api/providers', authenticateToken, providerRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(APP_ROOT, 'public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(APP_ROOT, 'dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// System update endpoint
app.post('/api/system/update', authenticateToken, async (req, res) => {
    try {
        // Get the project root directory (parent of server directory)
        const projectRoot = APP_ROOT;

        console.log('Starting system update from directory:', projectRoot);

        // Platform deployments use their own update workflow from the project root.
        const updateCommand = IS_PLATFORM
        // In platform, husky and dev dependencies are not needed
            ? 'npm run update:platform'
            : installMode === 'git'
                ? 'git checkout main && git pull && npm install'
                : 'npm install -g mtl-code-ui@latest';

        const updateCwd = IS_PLATFORM || installMode === 'git'
            ? projectRoot
            : os.homedir();

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: updateCwd,
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await getProjects(broadcastProgress);
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset));
        applyCustomSessionNames(result.sessions, 'claude');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const project = await getStandaloneConversationProject(parseInt(limit), parseInt(offset));
        res.json({ project });
    } catch (error) {
        console.error('Error loading standalone conversations:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/conversations/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const project = await getStandaloneConversationProject(parseInt(limit), parseInt(offset));
        res.json({
            sessions: project.sessions,
            cursorSessions: project.cursorSessions,
            codexSessions: project.codexSessions,
            geminiSessions: project.geminiSessions,
            hasMore: project.sessionMeta?.hasMore === true,
            total: project.sessionMeta?.total || 0,
            project,
        });
    } catch (error) {
        console.error('Error loading standalone conversation sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/conversations/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        await deleteSession(getStandaloneConversationProjectName(), sessionId);
        sessionNamesDb.deleteName(sessionId, 'claude');
        sessionAgentBindingsDb.deleteAgent(sessionId, 'claude');
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting standalone conversation ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName } = req.body;
        await renameProject(req.params.projectName, displayName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}`);
        await deleteSession(projectName, sessionId);
        sessionNamesDb.deleteName(sessionId, 'claude');
        sessionAgentBindingsDb.deleteAgent(sessionId, 'claude');
        console.log(`[API] Session ${sessionId} deleted successfully`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Rename session endpoint
app.put('/api/sessions/:sessionId/rename', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId || safeSessionId !== String(sessionId)) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }
        const { summary, provider } = req.body;
        if (!summary || typeof summary !== 'string' || summary.trim() === '') {
            return res.status(400).json({ error: 'Summary is required' });
        }
        if (summary.trim().length > 500) {
            return res.status(400).json({ error: 'Summary must not exceed 500 characters' });
        }
        if (!provider || !VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: `Provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
        }
        sessionNamesDb.setName(safeSessionId, provider, summary.trim());
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error renaming session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/sessions/:sessionId/metadata', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId || safeSessionId !== String(sessionId)) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }
        const { provider = 'claude', pinned, archived } = req.body || {};
        if (!VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: `Provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
        }
        const metadata = {};
        if (typeof pinned === 'boolean') metadata.pinned = pinned;
        if (typeof archived === 'boolean') metadata.archived = archived;
        sessionNamesDb.setMetadata(safeSessionId, provider, metadata);
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error updating session metadata ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint
// force=true to allow removal even when sessions exist
// deleteData=true to also delete session/memory files on disk (destructive)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        const deleteData = req.query.deleteData === 'true';
        await deleteProject(projectName, force, deleteData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search conversations content (SSE streaming)
app.get('/api/search/conversations', authenticateToken, async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const parsedLimit = Number.parseInt(String(req.query.limit), 10);
    const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 100));

    if (query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let closed = false;
    const abortController = new AbortController();
    req.on('close', () => { closed = true; abortController.abort(); });

    try {
        await searchConversations(query, limit, ({ projectResult, totalMatches, scannedProjects, totalProjects }) => {
            if (closed) return;
            if (projectResult) {
                res.write(`event: result\ndata: ${JSON.stringify({ projectResult, totalMatches, scannedProjects, totalProjects })}\n\n`);
            } else {
                res.write(`event: progress\ndata: ${JSON.stringify({ totalMatches, scannedProjects, totalProjects })}\n\n`);
            }
        }, abortController.signal, { standaloneOnly: true });
        if (!closed) {
            res.write(`event: done\ndata: {}\n\n`);
        }
    } catch (error) {
        console.error('Error searching conversations:', error);
        if (!closed) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
        }
    } finally {
        if (!closed) {
            res.end();
        }
    }
});

const expandWorkspacePath = (inputPath) => {
    if (!inputPath) return inputPath;
    if (inputPath === '~') {
        return WORKSPACES_ROOT;
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(WORKSPACES_ROOT, inputPath.slice(2));
    }
    return inputPath;
};

const WINDOWS_DRIVES_PATH = '__WINDOWS_DRIVES__';

const listWindowsDriveRoots = async () => {
    if (process.platform !== 'win32') {
        return [];
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const driveResults = await Promise.all(
        letters.map(async (letter) => {
            const drivePath = `${letter}:\\`;
            try {
                await fsPromises.access(drivePath);
                return {
                    path: drivePath,
                    name: `${letter}:`,
                    type: 'directory'
                };
            } catch (error) {
                return null;
            }
        })
    );

    return driveResults.filter(Boolean);
};

// Browse filesystem endpoint for project suggestions - uses existing getFileTree
app.get('/api/browse-filesystem', authenticateToken, async (req, res) => {
    try {
        const { path: dirPath } = req.query;

        console.log('[API] Browse filesystem request for path:', dirPath);
        console.log('[API] WORKSPACES_ROOT is:', WORKSPACES_ROOT);
        if (dirPath === WINDOWS_DRIVES_PATH) {
            return res.json({
                path: WINDOWS_DRIVES_PATH,
                displayPath: 'This PC',
                suggestions: await listWindowsDriveRoots()
            });
        }

        // Default to home directory if no path provided
        const defaultRoot = WORKSPACES_ROOT;
        let targetPath = dirPath ? expandWorkspacePath(dirPath) : defaultRoot;

        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);

        // Security check - block obvious system-critical workspace locations
        const validation = await validateWorkspacePath(targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const resolvedPath = validation.resolvedPath || targetPath;

        // Security check - ensure path is accessible
        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        // Use existing getFileTree function with shallow depth (only direct children)
        const fileTree = await getFileTree(resolvedPath, 1, 0, false); // maxDepth=1, showHidden=false

        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        // Add common directories if browsing home directory
        const suggestions = [];
        let resolvedWorkspaceRoot = defaultRoot;
        try {
            resolvedWorkspaceRoot = await fsPromises.realpath(defaultRoot);
        } catch (error) {
            // Use default root as-is if realpath fails
        }
        if (resolvedPath === resolvedWorkspaceRoot) {
            const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            suggestions: suggestions
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

app.post('/api/create-folder', authenticateToken, async (req, res) => {
    try {
        const { path: folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const expandedPath = expandWorkspacePath(folderPath);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateWorkspacePath(resolvedInput);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath } = req.query;

        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const { resolved } = await resolveReadableProjectPath(projectName, filePath);

        const content = await fsPromises.readFile(resolved, 'utf8');
        res.json({ content, path: resolved });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const FILE_MENTION_IGNORED_DIRECTORIES = new Set([
    '.git',
    '.hg',
    '.svn',
    '.next',
    '.turbo',
    '.vite',
    '.cache',
    '.gradle',
    '.idea',
    '.vs',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    'Library',
    'Temp',
    'Obj',
    'Logs',
]);
const FILE_MENTION_MAX_VISITED_ENTRIES = 25000;

function toProjectRelativePath(projectRoot, filePath) {
    return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function scoreFileMention(relativePath, query, order) {
    if (!query) {
        return order;
    }

    const normalizedPath = relativePath.toLowerCase();
    const fileName = path.basename(relativePath).toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const queryParts = normalizedQuery.split(/[\\/._\-\s]+/).filter(Boolean);

    if (fileName === normalizedQuery) return 0;
    if (fileName.startsWith(normalizedQuery)) return 1;
    if (normalizedPath.startsWith(normalizedQuery)) return 2;
    if (fileName.includes(normalizedQuery)) return 3;
    if (normalizedPath.includes(normalizedQuery)) return 4;
    if (queryParts.length > 0 && queryParts.every((part) => normalizedPath.includes(part))) return 5;
    return -1;
}

async function searchProjectMentionFiles(projectRoot, rawQuery, limit) {
    const normalizedRoot = path.resolve(projectRoot);
    const query = String(rawQuery || '').trim().replace(/^@+/, '').replace(/\\/g, '/');
    const queue = [normalizedRoot];
    const matches = [];
    let visitedEntries = 0;
    let order = 0;

    while (queue.length > 0 && visitedEntries < FILE_MENTION_MAX_VISITED_ENTRIES) {
        const currentDirectory = queue.shift();
        let entries;

        try {
            entries = await fsPromises.readdir(currentDirectory, { withFileTypes: true });
        } catch (error) {
            if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
                console.warn('[WARN] File mention search skipped directory:', currentDirectory, error?.message || error);
            }
            continue;
        }

        visitedEntries += entries.length;
        const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
        const childDirectories = [];

        for (const entry of sortedEntries) {
            if (FILE_MENTION_IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }

            const entryPath = path.join(currentDirectory, entry.name);

            if (entry.isDirectory()) {
                childDirectories.push(entryPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const relativePath = toProjectRelativePath(normalizedRoot, entryPath);
            const score = scoreFileMention(relativePath, query, order);
            order += 1;
            if (score < 0) {
                continue;
            }

            matches.push({
                name: entry.name,
                path: relativePath,
                relativePath,
                score,
                order,
            });

            if (!query && matches.length >= limit) {
                break;
            }
        }

        if (!query && matches.length >= limit) {
            break;
        }

        queue.push(...childDirectories);
    }

    return matches
        .sort((left, right) => {
            if (left.score !== right.score) return left.score - right.score;
            if (left.path.length !== right.path.length) return left.path.length - right.path.length;
            return left.path.localeCompare(right.path);
        })
        .slice(0, limit)
        .map((file) => ({
            name: file.name,
            path: file.path,
            relativePath: file.relativePath,
        }));
}

app.get('/api/projects/:projectName/files/search', authenticateToken, async (req, res) => {
    try {
        const requestedLimit = parseInt(String(req.query.limit || '60'), 10);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 100)
            : 60;

        const projectRoot = await extractProjectDirectory(req.params.projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        try {
            await fsPromises.access(projectRoot);
        } catch {
            return res.status(404).json({ error: `Project path not found: ${projectRoot}` });
        }

        const files = await searchProjectMentionFiles(projectRoot, req.query.q, limit);
        res.json({
            files,
            query: String(req.query.q || ''),
            limit,
        });
    } catch (error) {
        console.error('[ERROR] File mention search error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve raw file bytes for previews and downloads.
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: filePath } = req.query;

        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const { resolved } = await resolveReadableProjectPath(projectName, filePath);

        // Check if file exists
        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(resolved) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, content } = req.body;


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const { resolved } = await resolveReadableProjectPath(projectName, filePath);

        // Write the new content
        await fsPromises.writeFile(resolved, content, 'utf8');

        res.json({
            success: true,
            path: resolved,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {

        // Using fsPromises from import

        // Use extractProjectDirectory to get the actual project path
        let actualPath;
        try {
            actualPath = await extractProjectDirectory(req.params.projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            // Fallback to simple dash replacement
            actualPath = req.params.projectName.replace(/-/g, '/');
        }

        // Check if path exists
        try {
            await fsPromises.access(actualPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${actualPath}` });
        }

        const files = await getFileTree(actualPath, 10, 0, true);
        res.json(files);
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// FILE OPERATIONS API ENDPOINTS
// ============================================================================

/**
 * Validate that a path is within the project root
 * @param {string} projectRoot - The project root path
 * @param {string} targetPath - The path to validate
 * @returns {{ valid: boolean, resolved?: string, error?: string }}
 */
function validatePathInProject(projectRoot, targetPath) {
    const resolved = path.isAbsolute(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(projectRoot, targetPath);
    if (!isPathInsideRoot(projectRoot, resolved)) {
        return { valid: false, error: 'Path must be under project root' };
    }
    return { valid: true, resolved };
}

function normalizePathForCompare(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(projectRoot, targetPath) {
    const normalizedRoot = normalizePathForCompare(projectRoot);
    const normalizedTarget = normalizePathForCompare(targetPath);
    const rootWithSeparator = normalizedRoot.endsWith(path.sep)
        ? normalizedRoot
        : `${normalizedRoot}${path.sep}`;

    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSeparator);
}

async function resolvePathInRegisteredProjects(targetPath) {
    if (!path.isAbsolute(targetPath)) {
        return null;
    }

    const resolvedTarget = path.resolve(targetPath);
    const projects = await getProjects();

    for (const project of projects) {
        const projectRoot = typeof project.fullPath === 'string'
            ? project.fullPath
            : typeof project.path === 'string'
                ? project.path
                : '';

        if (!projectRoot) {
            continue;
        }

        if (isPathInsideRoot(projectRoot, resolvedTarget)) {
            return {
                resolved: resolvedTarget,
                projectRoot: path.resolve(projectRoot),
                projectName: project.name,
                source: 'registered-project',
            };
        }
    }

    return null;
}

async function resolveReadableProjectPath(projectName, targetPath) {
    const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
    if (!projectRoot) {
        throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    }

    const validation = validatePathInProject(projectRoot, targetPath);
    if (validation.valid) {
        return {
            resolved: validation.resolved,
            projectRoot: path.resolve(projectRoot),
            projectName,
            source: 'current-project',
        };
    }

    const registeredProjectPath = await resolvePathInRegisteredProjects(targetPath);
    if (registeredProjectPath) {
        return registeredProjectPath;
    }

    throw Object.assign(new Error(validation.error || 'Path must be under project root'), { statusCode: 403 });
}

/**
 * Validate filename - check for invalid characters
 * @param {string} name - The filename to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFilename(name) {
    if (!name || !name.trim()) {
        return { valid: false, error: 'Filename cannot be empty' };
    }
    // Check for invalid characters (Windows + Unix)
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'Filename contains invalid characters' };
    }
    // Check for reserved names (Windows)
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(name)) {
        return { valid: false, error: 'Filename is a reserved name' };
    }
    // Check for dots only
    if (/^\.+$/.test(name)) {
        return { valid: false, error: 'Filename cannot be only dots' };
    }
    return { valid: true };
}

function createVersionProbe(command, args = ['--version']) {
    return new Promise((resolve) => {
        let settled = false;
        let timeout;
        let stdout = '';
        let stderr = '';
        const child = spawn(command, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve({
                ...result,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
            });
        };

        timeout = setTimeout(() => {
            child.kill();
            finish({ ok: false, error: 'Probe timed out' });
        }, 3000);

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            finish({ ok: false, error: error.message });
        });
        child.on('close', (code) => {
            finish({ ok: code === 0, code });
        });
    });
}

function getLocalToolCandidates() {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';

    const candidates = {
        vscode: [
            { command: process.platform === 'win32' ? 'code.cmd' : 'code', label: 'Visual Studio Code', source: 'PATH' },
            { command: 'code', label: 'Visual Studio Code', source: 'PATH' },
        ],
        cursor: [
            { command: process.platform === 'win32' ? 'cursor.cmd' : 'cursor', label: 'Cursor', source: 'PATH' },
            { command: 'cursor', label: 'Cursor', source: 'PATH' },
        ],
    };

    if (process.platform === 'win32') {
        candidates.vscode.push(
            { command: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'Visual Studio Code', source: 'LOCALAPPDATA' },
            { command: path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'Visual Studio Code', source: 'Program Files' },
            { command: path.join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'), label: 'Visual Studio Code', source: 'Program Files (x86)' },
            { command: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'), label: 'Visual Studio Code', source: 'LOCALAPPDATA', fileOnly: true },
            { command: path.join(programFiles, 'Microsoft VS Code', 'Code.exe'), label: 'Visual Studio Code', source: 'Program Files', fileOnly: true },
        );
        candidates.cursor.push(
            { command: path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'), label: 'Cursor', source: 'LOCALAPPDATA' },
            { command: path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'), label: 'Cursor', source: 'LOCALAPPDATA', fileOnly: true },
        );
    }

    return candidates;
}

async function diagnoseLocalTool(toolId) {
    const candidates = getLocalToolCandidates()[toolId] || [];

    for (const candidate of candidates) {
        if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) {
            continue;
        }

        if (candidate.fileOnly) {
            return {
                id: toolId,
                label: candidate.label,
                available: true,
                command: candidate.command,
                source: candidate.source,
                version: null,
            };
        }

        const probe = await createVersionProbe(candidate.command);
        if (probe.ok) {
            return {
                id: toolId,
                label: candidate.label,
                available: true,
                command: candidate.command,
                source: candidate.source,
                version: probe.stdout.split(/\r?\n/)[0] || null,
            };
        }
    }

    return {
        id: toolId,
        label: toolId === 'cursor' ? 'Cursor' : 'Visual Studio Code',
        available: false,
        command: null,
        source: null,
        version: null,
    };
}

async function getLocalToolDiagnostics() {
    const [vscode, cursor] = await Promise.all([
        diagnoseLocalTool('vscode'),
        diagnoseLocalTool('cursor'),
    ]);

    return { tools: [vscode, cursor] };
}

function buildEditorOpenArgs(resolvedPath, line, column, isDirectory) {
    if (isDirectory) {
        return [resolvedPath];
    }

    const parsedLine = Number.parseInt(String(line || ''), 10);
    const parsedColumn = Number.parseInt(String(column || ''), 10);
    const target = Number.isFinite(parsedLine) && parsedLine > 0
        ? `${resolvedPath}:${parsedLine}:${Number.isFinite(parsedColumn) && parsedColumn > 0 ? parsedColumn : 1}`
        : resolvedPath;

    return ['-g', target];
}

app.get('/api/local-tools', authenticateToken, async (req, res) => {
    try {
        res.json(await getLocalToolDiagnostics());
    } catch (error) {
        console.error('Error diagnosing local tools:', error);
        res.status(500).json({ error: error.message || 'Failed to diagnose local tools' });
    }
});

app.post('/api/local-tools/open-file', authenticateToken, async (req, res) => {
    try {
        const {
            tool = 'vscode',
            filePath,
            projectName,
            line,
            column,
        } = req.body || {};

        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'filePath is required' });
        }

        const targetTool = tool === 'cursor' ? 'cursor' : 'vscode';
        const resolvedInfo = projectName
            ? await resolveReadableProjectPath(projectName, filePath)
            : await resolvePathInRegisteredProjects(filePath);

        if (!resolvedInfo) {
            return res.status(403).json({ error: 'File must be under a registered project root' });
        }

        const stats = await fsPromises.stat(resolvedInfo.resolved);
        const diagnostics = await getLocalToolDiagnostics();
        const selectedTool = diagnostics.tools.find((item) => item.id === targetTool);

        if (!selectedTool?.available || !selectedTool.command) {
            return res.status(404).json({
                error: targetTool === 'cursor'
                    ? 'Cursor is not available on this machine'
                    : 'Visual Studio Code is not available on this machine',
                diagnostics,
            });
        }

        const args = buildEditorOpenArgs(resolvedInfo.resolved, line, column, stats.isDirectory());
        const child = spawn(selectedTool.command, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();

        res.json({
            success: true,
            tool: selectedTool,
            path: resolvedInfo.resolved,
            projectName: resolvedInfo.projectName,
        });
    } catch (error) {
        console.error('Error opening file in local tool:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to open file' });
        }
    }
});

// POST /api/projects/:projectName/files/create - Create new file or directory
app.post('/api/projects/:projectName/files/create', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: parentPath, type, name } = req.body;

        // Validate input
        if (!name || !type) {
            return res.status(400).json({ error: 'Name and type are required' });
        }

        if (!['file', 'directory'].includes(type)) {
            return res.status(400).json({ error: 'Type must be "file" or "directory"' });
        }

        const nameValidation = validateFilename(name);
        if (!nameValidation.valid) {
            return res.status(400).json({ error: nameValidation.error });
        }

        // Get project root
        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Build and validate target path
        const targetDir = parentPath || '';
        const targetPath = targetDir ? path.join(targetDir, name) : name;
        const validation = validatePathInProject(projectRoot, targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }

        const resolvedPath = validation.resolved;

        // Check if already exists
        try {
            await fsPromises.access(resolvedPath);
            return res.status(409).json({ error: `${type === 'file' ? 'File' : 'Directory'} already exists` });
        } catch {
            // Doesn't exist, which is what we want
        }

        // Create file or directory
        if (type === 'directory') {
            await fsPromises.mkdir(resolvedPath, { recursive: false });
        } else {
            // Ensure parent directory exists
            const parentDir = path.dirname(resolvedPath);
            try {
                await fsPromises.access(parentDir);
            } catch {
                await fsPromises.mkdir(parentDir, { recursive: true });
            }
            await fsPromises.writeFile(resolvedPath, '', 'utf8');
        }

        res.json({
            success: true,
            path: resolvedPath,
            name,
            type,
            message: `${type === 'file' ? 'File' : 'Directory'} created successfully`
        });
    } catch (error) {
        console.error('Error creating file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Parent directory not found' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// PUT /api/projects/:projectName/files/rename - Rename file or directory
app.put('/api/projects/:projectName/files/rename', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { oldPath, newName } = req.body;

        // Validate input
        if (!oldPath || !newName) {
            return res.status(400).json({ error: 'oldPath and newName are required' });
        }

        const nameValidation = validateFilename(newName);
        if (!nameValidation.valid) {
            return res.status(400).json({ error: nameValidation.error });
        }

        // Get project root
        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Validate old path
        const oldValidation = validatePathInProject(projectRoot, oldPath);
        if (!oldValidation.valid) {
            return res.status(403).json({ error: oldValidation.error });
        }

        const resolvedOldPath = oldValidation.resolved;

        // Check if old path exists
        try {
            await fsPromises.access(resolvedOldPath);
        } catch {
            return res.status(404).json({ error: 'File or directory not found' });
        }

        // Build and validate new path
        const parentDir = path.dirname(resolvedOldPath);
        const resolvedNewPath = path.join(parentDir, newName);
        const newValidation = validatePathInProject(projectRoot, resolvedNewPath);
        if (!newValidation.valid) {
            return res.status(403).json({ error: newValidation.error });
        }

        // Check if new path already exists
        try {
            await fsPromises.access(resolvedNewPath);
            return res.status(409).json({ error: 'A file or directory with this name already exists' });
        } catch {
            // Doesn't exist, which is what we want
        }

        // Rename
        await fsPromises.rename(resolvedOldPath, resolvedNewPath);

        res.json({
            success: true,
            oldPath: resolvedOldPath,
            newPath: resolvedNewPath,
            newName,
            message: 'Renamed successfully'
        });
    } catch (error) {
        console.error('Error renaming file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EXDEV') {
            res.status(400).json({ error: 'Cannot move across different filesystems' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// DELETE /api/projects/:projectName/files - Delete file or directory
app.delete('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: targetPath, type } = req.body;

        // Validate input
        if (!targetPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        // Get project root
        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Validate path
        const validation = validatePathInProject(projectRoot, targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }

        const resolvedPath = validation.resolved;

        // Check if path exists and get stats
        let stats;
        try {
            stats = await fsPromises.stat(resolvedPath);
        } catch {
            return res.status(404).json({ error: 'File or directory not found' });
        }

        // Prevent deleting the project root itself
        if (resolvedPath === path.resolve(projectRoot)) {
            return res.status(403).json({ error: 'Cannot delete project root directory' });
        }

        // Delete based on type
        if (stats.isDirectory()) {
            await fsPromises.rm(resolvedPath, { recursive: true, force: true });
        } else {
            await fsPromises.unlink(resolvedPath);
        }

        res.json({
            success: true,
            path: resolvedPath,
            type: stats.isDirectory() ? 'directory' : 'file',
            message: 'Deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'ENOTEMPTY') {
            res.status(400).json({ error: 'Directory is not empty' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// POST /api/projects/:projectName/files/upload - Upload files
// Dynamic import of multer for file uploads
const uploadFilesHandler = async (req, res) => {
    // Dynamic import of multer
    const multer = (await import('multer')).default;

    const uploadMiddleware = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, os.tmpdir());
            },
            filename: (req, file, cb) => {
                // Use a unique temp name, but preserve original name in file.originalname
                // Note: file.originalname may contain path separators for folder uploads
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                // For temp file, just use a safe unique name without the path
                cb(null, `upload-${uniqueSuffix}`);
            }
        }),
        limits: {
            fileSize: 50 * 1024 * 1024, // 50MB limit
            files: 20 // Max 20 files at once
        }
    });

    // Use multer middleware
    uploadMiddleware.array('files', 20)(req, res, async (err) => {
        if (err) {
            console.error('Multer error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ error: 'Too many files. Maximum is 20 files.' });
            }
            return res.status(500).json({ error: err.message });
        }

        try {
            const { projectName } = req.params;
            const { targetPath, relativePaths } = req.body;

            // Parse relative paths if provided (for folder uploads)
            let filePaths = [];
            if (relativePaths) {
                try {
                    filePaths = JSON.parse(relativePaths);
                } catch (e) {
                    console.log('[DEBUG] Failed to parse relativePaths:', relativePaths);
                }
            }

            console.log('[DEBUG] File upload request:', {
                projectName,
                targetPath: JSON.stringify(targetPath),
                targetPathType: typeof targetPath,
                filesCount: req.files?.length,
                relativePaths: filePaths
            });

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            // Get project root
            const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
            if (!projectRoot) {
                return res.status(404).json({ error: 'Project not found' });
            }

            console.log('[DEBUG] Project root:', projectRoot);

            // Validate and resolve target path
            // If targetPath is empty or '.', use project root directly
            const targetDir = targetPath || '';
            let resolvedTargetDir;

            console.log('[DEBUG] Target dir:', JSON.stringify(targetDir));

            if (!targetDir || targetDir === '.' || targetDir === './') {
                // Empty path means upload to project root
                resolvedTargetDir = path.resolve(projectRoot);
                console.log('[DEBUG] Using project root as target:', resolvedTargetDir);
            } else {
                const validation = validatePathInProject(projectRoot, targetDir);
                if (!validation.valid) {
                    console.log('[DEBUG] Path validation failed:', validation.error);
                    return res.status(403).json({ error: validation.error });
                }
                resolvedTargetDir = validation.resolved;
                console.log('[DEBUG] Resolved target dir:', resolvedTargetDir);
            }

            // Ensure target directory exists
            try {
                await fsPromises.access(resolvedTargetDir);
            } catch {
                await fsPromises.mkdir(resolvedTargetDir, { recursive: true });
            }

            // Move uploaded files from temp to target directory
            const uploadedFiles = [];
            console.log('[DEBUG] Processing files:', req.files.map(f => ({ originalname: f.originalname, path: f.path })));
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                // Use relative path if provided (for folder uploads), otherwise use originalname
                const fileName = (filePaths && filePaths[i]) ? filePaths[i] : file.originalname;
                console.log('[DEBUG] Processing file:', fileName, '(originalname:', file.originalname + ')');
                const destPath = path.join(resolvedTargetDir, fileName);

                // Validate destination path
                const destValidation = validatePathInProject(projectRoot, destPath);
                if (!destValidation.valid) {
                    console.log('[DEBUG] Destination validation failed for:', destPath);
                    // Clean up temp file
                    await fsPromises.unlink(file.path).catch(() => {});
                    continue;
                }

                // Ensure parent directory exists (for nested files from folder upload)
                const parentDir = path.dirname(destPath);
                try {
                    await fsPromises.access(parentDir);
                } catch {
                    await fsPromises.mkdir(parentDir, { recursive: true });
                }

                // Move file (copy + unlink to handle cross-device scenarios)
                await fsPromises.copyFile(file.path, destPath);
                await fsPromises.unlink(file.path);

                uploadedFiles.push({
                    name: fileName,
                    path: destPath,
                    size: file.size,
                    mimeType: file.mimetype
                });
            }

            res.json({
                success: true,
                files: uploadedFiles,
                targetPath: resolvedTargetDir,
                message: `Uploaded ${uploadedFiles.length} file(s) successfully`
            });
        } catch (error) {
            console.error('Error uploading files:', error);
            // Clean up any remaining temp files
            if (req.files) {
                for (const file of req.files) {
                    await fsPromises.unlink(file.path).catch(() => {});
                }
            }
            if (error.code === 'EACCES') {
                res.status(403).json({ error: 'Permission denied' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });
};

app.post('/api/projects/:projectName/files/upload', authenticateToken, uploadFilesHandler);

/**
 * Proxy an authenticated client WebSocket to a plugin's internal WS server.
 * Auth is enforced by verifyClient before this function is reached.
 */
function handlePluginWsProxy(clientWs, pathname) {
    const pluginName = pathname.replace('/plugin-ws/', '');
    if (!pluginName || /[^a-zA-Z0-9_-]/.test(pluginName)) {
        clientWs.close(4400, 'Invalid plugin name');
        return;
    }

    const port = getPluginPort(pluginName);
    if (!port) {
        clientWs.close(4404, 'Plugin not running');
        return;
    }

    const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    upstream.on('open', () => {
        console.log(`[Plugins] WS proxy connected to "${pluginName}" on port ${port}`);
    });

    // Relay messages bidirectionally
    upstream.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });
    clientWs.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    });

    // Propagate close in both directions
    upstream.on('close', () => { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(); });
    clientWs.on('close', () => { if (upstream.readyState === WebSocket.OPEN) upstream.close(); });

    upstream.on('error', (err) => {
        console.error(`[Plugins] WS proxy error for "${pluginName}":`, err.message);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(4502, 'Upstream error');
    });
    clientWs.on('error', () => {
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
    });
}

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/shell') {
        handleShellConnection(ws);
    } else if (pathname === '/ws') {
        handleChatConnection(ws, request);
    } else if (pathname.startsWith('/plugin-ws/')) {
        handlePluginWsProxy(ws, pathname);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 *
 * Provider files use `createNormalizedMessage()` from `shared/utils.js` and
 * adapter `normalizeMessage()` to produce unified NormalizedMessage events.
 * The writer simply serialises and sends.
 */
class WebSocketWriter {
    constructor(ws, userId = null) {
        this.ws = ws;
        this.sessionId = null;
        this.userId = userId;
        this.isWebSocketWriter = true;  // Marker for transport detection
    }

    send(data) {
        if (this.ws.readyState === 1) { // WebSocket.OPEN
            this.ws.send(JSON.stringify(data));
        }
    }

    updateWebSocket(newRawWs) {
        this.ws = newRawWs;
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    getSessionId() {
        return this.sessionId;
    }
}

function getProviderFromCommandType(type) {
    if (type === 'cursor-command') return 'cursor';
    if (type === 'codex-command') return 'codex';
    if (type === 'gemini-command') return 'gemini';
    return 'claude';
}

function getConcreteCommandSessionId(data) {
    const sessionId = data?.options?.sessionId || data?.sessionId || null;
    if (!sessionId || String(sessionId).startsWith('new-session-')) {
        return null;
    }
    return String(sessionId);
}

function normalizeRuntimeToolSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    return {
        allowedTools: Array.isArray(source.allowedTools)
            ? source.allowedTools.filter((entry) => typeof entry === 'string' && entry.trim())
            : [],
        disallowedTools: Array.isArray(source.disallowedTools)
            ? source.disallowedTools.filter((entry) => typeof entry === 'string' && entry.trim())
            : [],
        skipPermissions: Boolean(source.skipPermissions),
    };
}

function createRuntimePermissionSnapshot(data) {
    const options = data?.options && typeof data.options === 'object' ? data.options : {};
    const toolsSettings = normalizeRuntimeToolSettings(options.toolsSettings);
    const permissionMode = typeof options.permissionMode === 'string' && options.permissionMode.trim()
        ? options.permissionMode.trim()
        : 'default';
    const skipPermissions = Boolean(toolsSettings.skipPermissions || options.skipPermissions);
    const bypassPermissions = permissionMode !== 'plan' && Boolean(
        skipPermissions || permissionMode === 'bypassPermissions'
    );
    const allowedSet = new Set(toolsSettings.allowedTools.map((tool) => tool.trim()).filter(Boolean));
    const conflicts = toolsSettings.disallowedTools
        .map((tool) => tool.trim())
        .filter((tool) => tool && allowedSet.has(tool))
        .map((tool) => `${tool} is both allowed and disallowed`);

    return {
        permissionMode,
        skipPermissions,
        allowedTools: toolsSettings.allowedTools,
        disallowedTools: toolsSettings.disallowedTools,
        bypassPermissions,
        sources: {
            global: {
                allowedTools: toolsSettings.allowedTools,
                disallowedTools: toolsSettings.disallowedTools,
                skipPermissions: toolsSettings.skipPermissions,
            },
            session: {
                permissionMode,
                skipPermissions: Boolean(options.skipPermissions),
            },
            project: {
                projectPath: options.projectPath || options.cwd || '',
            },
        },
        conflicts,
    };
}

function createRuntimeDiagnosticsPayload(data) {
    const diagnostics = data?.options?.runtimeDiagnostics;
    if (!diagnostics || typeof diagnostics !== 'object') {
        return null;
    }

    return {
        ...diagnostics,
        provider: getProviderFromCommandType(data?.type),
        sessionId: data?.options?.sessionId || data?.sessionId || null,
        projectPath: data?.options?.projectPath || data?.options?.cwd || '',
        permissions: createRuntimePermissionSnapshot(data),
    };
}

function summarizeMcpBindings(bindings = []) {
    if (!Array.isArray(bindings)) {
        return [];
    }
    return bindings
        .filter((binding) => String(binding?.app || '').startsWith('MCP: '))
        .map((binding) => {
            const serverName = String(binding.app || '').replace(/^MCP:\s*/, '').trim();
            return {
                slot: binding.slot || '',
                serverName,
                status: binding.status || 'optional',
                runtimeToolsStatus: 'discovered-after-session-start',
                message: 'Configuration is bound; MTL-Code runtime discovers MCP tools when the session starts.',
            };
        });
}

function emitRuntimeDiagnostics(writer, data) {
    const payload = createRuntimeDiagnosticsPayload(data);
    if (!payload) {
        return;
    }

    console.log('[Agent Runtime]', JSON.stringify(payload));
    writer.send(createNormalizedMessage({
        kind: 'status',
        text: 'agent_runtime_debug',
        provider: payload.provider || 'claude',
        sessionId: payload.sessionId || null,
        agentRuntime: payload,
    }));
}

function normalizeUploadedChatFiles(files) {
    if (!Array.isArray(files)) {
        return [];
    }

    return files
        .map((file) => {
            const item = file && typeof file === 'object' ? file : {};
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            const filePath = typeof item.path === 'string' ? item.path.trim() : '';
            if (!filePath) {
                return null;
            }
            return {
                name: name || path.basename(filePath),
                path: filePath,
                size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
                mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
            };
        })
        .filter(Boolean)
        .slice(0, 10);
}

function formatUploadedChatFilesNote(files) {
    if (!files.length) {
        return '';
    }

    const lines = files.map((file, index) => {
        const detail = file.mimeType ? ` (${file.mimeType})` : '';
        return `${index + 1}. ${file.name}${detail}: ${file.path}`;
    });

    return [
        '[Uploaded files provided at the following local paths.]',
        'Use the normal file tools to inspect these files when they are relevant to the user request.',
        ...lines,
    ].join('\n');
}

function applyUploadedFilesToChatCommand(data) {
    const files = normalizeUploadedChatFiles(data?.options?.files);
    if (files.length === 0) {
        return data;
    }

    const note = formatUploadedChatFilesNote(files);
    const command = typeof data.command === 'string' ? data.command : '';
    const nextCommand = command.trim()
        ? `${command}\n\n${note}`
        : `请查看我上传的附件。\n\n${note}`;

    return {
        ...data,
        command: nextCommand,
        options: {
            ...(data.options || {}),
            files,
        },
    };
}

function normalizeModelProfileId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function applyAgentRuntimeToChatCommand(data) {
    const provider = getProviderFromCommandType(data?.type);
    const openMythosRuntime = provider === 'claude'
        ? await readResolvedOpenMythosRuntimeConfig().catch((error) => {
            console.warn('[OpenMythos Runtime] Failed to read settings:', error?.message || error);
            return null;
        })
        : null;
    const concreteSessionId = getConcreteCommandSessionId(data);
    const allowSessionAgentBinding = data?.options?.allowSessionAgentBinding === true;
    const storedBinding = allowSessionAgentBinding && concreteSessionId
        ? sessionAgentBindingsDb.getBinding(concreteSessionId, provider)
        : null;
    const optionModelProfileId = normalizeModelProfileId(data?.options?.modelProfileId);
    const optionConfiguration = (
        Array.isArray(data?.options?.agentAppBindings)
        || Array.isArray(data?.options?.sessionSkills)
        || optionModelProfileId
    )
        ? {
            ...(Array.isArray(data?.options?.agentAppBindings) ? { appBindings: data.options.agentAppBindings } : {}),
            ...(Array.isArray(data?.options?.sessionSkills) ? { skills: data.options.sessionSkills } : {}),
            ...(optionModelProfileId ? { modelProfileId: optionModelProfileId } : {}),
        }
        : null;
    const sessionConfiguration = optionConfiguration || storedBinding?.configuration || null;
    const sessionModelProfileId = normalizeModelProfileId(
        optionModelProfileId || sessionConfiguration?.modelProfileId || ''
    );
    const agentId = data?.options?.agentId || (allowSessionAgentBinding ? storedBinding?.agentId : '') || '';
    const sessionSkills = Array.isArray(sessionConfiguration?.skills)
        ? sessionConfiguration.skills.filter((skill) => typeof skill === 'string' && skill.trim()).slice(0, 60)
        : [];
    if (!agentId) {
        if (sessionSkills.length === 0) {
            if (sessionModelProfileId && allowSessionAgentBinding && concreteSessionId) {
                sessionAgentBindingsDb.setAgent(concreteSessionId, provider, '', {
                    ...(sessionConfiguration || {}),
                    modelProfileId: sessionModelProfileId,
                });
            }
            if (provider !== 'claude' && !sessionModelProfileId) {
                return data;
            }
            return {
                ...data,
                options: {
                    ...(data.options || {}),
                    ...(sessionModelProfileId ? { modelProfileId: sessionModelProfileId } : {}),
                    runtimeDiagnostics: {
                        type: 'runtime',
                        allowSessionAgentBinding,
                        agentId: '',
                        agentName: '',
                        appBindings: [],
                        mcpBindings: [],
                        sessionSkills: [],
                        effectiveSkills: [],
                        skillDetails: [],
                        skillPromptLength: 0,
                        ragExcerptCount: 0,
                        ragPromptLength: 0,
                        ragExcerpts: [],
                        mcpDiagnosticsSummary: [],
                        appendSystemPromptLength: 0,
                        contextWindowTokens: data?.options?.contextWindowTokens || null,
                        model: data?.options?.model || '',
                        modelProfileId: sessionModelProfileId || '',
                        openMythosRuntime,
                    },
                },
            };
        }

        const skillReferences = await resolveSkillReferences(sessionSkills, {
            query: typeof data.command === 'string' ? data.command : '',
            workspacePath: data?.options?.projectPath || data?.options?.cwd || '',
        });
        const appendSystemPrompt = skillReferences.prompt;
        if (!appendSystemPrompt) {
            return data;
        }

        if (allowSessionAgentBinding && concreteSessionId) {
            sessionAgentBindingsDb.setAgent(concreteSessionId, provider, '', sessionConfiguration);
        }

        const options = {
            ...(data.options || {}),
            modelProfileId: sessionModelProfileId || data?.options?.modelProfileId || '',
            sessionSkills,
            runtimeDiagnostics: {
                type: 'skills',
                allowSessionAgentBinding,
                agentId: '',
                agentName: '',
                appBindings: [],
                mcpBindings: [],
                sessionSkills,
                effectiveSkills: sessionSkills,
                skillDetails: skillReferences.details,
                skillPromptLength: skillReferences.promptLength,
                ragExcerptCount: 0,
                ragPromptLength: 0,
                ragExcerpts: [],
                mcpDiagnosticsSummary: [],
                appendSystemPromptLength: appendSystemPrompt.length,
                contextWindowTokens: data?.options?.contextWindowTokens || null,
                model: data?.options?.model || '',
                modelProfileId: sessionModelProfileId || '',
                openMythosRuntime,
            },
        };

        if (data.type === 'claude-command') {
            options.appendSystemPrompt = appendSystemPrompt;
            return { ...data, options };
        }

        const command = typeof data.command === 'string' ? data.command : '';
        return {
            ...data,
            command: [appendSystemPrompt, '', 'User task:', command].join('\n'),
            options,
        };
    }

    const runtime = await resolveAgentRuntime(agentId, {
        query: typeof data.command === 'string' ? data.command : '',
        sessionConfiguration,
        workspacePath: data?.options?.projectPath || data?.options?.cwd || '',
    });
    if (!runtime) {
        return data;
    }
    const skillReferences = await resolveSkillReferences(runtime.agent.skills, {
        query: typeof data.command === 'string' ? data.command : '',
        workspacePath: data?.options?.projectPath || data?.options?.cwd || '',
    });

    if (allowSessionAgentBinding && concreteSessionId) {
        sessionAgentBindingsDb.setAgent(concreteSessionId, provider, runtime.agent.id, sessionConfiguration);
    }

    const options = {
        ...(data.options || {}),
        modelProfileId: sessionModelProfileId || data?.options?.modelProfileId || '',
        agentId: runtime.agent.id,
        agentRuntime: {
            id: runtime.agent.id,
            name: runtime.agent.name,
            version: runtime.agent.version,
        },
        runtimeDiagnostics: {
            type: 'agent',
            allowSessionAgentBinding,
            agentId: runtime.agent.id,
            agentName: runtime.agent.name,
            appBindings: runtime.agent.appBindings,
            mcpBindings: runtime.agent.appBindings.filter((binding) => String(binding?.app || '').startsWith('MCP: ')),
            mcpDiagnosticsSummary: summarizeMcpBindings(runtime.agent.appBindings),
            sessionSkills,
            effectiveSkills: runtime.agent.skills,
            skillDetails: skillReferences.details,
            skillPromptLength: skillReferences.promptLength,
            ragExcerptCount: runtime.knowledgeDiagnostics?.ragExcerptCount || 0,
            ragPromptLength: runtime.knowledgeDiagnostics?.ragPromptLength || 0,
            ragExcerpts: runtime.knowledgeDiagnostics?.ragExcerpts || [],
            appendSystemPromptLength: runtime.appendSystemPrompt.length,
            contextWindowTokens: runtime.contextWindowTokens,
            model: runtime.model || data?.options?.model || '',
            modelProfileId: sessionModelProfileId || '',
            openMythosRuntime,
        },
        contextWindowTokens: runtime.contextWindowTokens,
    };

    if (data.type === 'claude-command' && runtime.model) {
        options.model = runtime.model;
    }

    if (data.type === 'claude-command') {
        options.appendSystemPrompt = runtime.appendSystemPrompt;
        return { ...data, options };
    }

    const command = typeof data.command === 'string' ? data.command : '';
    return {
        ...data,
        command: [runtime.appendSystemPrompt, '', 'User task:', command].join('\n'),
        options,
    };
}

// Handle chat WebSocket connections
function handleChatConnection(ws, request) {
    console.log('[INFO] Chat WebSocket connected');

    // Add to connected clients for project updates
    connectedClients.add(ws);

    // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
    const writer = new WebSocketWriter(ws, request?.user?.id ?? request?.user?.userId ?? null);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'claude-command') {
                const commandData = applyUploadedFilesToChatCommand(await applyAgentRuntimeToChatCommand(data));
                emitRuntimeDiagnostics(writer, commandData);
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');

                // Use Claude Agents SDK
                await queryClaudeSDK(commandData.command, commandData.options, writer);
            } else if (data.type === 'cursor-command') {
                const commandData = applyUploadedFilesToChatCommand(await applyAgentRuntimeToChatCommand(data));
                emitRuntimeDiagnostics(writer, commandData);
                console.log('[DEBUG] Cursor message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                await spawnCursor(commandData.command, commandData.options, writer);
            } else if (data.type === 'codex-command') {
                const commandData = applyUploadedFilesToChatCommand(await applyAgentRuntimeToChatCommand(data));
                emitRuntimeDiagnostics(writer, commandData);
                console.log('[DEBUG] Codex message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                await queryCodex(commandData.command, commandData.options, writer);
            } else if (data.type === 'gemini-command') {
                const commandData = applyUploadedFilesToChatCommand(await applyAgentRuntimeToChatCommand(data));
                emitRuntimeDiagnostics(writer, commandData);
                console.log('[DEBUG] Gemini message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                await spawnGemini(commandData.command, commandData.options, writer);
            } else if (data.type === 'cursor-resume') {
                // Backward compatibility: treat as cursor-command with resume and no prompt
                console.log('[DEBUG] Cursor resume session (compat):', data.sessionId);
                await spawnCursor('', {
                    sessionId: data.sessionId,
                    resume: true,
                    cwd: data.options?.cwd
                }, writer);
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = data.provider || 'claude';
                let success;

                if (provider === 'cursor') {
                    success = abortCursorSession(data.sessionId);
                } else if (provider === 'codex') {
                    success = abortCodexSession(data.sessionId);
                } else if (provider === 'gemini') {
                    success = abortGeminiSession(data.sessionId);
                } else {
                    // Use Claude Agents SDK
                    success = await abortClaudeSDKSession(data.sessionId);
                }

                writer.send(createNormalizedMessage({ kind: 'complete', exitCode: success ? 0 : 1, aborted: true, success, sessionId: data.sessionId, provider }));
            } else if (data.type === 'claude-permission-response') {
                // Relay UI approval decisions back into the SDK control flow.
                // This does not persist permissions; it only resolves the in-flight request,
                // introduced so the SDK can resume once the user clicks Allow/Deny.
                if (data.requestId) {
                    resolveToolApproval(data.requestId, {
                        allow: Boolean(data.allow),
                        updatedInput: data.updatedInput,
                        message: data.message,
                        rememberEntry: data.rememberEntry
                    });
                }
            } else if (data.type === 'cursor-abort') {
                console.log('[DEBUG] Abort Cursor session:', data.sessionId);
                const success = abortCursorSession(data.sessionId);
                writer.send(createNormalizedMessage({ kind: 'complete', exitCode: success ? 0 : 1, aborted: true, success, sessionId: data.sessionId, provider: 'cursor' }));
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const provider = data.provider || 'claude';
                const sessionId = data.sessionId;
                let isActive;

                if (provider === 'cursor') {
                    isActive = isCursorSessionActive(sessionId);
                } else if (provider === 'codex') {
                    isActive = isCodexSessionActive(sessionId);
                } else if (provider === 'gemini') {
                    isActive = isGeminiSessionActive(sessionId);
                } else {
                    // Use Claude Agents SDK
                    isActive = isClaudeSDKSessionActive(sessionId);
                    if (isActive) {
                        // Reconnect the session's writer to the new WebSocket so
                        // subsequent SDK output flows to the refreshed client.
                        reconnectSessionWriter(sessionId, ws);
                    }
                }

                writer.send({
                    type: 'session-status',
                    sessionId,
                    provider,
                    isProcessing: isActive
                });
            } else if (data.type === 'get-pending-permissions') {
                // Return pending permission requests for a session
                const sessionId = data.sessionId;
                if (sessionId && isClaudeSDKSessionActive(sessionId)) {
                    const pending = getPendingApprovalsForSession(sessionId);
                    writer.send({
                        type: 'pending-permissions-response',
                        sessionId,
                        data: pending
                    });
                }
            } else if (data.type === 'get-active-sessions') {
                // Get all currently active sessions
                const activeSessions = {
                    claude: getActiveClaudeSDKSessions(),
                    cursor: getActiveCursorSessions(),
                    codex: getActiveCodexSessions(),
                    gemini: getActiveGeminiSessions()
                };
                writer.send({
                    type: 'active-sessions',
                    sessions: activeSessions
                });
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            writer.send({
                type: 'error',
                error: error.message
            });
        }
    });

    ws.on('close', () => {
        console.log('🔌 Chat client disconnected');
        // Remove from connected clients
        connectedClients.delete(ws);
    });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
    console.log('🐚 Shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let urlDetectionBuffer = '';
    const announcedAuthUrls = new Set();

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Shell message received:', data.type);

            if (data.type === 'init') {
                const projectPath = data.projectPath || process.cwd();
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const provider = data.provider || 'claude';
                const initialCommand = data.initialCommand;
                const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                urlDetectionBuffer = '';
                announcedAuthUrls.clear();

                // Login commands (Claude/Cursor auth) should never reuse cached sessions
                const isLoginCommand = initialCommand && (
                    initialCommand.includes('setup-token') ||
                    initialCommand.includes('cursor-agent login') ||
                    initialCommand.includes('auth login')
                );

                // Include command hash in session key so different commands get separate sessions
                const commandSuffix = isPlainShell && initialCommand
                    ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                    : '';
                ptySessionKey = `${projectPath}_${sessionId || 'default'}${commandSuffix}`;

                // Kill any existing login session before starting fresh
                if (isLoginCommand) {
                    const oldSession = ptySessionsMap.get(ptySessionKey);
                    if (oldSession) {
                        console.log('🧹 Cleaning up existing login session:', ptySessionKey);
                        if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                        if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                        ptySessionsMap.delete(ptySessionKey);
                    }
                }

                const existingSession = isLoginCommand ? null : ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;

                    clearTimeout(existingSession.timeoutId);

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                    }));

                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        console.log(`📜 Sending ${existingSession.buffer.length} buffered messages`);
                        existingSession.buffer.forEach(bufferedData => {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: bufferedData
                            }));
                        });
                    }

                    existingSession.ws = ws;

                    return;
                }

                console.log('[INFO] Starting shell in:', projectPath);
                console.log('📋 Session info:', hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session'));
                console.log('🤖 Provider:', isPlainShell ? 'plain-shell' : provider);
                if (initialCommand) {
                    console.log('⚡ Initial command:', initialCommand);
                }

                // First send a welcome message
                let welcomeMsg;
                if (isPlainShell) {
                    welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                } else {
                    const providerName = provider === 'cursor' ? 'Cursor' : (provider === 'codex' ? 'Codex' : (provider === 'gemini' ? 'Gemini' : 'MTL-Code'));
                    welcomeMsg = hasSession ?
                        `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                        `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                }

                ws.send(JSON.stringify({
                    type: 'output',
                    data: welcomeMsg
                }));

                try {
                    // Validate projectPath — resolve to absolute and verify it exists
                    const resolvedProjectPath = path.resolve(projectPath);
                    try {
                        const stats = fs.statSync(resolvedProjectPath);
                        if (!stats.isDirectory()) {
                            throw new Error('Not a directory');
                        }
                    } catch (pathErr) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid project path' }));
                        return;
                    }

                    // Validate sessionId — only allow safe characters
                    const safeSessionIdPattern = /^[a-zA-Z0-9_.\-:]+$/;
                    if (sessionId && !safeSessionIdPattern.test(sessionId)) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
                        return;
                    }

                    // Build shell command — use cwd for project path (never interpolate into shell string)
                    let shellCommand;
                    if (isPlainShell) {
                        // Plain shell mode - run the initial command in the project directory
                        shellCommand = initialCommand;
                    } else if (provider === 'cursor') {
                        if (hasSession && sessionId) {
                            shellCommand = `cursor-agent --resume="${sessionId}"`;
                        } else {
                            shellCommand = 'cursor-agent';
                        }
                    } else if (provider === 'codex') {
                        // Use codex command; attempt to resume and fall back to a new session when the resume fails.
                        if (hasSession && sessionId) {
                            if (os.platform() === 'win32') {
                                // PowerShell syntax for fallback
                                shellCommand = `codex resume "${sessionId}"; if ($LASTEXITCODE -ne 0) { codex }`;
                            } else {
                                shellCommand = `codex resume "${sessionId}" || codex`;
                            }
                        } else {
                            shellCommand = 'codex';
                        }
                    } else if (provider === 'gemini') {
                        const command = initialCommand || 'gemini';
                        let resumeId = sessionId;
                        if (hasSession && sessionId) {
                            try {
                                // Gemini CLI enforces its own native session IDs, unlike other agents that accept arbitrary string names.
                                // The UI only knows about its internal generated `sessionId` (e.g. gemini_1234).
                                // We must fetch the mapping from the backend session manager to pass the native `cliSessionId` to the shell.
                                const sess = sessionManager.getSession(sessionId);
                                if (sess && sess.cliSessionId) {
                                    resumeId = sess.cliSessionId;
                                    // Validate the looked-up CLI session ID too
                                    if (!safeSessionIdPattern.test(resumeId)) {
                                        resumeId = null;
                                    }
                                }
                            } catch (err) {
                                console.error('Failed to get Gemini CLI session ID:', err);
                            }
                        }

                        if (hasSession && resumeId) {
                            shellCommand = `${command} --resume "${resumeId}"`;
                        } else {
                            shellCommand = command;
                        }
                    } else {
                        // MTL-Code (Claude-compatible provider key)
                        const command = initialCommand || resolveMtlCodeCliCommand();
                        if (hasSession && sessionId) {
                            if (os.platform() === 'win32') {
                                shellCommand = `${resolveMtlCodeCliCommand()} --resume "${sessionId}"; if ($LASTEXITCODE -ne 0) { ${resolveMtlCodeCliCommand()} }`;
                            } else {
                                shellCommand = `${resolveMtlCodeCliCommand()} --resume "${sessionId}" || ${resolveMtlCodeCliCommand()}`;
                            }
                        } else {
                            shellCommand = command;
                        }
                    }

                    console.log('🔧 Executing shell command:', shellCommand);

                    // Use appropriate shell based on platform
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                    // Use terminal dimensions from client if provided, otherwise use defaults
                    const termCols = data.cols || 80;
                    const termRows = data.rows || 24;
                    console.log('📐 Using terminal dimensions:', termCols, 'x', termRows);

                    shellProcess = pty.spawn(shell, shellArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: resolvedProjectPath,
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            FORCE_COLOR: '3'
                        }
                    });

                    console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        timeoutId: null,
                        projectPath,
                        sessionId
                    });

                    // Handle data output
                    shellProcess.onData((data) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        if (session.buffer.length < 5000) {
                            session.buffer.push(data);
                        } else {
                            session.buffer.shift();
                            session.buffer.push(data);
                        }

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            let outputData = data;

                            const cleanChunk = stripAnsiSequences(data);
                            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                            outputData = outputData.replace(
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                '[INFO] Opening in browser: $1'
                            );

                            const emitAuthUrl = (detectedUrl, autoOpen = false) => {
                                const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                if (!normalizedUrl) return;

                                const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
                                if (isNewUrl) {
                                    announcedAuthUrls.add(normalizedUrl);
                                    session.ws.send(JSON.stringify({
                                        type: 'auth_url',
                                        url: normalizedUrl,
                                        autoOpen
                                    }));
                                }

                            };

                            const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
                                .map((url) => normalizeDetectedUrl(url))
                                .filter(Boolean);

                            // Prefer the most complete URL if shorter prefix variants are also present.
                            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter((url, _, urls) =>
                                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
                            );

                            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

                            if (shouldAutoOpenUrlFromOutput(cleanChunk) && dedupedDetectedUrls.length > 0) {
                                const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
                                    current.length > longest.length ? current : longest
                                );
                                emitAuthUrl(bestUrl, true);
                            }

                            // Send regular output
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    // Handle process exit
                    shellProcess.onExit((exitCode) => {
                        console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                            }));
                        }
                        if (session && session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // Send input to shell process
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to shell:', error);
                    }
                } else {
                    console.warn('No active shell process to send input to');
                }
            } else if (data.type === 'resize') {
                // Handle terminal resize
                if (shellProcess && shellProcess.resize) {
                    console.log('Terminal resize requested:', data.cols, 'x', data.rows);
                    shellProcess.resize(data.cols, data.rows);
                }
            }
        } catch (error) {
            console.error('[ERROR] Shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Shell client disconnected');

        if (ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                console.log('⏳ PTY session kept alive, will timeout in 30 minutes:', ptySessionKey);
                session.ws = null;

                session.timeoutId = setTimeout(() => {
                    console.log('⏰ PTY session timeout, killing process:', ptySessionKey);
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                }, PTY_SESSION_TIMEOUT);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Shell WebSocket error:', error);
    });
}
// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const path = (await import('path')).default;
        const fs = (await import('fs')).promises;
        const os = (await import('os')).default;

        // Configure multer for image uploads
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadDir = path.join(os.tmpdir(), 'mtl-code-ui-uploads', String(req.user.id));
                await fs.mkdir(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                cb(null, uniqueSuffix + '-' + sanitizedName);
            }
        });

        const fileFilter = (req, file, cb) => {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
            }
        };

        const upload = multer({
            storage,
            fileFilter,
            limits: {
                fileSize: 5 * 1024 * 1024, // 5MB
                files: 5
            }
        });

        // Handle multipart form data
        upload.array('images', 5)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            try {
                // Process uploaded images
                const processedImages = await Promise.all(
                    req.files.map(async (file) => {
                        // Read file and convert to base64
                        const buffer = await fs.readFile(file.path);
                        const base64 = buffer.toString('base64');
                        const mimeType = file.mimetype;

                        // Clean up temp file immediately
                        await fs.unlink(file.path);

                        return {
                            name: file.originalname,
                            data: `data:${mimeType};base64,${base64}`,
                            size: file.size,
                            mimeType: mimeType
                        };
                    })
                );

                res.json({ images: processedImages });
            } catch (error) {
                console.error('Error processing images:', error);
                // Clean up any remaining files
                await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process images' });
            }
        });
    } catch (error) {
        console.error('Error in image upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Chat file upload endpoint. Files are stored inside the project so the backend
// runtime can read them with normal file tools during the next message.
app.post('/api/projects/:projectName/upload-files', authenticateToken, async (req, res) => {
    let uploadedTempFiles = [];
    try {
        const multer = (await import('multer')).default;
        const uploadTempRoot = path.join(os.tmpdir(), 'mtl-code-ui-file-uploads', String(req.user.id));
        await fsPromises.mkdir(uploadTempRoot, { recursive: true });

        const storage = multer.diskStorage({
            destination: (request, file, cb) => {
                cb(null, uploadTempRoot);
            },
            filename: (request, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, `chat-upload-${uniqueSuffix}`);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 25 * 1024 * 1024,
                files: 10
            }
        });

        upload.array('files', 10)(req, res, async (err) => {
            uploadedTempFiles = Array.isArray(req.files) ? req.files : [];
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Maximum size is 25MB.' });
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
                }
                return res.status(400).json({ error: err.message || 'Failed to upload files' });
            }

            if (uploadedTempFiles.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            try {
                const projectRoot = await extractProjectDirectory(req.params.projectName).catch(() => null);
                if (!projectRoot) {
                    return res.status(404).json({ error: 'Project not found' });
                }

                const batchId = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
                const targetDir = path.join(projectRoot, '.tmp', 'chat-uploads', batchId);
                const validation = validatePathInProject(projectRoot, targetDir);
                if (!validation.valid) {
                    return res.status(403).json({ error: validation.error });
                }

                await fsPromises.mkdir(validation.resolved, { recursive: true });

                const savedFiles = [];
                for (const file of uploadedTempFiles) {
                    const originalBaseName = path.basename(String(file.originalname || 'uploaded-file'));
                    const safeName = (originalBaseName || 'uploaded-file')
                        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
                        .replace(/^\.+$/, 'uploaded-file')
                        .trim() || 'uploaded-file';
                    const destinationPath = path.join(validation.resolved, safeName);
                    const destinationValidation = validatePathInProject(projectRoot, destinationPath);
                    if (!destinationValidation.valid) {
                        await fsPromises.unlink(file.path).catch(() => {});
                        continue;
                    }

                    await fsPromises.copyFile(file.path, destinationValidation.resolved);
                    await fsPromises.unlink(file.path).catch(() => {});
                    savedFiles.push({
                        name: safeName,
                        path: destinationValidation.resolved,
                        size: file.size,
                        mimeType: file.mimetype || 'application/octet-stream'
                    });
                }

                res.json({
                    success: true,
                    files: savedFiles,
                    message: `Uploaded ${savedFiles.length} file(s) successfully`
                });
            } catch (error) {
                console.error('Error processing chat file upload:', error);
                await Promise.all(uploadedTempFiles.map((file) => fsPromises.unlink(file.path).catch(() => {})));
                res.status(500).json({ error: error.message || 'Failed to process files' });
            }
        });
    } catch (error) {
        console.error('Error in file upload endpoint:', error);
        await Promise.all(uploadedTempFiles.map((file) => fsPromises.unlink(file.path).catch(() => {})));
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { provider = 'claude' } = req.query;
        const homeDir = os.homedir();

        // Allow only safe characters in sessionId
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId || safeSessionId !== String(sessionId)) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        // Handle Cursor sessions - they use SQLite and don't have token usage info
        if (provider === 'cursor') {
            return res.json({
                used: 0,
                total: 0,
                breakdown: { input: 0, cacheCreation: 0, cacheRead: 0 },
                unsupported: true,
                message: 'Token usage tracking not available for Cursor sessions'
            });
        }

        // Handle Gemini sessions - they are raw logs in our current setup
        if (provider === 'gemini') {
            return res.json({
                used: 0,
                total: 0,
                breakdown: { input: 0, cacheCreation: 0, cacheRead: 0 },
                unsupported: true,
                message: 'Token usage tracking not available for Gemini sessions'
            });
        }

        // Handle Codex sessions
        if (provider === 'codex') {
            const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');

            // Find the session file by searching for the session ID
            const findSessionFile = async (dir) => {
                try {
                    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            const found = await findSessionFile(fullPath);
                            if (found) return found;
                        } else if (entry.name.includes(safeSessionId) && entry.name.endsWith('.jsonl')) {
                            return fullPath;
                        }
                    }
                } catch (error) {
                    // Skip directories we can't read
                }
                return null;
            };

            const sessionFilePath = await findSessionFile(codexSessionsDir);

            if (!sessionFilePath) {
                return res.status(404).json({ error: 'Codex session file not found', sessionId: safeSessionId });
            }

            // Read and parse the Codex JSONL file
            let fileContent;
            try {
                fileContent = await fsPromises.readFile(sessionFilePath, 'utf8');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return res.status(404).json({ error: 'Session file not found', path: sessionFilePath });
                }
                throw error;
            }
            const lines = fileContent.trim().split('\n');
            let totalTokens = 0;
            let contextWindow = 200000; // Default for Codex/OpenAI

            // Find the latest token_count event with info (scan from end)
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const entry = JSON.parse(lines[i]);

                    // Codex stores token info in event_msg with type: "token_count"
                    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
                        const tokenInfo = entry.payload.info;
                        if (tokenInfo.total_token_usage) {
                            totalTokens = tokenInfo.total_token_usage.total_tokens || 0;
                        }
                        if (tokenInfo.model_context_window) {
                            contextWindow = tokenInfo.model_context_window;
                        }
                        break; // Stop after finding the latest token count
                    }
                } catch (parseError) {
                    // Skip lines that can't be parsed
                    continue;
                }
            }

            return res.json({
                used: totalTokens,
                total: contextWindow
            });
        }

        // Handle Claude sessions (default)
        // Extract actual project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            return res.status(500).json({ error: 'Failed to determine project path' });
        }

        // Construct the JSONL file path
        // MTL-Code stores session files in ~/.mtl-code/projects/[encoded-project-path]/[session-id].jsonl
        // The encoding replaces any non-alphanumeric character (except -) with -
        const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDir = findClaudeProviderProjectDir(encodedPath);

        const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);

        // Constrain to projectDir
        const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        // Read and parse the JSONL file
        let fileContent;
        try {
            fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Session file not found', path: jsonlPath });
            }
            throw error; // Re-throw other errors to be caught by outer try-catch
        }
        const lines = fileContent.trim().split('\n');

        const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
        const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 200000;
        let inputTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;

        // Find the latest assistant message with usage data (scan from end)
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);

                // Only count assistant messages which have usage data
                if (entry.type === 'assistant' && entry.message?.usage) {
                    const usage = entry.message.usage;

                    // Use token counts from latest assistant message only
                    inputTokens = usage.input_tokens || 0;
                    cacheCreationTokens = usage.cache_creation_input_tokens || 0;
                    cacheReadTokens = usage.cache_read_input_tokens || 0;

                    break; // Stop after finding the latest assistant message
                }
            } catch (parseError) {
                // Skip lines that can't be parsed
                continue;
            }
        }

        // Calculate total context usage (excluding output_tokens, as per ccusage)
        const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

        res.json({
            used: totalUsed,
            total: contextWindow,
            breakdown: {
                input: inputTokens,
                cacheCreation: cacheCreationTokens,
                cacheRead: cacheReadTokens
            }
        });
    } catch (error) {
        console.error('Error reading session token usage:', error);
        res.status(500).json({ error: 'Failed to read session token usage' });
    }
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(APP_ROOT, 'dist', 'index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        const redirectHost = getConnectableHost(req.hostname);
        res.redirect(`${req.protocol}://${redirectHost}:${VITE_PORT}`);
    }
});

// global error middleware must be last
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    // Using fsPromises from import
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Debug: log all entries including hidden files


            // Skip heavy build directories and VCS directories
            if (entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === '.git' ||
                entry.name === '.svn' ||
                entry.name === '.hg') continue;

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (entry.isDirectory() && currentDepth < maxDepth) {
                // Recursively get subdirectories but limit depth
                try {
                    // Check if we can access the directory before trying to read it
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                } catch (e) {
                    // Silently skip directories we can't access (permission denied, etc.)
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const SERVER_PORT = process.env.SERVER_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();

        // Configure Web Push (VAPID keys)
        configureWebPush();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log MTL-Code implementation mode
        console.log(`${c.info('[INFO]')} Using MTL-Code backend via Claude Agent SDK compatibility`);
        console.log('');

        if (isProduction) {
            console.log(`${c.info('[INFO]')} To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);            
        }

        console.log(`${c.info('[INFO]')} To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);
   
        server.listen(SERVER_PORT, HOST, async () => {
            const appInstallPath = APP_ROOT;

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('MTL-Code UI Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + SERVER_PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "mtl-code-ui status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await setupProjectsWatcher();

            // Start server-side plugin processes for enabled plugins
            startEnabledPluginServers().catch(err => {
                console.error('[Plugins] Error during startup:', err.message);
            });
        });

        // Clean up plugin processes on shutdown
        const shutdownPlugins = async () => {
            await stopAllPlugins();
            process.exit(0);
        };
        process.on('SIGTERM', () => void shutdownPlugins());
        process.on('SIGINT', () => void shutdownPlugins());
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
