import React, { useEffect } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import ReviewPanel from '../../review/view/ReviewPanel';
import ActionsPanel from '../../actions/view/ActionsPanel';
import BrowserPanel from '../../browser/view/BrowserPanel';
import ArtifactsPanel from '../../artifacts/view/ArtifactsPanel';
import SubagentsWorkspace from '../../subagents/view/SubagentsWorkspace';
import WorkflowStudio from '../../workflows/view/WorkflowStudio';
import GlobalCommandMenu from '../../command-menu/view/GlobalCommandMenu';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { Project } from '../../../types/app';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

function MainContent({
  selectedProject,
  selectedSession,
  isConversationSpace = false,
  quickStartAgentId,
  quickStartAgentRequestId,
  newConversationRequestId,
  newProjectSessionRequestId,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  externalMessageUpdate,
  routeSessionState,
  onRecoverSession,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;
  const sessionStore = useSessionStore();

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;

  const shouldShowTasksTab = false;

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  useEffect(() => {
    const selectedProjectName = selectedProject?.name;
    const currentProjectName = currentProject?.name;

    if (!isConversationSpace && selectedProject && selectedProjectName !== currentProjectName) {
      setCurrentProject?.(selectedProject);
    }
  }, [isConversationSpace, selectedProject, currentProject?.name, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
    if (
      activeTab === 'agents'
      || activeTab === 'preview'
      || activeTab === 'automations'
      || activeTab.startsWith('plugin:')
    ) {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (routeSessionState?.status === 'resolving') {
    return (
      <MainContentStateView
        mode="session-loading"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        sessionId={routeSessionState.sessionId}
        message={routeSessionState.message}
      />
    );
  }

  if (routeSessionState?.status === 'missing') {
    return (
      <MainContentStateView
        mode="session-missing"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        sessionId={routeSessionState.sessionId}
        message={routeSessionState.message}
        onRecoverSession={onRecoverSession}
      />
    );
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  const visibleActiveTab = activeTab;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GlobalCommandMenu selectedProject={selectedProject} setActiveTab={setActiveTab} />
      <MainContentHeader
        activeTab={visibleActiveTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isConversationSpace={isConversationSpace}
        shouldShowTasksTab={shouldShowTasksTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${visibleActiveTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <ChatInterface
                key={`${isConversationSpace ? 'conversation' : 'project'}:${selectedProject.name}:${selectedSession?.id || 'new'}`}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                isConversationSpace={isConversationSpace}
                quickStartAgentId={quickStartAgentId}
                quickStartAgentRequestId={quickStartAgentRequestId}
                newConversationRequestId={newConversationRequestId}
                newProjectSessionRequestId={newProjectSessionRequestId}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionActive={onSessionActive}
                onSessionInactive={onSessionInactive}
                onSessionProcessing={onSessionProcessing}
                onSessionNotProcessing={onSessionNotProcessing}
                processingSessions={processingSessions}
                onReplaceTemporarySession={onReplaceTemporarySession}
                onNavigateToSession={onNavigateToSession}
                onShowSettings={onShowSettings}
                autoExpandTools={autoExpandTools}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                autoScrollToBottom={autoScrollToBottom}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                onShowAllTasks={null}
                sessionStore={sessionStore}
              />
            </ErrorBoundary>
          </div>

          {visibleActiveTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            </div>
          )}

          {visibleActiveTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              <StandaloneShell
                project={selectedProject}
                session={selectedSession}
                showHeader={false}
                isActive={activeTab === 'shell'}
              />
            </div>
          )}

          {visibleActiveTab === 'review' && (
            <div className="h-full overflow-hidden">
              <ReviewPanel selectedProject={selectedProject} />
            </div>
          )}

          {visibleActiveTab === 'actions' && (
            <div className="h-full overflow-hidden">
              <ActionsPanel selectedProject={selectedProject} sessionId={selectedSession?.id || null} />
            </div>
          )}

          {visibleActiveTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserPanel selectedProject={selectedProject} sessionId={selectedSession?.id || null} />
            </div>
          )}

          {visibleActiveTab === 'artifacts' && (
            <div className="h-full overflow-hidden">
              <ArtifactsPanel selectedProject={selectedProject} sessionId={selectedSession?.id || null} />
            </div>
          )}

          {visibleActiveTab === 'subagents' && (
            <div className="h-full overflow-hidden">
              <SubagentsWorkspace
                selectedProject={selectedProject}
                sessionId={selectedSession?.id || null}
              />
            </div>
          )}

          {visibleActiveTab === 'workflows' && (
            <div className="h-full overflow-hidden">
              <WorkflowStudio
                selectedProject={selectedProject}
                sessionId={selectedSession?.id || null}
              />
            </div>
          )}
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={visibleActiveTab === 'files'}
        />
      </div>
    </div>
  );
}

export default React.memo(MainContent);
