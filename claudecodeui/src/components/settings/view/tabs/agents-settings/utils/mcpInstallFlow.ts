type McpSetupFieldLike = {
  key?: string;
};

type McpInstallAction = 'install' | 'update';

export function shouldPromptForMcpSetup(action: McpInstallAction, setupFields: McpSetupFieldLike[] = []) {
  return action === 'install' && setupFields.length > 0;
}

export function emptyMcpConfiguration() {
  return { mcpValues: {} };
}
