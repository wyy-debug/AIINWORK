import type { AgentCategoryContentSectionProps } from '../types';
import { McpServers } from '../../../../../mcp';

import ModelConfigContent from './content/ModelConfigContent';
import OpenMythosRuntimeContent from './content/OpenMythosRuntimeContent';
import PermissionsContent from './content/PermissionsContent';
import RepositoryContent from './content/RepositoryContent';

export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3 md:p-4 xl:p-5">
      {selectedCategory === 'model' && selectedAgent === 'claude' && (
        <ModelConfigContent />
      )}

      {selectedCategory === 'runtime' && selectedAgent === 'claude' && (
        <OpenMythosRuntimeContent />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
        <PermissionsContent
          agent="codex"
          permissionMode={codexPermissionMode}
          onPermissionModeChange={onCodexPermissionModeChange}
        />
      )}

      {selectedCategory === 'mcp' && (
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects}
        />
      )}

      {selectedCategory === 'repository' && selectedAgent === 'claude' && (
        <RepositoryContent projects={projects} />
      )}
    </div>
  );
}
