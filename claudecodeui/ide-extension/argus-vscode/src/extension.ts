import * as vscode from 'vscode';

type BridgeState = {
  activeProject?: string | null;
  activeSession?: string | null;
  openFile?: string | null;
  selection?: unknown;
  context?: string;
};

const getConfig = () => {
  const config = vscode.workspace.getConfiguration('argus');
  return {
    bridgeUrl: String(config.get('bridgeUrl') || 'http://127.0.0.1:3987').replace(/\/+$/, ''),
    bridgeToken: String(config.get('bridgeToken') || ''),
  };
};

const postBridgeContext = async (state: BridgeState) => {
  const { bridgeUrl, bridgeToken } = getConfig();
  if (!bridgeToken) {
    throw new Error('Set argus.bridgeToken from /api/ide-bridge/token first.');
  }
  const response = await fetch(`${bridgeUrl}/api/ide-bridge/context`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`Argus bridge rejected context: HTTP ${response.status}`);
  }
};

const getWorkspacePath = () => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath || '';
};

const buildEditorState = (): BridgeState => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {
      activeProject: getWorkspacePath(),
      context: '',
    };
  }
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const context = selectedText || editor.document.getText();
  return {
    activeProject: getWorkspacePath(),
    openFile: editor.document.uri.fsPath,
    selection: {
      start: {
        line: selection.start.line + 1,
        character: selection.start.character + 1,
      },
      end: {
        line: selection.end.line + 1,
        character: selection.end.character + 1,
      },
    },
    context: context.slice(0, 200_000),
  };
};

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('argus.sendSelection', async () => {
      try {
        await postBridgeContext(buildEditorState());
        vscode.window.showInformationMessage('Sent editor context to Argus.');
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to send context to Argus.');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('argus.openActiveSession', async () => {
      const { bridgeUrl } = getConfig();
      vscode.env.openExternal(vscode.Uri.parse(bridgeUrl));
    }),
  );
}

export function deactivate() {}
