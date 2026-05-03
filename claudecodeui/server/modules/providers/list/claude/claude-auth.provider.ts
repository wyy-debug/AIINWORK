import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type ClaudeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

type MtlCodeSettingsStatus = {
  env: Record<string, unknown>;
  modelType?: string;
  model?: string;
};

const MTL_CODE_DEFAULT_CLI = 'mtl-code';

function resolveMtlCodeCliPath(): string {
  return process.env.MTL_CODE_CLI_PATH || process.env.CLAUDE_CLI_PATH || MTL_CODE_DEFAULT_CLI;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function getMtlCodeHomeDir(): string {
  return process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
}

function getLegacyClaudeHomeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getProviderHomeDirs(): string[] {
  return uniquePaths([getMtlCodeHomeDir(), getLegacyClaudeHomeDir()]);
}

export class ClaudeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Argus CLI is available on this host.
   */
  private checkInstalled(): boolean {
      const cliPath = resolveMtlCodeCliPath();
      try {
        spawn.sync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
  }

  /**
   * Returns Argus installation and credential status using the compatible auth priority.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: `Argus CLI is not installed. Set MTL_CODE_CLI_PATH or add ${MTL_CODE_DEFAULT_CLI} to PATH.`,
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'claude',
      authenticated: credentials.authenticated,
      email: credentials.authenticated ? credentials.email || 'Authenticated' : credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads Claude settings env values that the CLI can use even when the server process env is empty.
   */
  private async loadSettings(): Promise<MtlCodeSettingsStatus> {
    for (const homeDir of getProviderHomeDirs()) {
      try {
        const settingsPath = path.join(homeDir, 'settings.json');
        const content = await readFile(settingsPath, 'utf8');
        const settings = readObjectRecord(JSON.parse(content));
        return {
          env: readObjectRecord(settings?.env) ?? {},
          modelType: readOptionalString(settings?.modelType),
          model: readOptionalString(settings?.model),
        };
      } catch {
        // Try the next compatible config directory.
      }
    }

    return { env: {} };
  }

  /**
   * Checks Argus credentials in the same priority order used by the backend.
   */
  private async checkCredentials(): Promise<ClaudeCredentialsStatus> {
    const settings = await this.loadSettings();
    const settingsEnv = settings.env;
    const anthropicToken =
      process.env.ANTHROPIC_AUTH_TOKEN?.trim()
      || readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN);
    const anthropicApiKey =
      process.env.ANTHROPIC_API_KEY?.trim()
      || readOptionalString(settingsEnv.ANTHROPIC_API_KEY);
    const anthropicBaseUrl =
      process.env.ANTHROPIC_BASE_URL?.trim()
      || readOptionalString(settingsEnv.ANTHROPIC_BASE_URL)
      || 'https://api.anthropic.com';
    const anthropicModel =
      process.env.ANTHROPIC_MODEL?.trim()
      || readOptionalString(settingsEnv.ANTHROPIC_MODEL)
      || settings.model
      || 'Anthropic-compatible model';

    if (anthropicToken || anthropicApiKey) {
      return {
        authenticated: true,
        email: anthropicModel,
        method: anthropicBaseUrl === 'https://api.anthropic.com'
          ? 'api_key'
          : 'anthropic_compatible',
      };
    }

    if (settings.modelType === 'anthropic' || readOptionalString(settingsEnv.ANTHROPIC_BASE_URL)) {
      return {
        authenticated: false,
        email: anthropicModel,
        method: 'anthropic_compatible',
        error: 'Anthropic-compatible Argus config is missing ANTHROPIC_AUTH_TOKEN.',
      };
    }

    try {
      let content: string | null = null;
      for (const homeDir of getProviderHomeDirs()) {
        try {
          const credPath = path.join(homeDir, '.credentials.json');
          content = await readFile(credPath, 'utf8');
          break;
        } catch {
          // Try the next compatible credential directory.
        }
      }

      if (!content) {
        return { authenticated: false, email: null, method: null };
      }

      const creds = readObjectRecord(JSON.parse(content)) ?? {};
      const oauth = readObjectRecord(creds.claudeAiOauth);
      const accessToken = readOptionalString(oauth?.accessToken);

      if (accessToken) {
        const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
        const email = readOptionalString(creds.email) ?? readOptionalString(creds.user) ?? null;
        if (!expiresAt || Date.now() < expiresAt) {
          return {
            authenticated: true,
            email,
            method: 'credentials_file',
          };
        }

        return {
          authenticated: false,
          email,
          method: 'credentials_file',
          error: 'OAuth token has expired. Please re-authenticate with mtl-code login',
        };
      }

      return { authenticated: false, email: null, method: null };
    } catch {
      return { authenticated: false, email: null, method: null };
    }
  }
}
