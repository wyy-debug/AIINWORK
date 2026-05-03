const { contextBridge, ipcRenderer } = require('electron');

const normalizeOptions = (options = {}) => ({
  defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
});

const normalizeBrowserOptions = (options = {}) => ({
  url: typeof options.url === 'string' ? options.url : '',
  projectPath: typeof options.projectPath === 'string' ? options.projectPath : '',
});

const normalizeBounds = (bounds = {}) => ({
  x: Number(bounds.x) || 0,
  y: Number(bounds.y) || 0,
  width: Number(bounds.width) || 0,
  height: Number(bounds.height) || 0,
});

const normalizeBrowserAttachOptions = (options = {}) => ({
  ...normalizeBrowserOptions(options),
  bounds: normalizeBounds(options.bounds),
});

contextBridge.exposeInMainWorld('argusDesktop', {
  selectProjectRoot: (options) =>
    ipcRenderer.invoke('dialog:select-project-root', normalizeOptions(options)),
  browserAttach: (options) =>
    ipcRenderer.invoke('browser:attach', normalizeBrowserAttachOptions(options)),
  browserResize: (options) =>
    ipcRenderer.invoke('browser:resize', { bounds: normalizeBounds(options?.bounds) }),
  browserOpen: (options) =>
    ipcRenderer.invoke('browser:open', normalizeBrowserOptions(options)),
  browserNavigate: (options) =>
    ipcRenderer.invoke('browser:navigate', normalizeBrowserOptions(options)),
  browserBack: () =>
    ipcRenderer.invoke('browser:back'),
  browserForward: () =>
    ipcRenderer.invoke('browser:forward'),
  browserRefresh: () =>
    ipcRenderer.invoke('browser:refresh'),
  browserScreenshot: (options) =>
    ipcRenderer.invoke('browser:screenshot', normalizeBrowserOptions(options)),
  browserClose: () =>
    ipcRenderer.invoke('browser:close'),
  browserDetach: () =>
    ipcRenderer.invoke('browser:detach'),
});
