import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../../shared/modelConstants.js';
import { getBuiltInRecipe, listBuiltInRecipes, renderRecipePrompt } from '../../shared/recipes.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';

const __dirname = getModuleDir(import.meta.url);
// This route reads the top-level package.json for the status command, so it needs the real
// app root even after compilation moves the route file under dist-server/server/routes.
const APP_ROOT = findAppRoot(__dirname);

const router = express.Router();

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getProjectCommandDirs(projectPath) {
  if (!projectPath) return [];
  return uniquePaths([
    path.join(projectPath, '.mtl-code', 'commands'),
    path.join(projectPath, '.claude', 'commands')
  ]);
}

function getUserCommandDirs() {
  const homeDir = os.homedir();
  return uniquePaths([
    path.join(homeDir, '.mtl-code', 'commands'),
    path.join(homeDir, '.claude', 'commands')
  ]);
}

function isUnderDirectory(base, target) {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Recursively scan directory for command files (.md)
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string} namespace - Namespace for commands (e.g., 'project', 'user')
 * @returns {Promise<Array>} Array of command objects
 */
async function scanCommandsDirectory(dir, baseDir, namespace) {
  const commands = [];

  try {
    // Check if directory exists
    await fs.access(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file for metadata
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const { data: frontmatter, content: commandContent } = parseFrontmatter(content);

          // Calculate relative path from baseDir for command name
          const relativePath = path.relative(baseDir, fullPath);
          // Remove .md extension and convert to command name
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from frontmatter or first line of content
          let description = frontmatter.description || '';
          if (!description) {
            const firstLine = commandContent.trim().split('\n')[0];
            description = firstLine.replace(/^#+\s*/, '').trim();
          }

          commands.push({
            name: commandName,
            path: fullPath,
            relativePath,
            description,
            namespace,
            metadata: frontmatter
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed - this is okay
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning directory ${dir}:`, err.message);
    }
  }

  return commands;
}

/**
 * Built-in commands that are always available
 */
const builtInCommands = [
  {
    name: '/help',
    description: 'Show help documentation for Argus',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/clear',
    description: 'Clear the conversation history',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/model',
    description: 'Switch or view the current AI model',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/cost',
    description: 'Display token usage and cost information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/memory',
    description: 'Open the Argus project memory file for editing',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/config',
    description: 'Open settings and configuration',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/status',
    description: 'Show system status and version information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/rewind',
    description: 'Rewind the conversation to a previous state',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/review',
    description: 'Open the Review panel for local changes',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'review' }
  },
  {
    name: '/init-project',
    description: 'Generate an MTL.md project profile draft',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'actions', insertText: 'Please generate an MTL.md project profile draft and show me the preview before writing.' }
  },
  {
    name: '/recipe',
    description: 'Run a built-in workflow recipe',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'chat' }
  },
  {
    name: '/actions',
    description: 'Open project setup, run, test, and build actions',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'actions' }
  },
  {
    name: '/browser',
    description: 'Open the local browser and visual comments panel',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'browser' }
  },
  {
    name: '/worktree',
    description: 'Open worktree task dispatch controls',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'actions', mode: 'worktree' }
  },
  {
    name: '/automations',
    description: 'Open local automations and triage inbox',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'automations' }
  },
	  {
	    name: '/artifacts',
	    description: 'Open result artifacts and previews',
	    namespace: 'builtin',
	    metadata: { type: 'builtin', tab: 'artifacts' }
	  },
  {
    name: '/mcp',
    description: 'Open Argus MCP status and settings',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'chat', settingsTab: 'mcp' }
  },
  {
    name: '/plan-mode',
    description: 'Insert a plan-mode instruction into the current chat',
    namespace: 'builtin',
    metadata: { type: 'builtin', tab: 'chat', insertText: 'Please work in plan mode first.' }
	  }
	];

/**
 * Built-in command handlers
 * Each handler returns { type: 'builtin', action: string, data: any }
 */
const builtInHandlers = {
  '/help': async (args, context) => {
    const helpText = `# Argus Commands

## Built-in Commands

${builtInCommands.map(cmd => `### ${cmd.name}
${cmd.description}
`).join('\n')}

## Custom Commands

Custom commands can be created in:
- Project: \`.mtl-code/commands/\` (project-specific)
- User: \`~/.mtl-code/commands/\` (available in all projects)

### Command Syntax

- **Arguments**: Use \`$ARGUMENTS\` for all args or \`$1\`, \`$2\`, etc. for positional
- **File Includes**: Use \`@filename\` to include file contents
- **Bash Commands**: Use \`!command\` to execute bash commands

### Examples

\`\`\`markdown
/mycommand arg1 arg2
\`\`\`
`;

    return {
      type: 'builtin',
      action: 'help',
      data: {
        content: helpText,
        format: 'markdown'
      }
    };
  },

  '/clear': async (args, context) => {
    return {
      type: 'builtin',
      action: 'clear',
      data: {
        message: 'Conversation history cleared'
      }
    };
  },

  '/model': async (args, context) => {
    const availableModels = {
      mtlCode: CLAUDE_MODELS.OPTIONS.map(o => o.label),
    };

    const currentProvider = context?.provider || 'claude';
    const currentModel = context?.model || CLAUDE_MODELS.DEFAULT;
    const currentModelDisplay =
      CLAUDE_MODELS.OPTIONS.find((option) => option.value === currentModel)?.label || currentModel;

    return {
      type: 'builtin',
      action: 'model',
      data: {
        current: {
          provider: currentProvider,
          model: currentModelDisplay
        },
        available: availableModels,
        message: args.length > 0
          ? `Switching to model: ${args[0]}`
          : `Current model: ${currentModel}`
      }
    };
  },

  '/cost': async (args, context) => {
    const tokenUsage = context?.tokenUsage || {};
    const contextBudget = tokenUsage.contextBudget || tokenUsage;
    const provider = context?.provider || 'claude';
    const model = context?.model || CLAUDE_MODELS.DEFAULT;

    const used = Number(
      contextBudget?.cumulative?.used ??
        tokenUsage.used ??
        tokenUsage.totalUsed ??
        tokenUsage.total_tokens ??
        0,
    ) || 0;
    const total =
      Number(
          contextBudget?.window?.tokens ??
          contextBudget?.cumulative?.total ??
          tokenUsage.total ??
          tokenUsage.contextWindow ??
          parseInt(process.env.CONTEXT_WINDOW || '200000', 10),
      ) || 200000;
    const percentage = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;

    const inputTokensRaw =
      Number(
        contextBudget?.cumulative?.breakdown?.input ??
          tokenUsage.inputTokens ??
          tokenUsage.input ??
          tokenUsage.cumulativeInputTokens ??
          tokenUsage.promptTokens ??
          0,
      ) || 0;
    const outputTokens =
      Number(
        contextBudget?.cumulative?.breakdown?.output ??
          tokenUsage.outputTokens ??
          tokenUsage.output ??
          tokenUsage.cumulativeOutputTokens ??
          tokenUsage.completionTokens ??
          0,
      ) || 0;
    const contextBudgetCacheTokens =
      (contextBudget?.cumulative?.breakdown?.cacheRead || 0)
      + (contextBudget?.cumulative?.breakdown?.cacheCreation || 0);
    const cacheTokens =
      Number(
        (contextBudgetCacheTokens > 0 ? contextBudgetCacheTokens : undefined) ??
          tokenUsage.cacheReadTokens ??
          tokenUsage.cacheCreationTokens ??
          tokenUsage.cacheTokens ??
          tokenUsage.cachedTokens ??
          0,
      ) || 0;

    // If we only have total used tokens, treat them as input for display/estimation.
    const inputTokens =
      inputTokensRaw > 0 || outputTokens > 0 || cacheTokens > 0 ? inputTokensRaw + cacheTokens : used;

    // Rough default rates by provider (USD / 1M tokens).
    const pricingByProvider = {
      claude: { input: 3, output: 15 },
      cursor: { input: 3, output: 15 },
      codex: { input: 1.5, output: 6 },
    };
    const rates = pricingByProvider[provider] || pricingByProvider.claude;

    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;
    const totalCost = inputCost + outputCost;

    return {
      type: 'builtin',
      action: 'cost',
      data: {
        tokenUsage: {
          used,
          total,
          percentage,
        },
        cost: {
          input: inputCost.toFixed(4),
          output: outputCost.toFixed(4),
          total: totalCost.toFixed(4),
        },
        model,
      },
    };
  },

  '/status': async (args, context) => {
    // Read version from package.json
    const packageJsonPath = path.join(APP_ROOT, 'package.json');
    let version = 'unknown';
    let packageName = 'mtl-code-ui';

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      version = packageJson.version;
      packageName = packageJson.name;
    } catch (err) {
      console.error('Error reading package.json:', err);
    }

    const uptime = process.uptime();
    const uptimeMinutes = Math.floor(uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeFormatted = uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;

    return {
      type: 'builtin',
      action: 'status',
      data: {
        version,
        packageName,
        uptime: uptimeFormatted,
        uptimeSeconds: Math.floor(uptime),
        model: context?.model || CLAUDE_MODELS.DEFAULT,
        provider: context?.provider || 'claude',
        nodeVersion: process.version,
        platform: process.platform
      }
    };
  },

  '/memory': async (args, context) => {
    const projectPath = context?.projectPath;

    if (!projectPath) {
      return {
        type: 'builtin',
        action: 'memory',
        data: {
          error: 'No project selected',
          message: 'Please select a project to access its Argus memory file'
        }
      };
    }

    const memoryCandidates = [
      path.join(projectPath, 'MTL.md'),
      path.join(projectPath, 'CLAUDE.md')
    ];
    let memoryPath = memoryCandidates[0];

    let exists = false;
    for (const candidate of memoryCandidates) {
      try {
        await fs.access(candidate);
        memoryPath = candidate;
        exists = true;
        break;
      } catch (err) {
        // File doesn't exist
      }
    }

    return {
      type: 'builtin',
      action: 'memory',
      data: {
        path: memoryPath,
        exists,
        message: exists
          ? `Opening Argus memory file at ${memoryPath}`
          : `Project memory file not found at ${memoryPath}. Create it to store project-specific instructions.`
      }
    };
  },

  '/config': async (args, context) => {
    return {
      type: 'builtin',
      action: 'config',
      data: {
        message: 'Opening settings...'
      }
    };
  },

  '/rewind': async (args, context) => {
    const steps = args[0] ? parseInt(args[0]) : 1;

    if (isNaN(steps) || steps < 1) {
      return {
        type: 'builtin',
        action: 'rewind',
        data: {
          error: 'Invalid steps parameter',
          message: 'Usage: /rewind [number] - Rewind conversation by N steps (default: 1)'
        }
      };
    }

    return {
      type: 'builtin',
      action: 'rewind',
      data: {
        steps,
        message: `Rewinding conversation by ${steps} step${steps > 1 ? 's' : ''}...`
      }
    };
  },

  '/review': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: { tab: 'review', message: 'Opening Review panel...' }
  }),

  '/init-project': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: {
      tab: 'actions',
      mode: 'project-profile',
      message: 'Opening Project Profile init. Generate a preview before writing MTL.md.'
    }
  }),

  '/recipe': async (args) => {
    const recipeId = args[0] || '';
    const recipe = getBuiltInRecipe(recipeId);
    if (!recipe) {
      const recipes = listBuiltInRecipes()
        .map((item) => `- ${item.id}: ${item.title}`)
        .join('\n');
      return {
        type: 'builtin',
        action: 'insert-text',
        data: {
          text: `Available recipes:\n${recipes}\n\nUse /recipe <id> and provide the requested inputs.`,
          message: 'Recipe list inserted.'
        }
      };
    }
    const placeholderValues = Object.fromEntries(
      recipe.inputs.map((input) => [input.id, input.required ? `[${input.label}]` : ''])
    );
    return {
      type: 'builtin',
      action: 'insert-text',
      data: {
        text: renderRecipePrompt(recipe, placeholderValues),
        message: `Recipe ${recipe.title} inserted.`
      }
    };
  },

  '/actions': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: { tab: 'actions', message: 'Opening Actions panel...' }
  }),

  '/browser': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: { tab: 'browser', message: 'Opening Browser panel...' }
  }),

  '/automations': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: { tab: 'automations', message: 'Opening Automations panel...' }
  }),

  '/artifacts': async () => ({
    type: 'builtin',
    action: 'open-tab',
    data: { tab: 'artifacts', message: 'Opening Artifacts panel...' }
  }),

	  '/worktree': async () => ({
	    type: 'builtin',
	    action: 'open-tab',
	    data: { tab: 'actions', mode: 'worktree', message: 'Opening Worktree controls...' }
	  }),

  '/mcp': async () => ({
    type: 'builtin',
    action: 'open-settings',
    data: { tab: 'mcp', message: 'Opening MCP settings...' }
  }),

  '/plan-mode': async () => ({
    type: 'builtin',
    action: 'insert-text',
    data: { text: 'Please work in plan mode first.', message: 'Plan-mode instruction inserted.' }
  })
};

