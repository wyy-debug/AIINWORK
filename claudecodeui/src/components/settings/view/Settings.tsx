import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import SettingsSidebar from '../view/SettingsSidebar';
import AgentsSettingsTab from '../view/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import DebugSettingsTab from '../view/tabs/DebugSettingsTab';
import RuntimeSettingsTab from '../view/tabs/RuntimeSettingsTab';
import { useSettingsController } from '../hooks/useSettingsController';
import type { AgentCategory, SettingsProps } from '../types/types';
import { cn } from '../../../lib/utils';

const getInitialAgentCategory = (tab: string): AgentCategory => {
  if (tab === 'mcp') return 'mcp';
  if (tab === 'usage' || tab === 'hub-usage') return 'usage';
  if (tab === 'hub' || tab === 'repository') return 'repository';
  if (tab === 'permissions') return 'permissions';
  if (tab === 'model' || tab === 'tools') return 'model';
  return 'model';
};

function Settings({ isOpen, onClose, projects = [], selectedProject = null, initialTab = 'agents' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const [agentInitialCategory, setAgentInitialCategory] = useState<AgentCategory>(() => getInitialAgentCategory(initialTab));
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    cursorPermissions,
    setCursorPermissions,
    codexPermissionMode,
    setCodexPermissionMode,
    geminiPermissionMode,
    setGeminiPermissionMode,
    argusDebugSettings,
    setArgusDebugSettings,
  } = useSettingsController({
    isOpen,
    initialTab
  });

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-3 xl:p-5">
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[96vh] md:w-[98vw] md:max-w-[1840px] md:rounded-xl 2xl:h-[calc(100vh-32px)]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <span className="animate-in fade-in text-xs text-muted-foreground">{t('saveStatus.success')}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50"
              aria-label={t('close', { defaultValue: '关闭设置' })}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

          {/* Content */}
          <main className="min-w-0 flex-1 overflow-hidden">
            <div
              key={activeTab}
              className={cn(
                'settings-content-enter h-full min-h-0',
                activeTab === 'agents'
                  ? 'overflow-hidden'
                  : 'space-y-6 overflow-y-auto p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-5 xl:p-6',
              )}
            >
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  projectSortOrder={projectSortOrder}
                  onProjectSortOrderChange={setProjectSortOrder}
                  codeEditorSettings={codeEditorSettings}
                  onCodeEditorThemeChange={(value) => updateCodeEditorSetting('theme', value)}
                  onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
                  onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
                  onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
                  onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
                />
              )}

              {activeTab === 'runtime' && (
                <RuntimeSettingsTab
                  projects={projects}
                  selectedProject={selectedProject}
                />
              )}

              {activeTab === 'debug' && (
                <DebugSettingsTab
                  settings={argusDebugSettings}
                  onSettingsChange={setArgusDebugSettings}
                />
              )}

              {activeTab === 'agents' && (
                <AgentsSettingsTab
                  claudePermissions={claudePermissions}
                  onClaudePermissionsChange={setClaudePermissions}
                  cursorPermissions={cursorPermissions}
                  onCursorPermissionsChange={setCursorPermissions}
                  codexPermissionMode={codexPermissionMode}
                  onCodexPermissionModeChange={setCodexPermissionMode}
                  geminiPermissionMode={geminiPermissionMode}
                  onGeminiPermissionModeChange={setGeminiPermissionMode}
                  projects={projects}
                  initialCategory={agentInitialCategory}
                />
              )}
            </div>
          </main>
        </div>
      </div>

    </div>
  );
}

export default Settings;