/**
 * POST /api/commands/list
 * List all available commands from project and user directories
 */
router.post('/list', async (req, res) => {
  try {
    const { projectPath } = req.body;
    const allCommands = [...builtInCommands];

    if (projectPath) {
      for (const projectCommandsDir of getProjectCommandDirs(projectPath)) {
        const projectCommands = await scanCommandsDirectory(
          projectCommandsDir,
          projectCommandsDir,
          'project'
        );
        allCommands.push(...projectCommands);
      }
    }

    for (const userCommandsDir of getUserCommandDirs()) {
      const userCommands = await scanCommandsDirectory(
        userCommandsDir,
        userCommandsDir,
        'user'
      );
      allCommands.push(...userCommands);
    }

    // Separate built-in and custom commands
    const customCommands = allCommands.filter(cmd => cmd.namespace !== 'builtin');

    // Sort commands alphabetically by name
    customCommands.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      builtIn: builtInCommands,
      custom: customCommands,
      count: allCommands.length
    });
  } catch (error) {
    console.error('Error listing commands:', error);
    res.status(500).json({
      error: 'Failed to list commands',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/execute
 * Execute a command with argument replacement
 * This endpoint prepares the command content but doesn't execute bash commands yet
 * (that will be handled in the command parser utility)
 */
router.post('/execute', async (req, res) => {
  try {
    const { commandName, commandPath, args = [], context = {} } = req.body;

    if (!commandName) {
      return res.status(400).json({
        error: 'Command name is required'
      });
    }

    // Handle built-in commands
    const handler = builtInHandlers[commandName];
    if (handler) {
      try {
        const result = await handler(args, context);
        return res.json({
          ...result,
          command: commandName
        });
      } catch (error) {
        console.error(`Error executing built-in command ${commandName}:`, error);
        return res.status(500).json({
          error: 'Command execution failed',
          message: error.message,
          command: commandName
        });
      }
    }

    // Handle custom commands
    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required for custom commands'
      });
    }

    // Load command content
    // Security: validate commandPath is within allowed directories
    {
      const resolvedPath = path.resolve(commandPath);
      const allowedBases = [
        ...getUserCommandDirs(),
        ...getProjectCommandDirs(context?.projectPath)
      ].map((base) => path.resolve(base));
      const isAllowed = allowedBases.some((base) => isUnderDirectory(base, resolvedPath));
      if (!isAllowed) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Command must be in .mtl-code/commands or legacy .claude/commands directory'
        });
      }
    }
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = parseFrontmatter(content);
    // Basic argument replacement (will be enhanced in command parser utility)
    let processedContent = commandContent;

    // Replace $ARGUMENTS with all arguments joined
    const argsString = args.join(' ');
    processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

    // Replace $1, $2, etc. with positional arguments
    args.forEach((arg, index) => {
      const placeholder = `$${index + 1}`;
      processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
    });

    res.json({
      type: 'custom',
      command: commandName,
      content: processedContent,
      metadata,
      hasFileIncludes: processedContent.includes('@'),
      hasBashCommands: processedContent.includes('!')
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error executing command:', error);
    res.status(500).json({
      error: 'Failed to execute command',
      message: error.message
    });
  }
});

export default router;
