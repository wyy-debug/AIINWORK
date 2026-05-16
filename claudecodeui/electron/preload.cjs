const { contextBridge, ipcRenderer } = require('electron');

const normalizeOptions = (options = {}) => ({
  defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
  title: typeof options.title === 'string' ? options.title : undefined,
  buttonLabel: typeof options.buttonLabel === 'string' ? options.buttonLabel : undefined,
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

const normalizeNotificationOptions = (options = {}) => ({
  title: typeof options.title === 'string' ? options.title : '',
  body: typeof options.body === 'string' ? options.body : '',
  tag: typeof options.tag === 'string' ? options.tag : '',
  urgency: options.urgency === 'critical' ? 'critical' : 'normal',
});

contextBridge.exposeInMainWorld('argusDesktop', {
  selectProjectRoot: (options) =>
    ipcRenderer.invoke('dialog:select-project-root', normalizeOptions(options)),
  selectDirectory: (options) =>
    ipcRenderer.invoke('dialog:select-directory', normalizeOptions(options)),
  selectCodeGraphScope: (options) =>
    ipcRenderer.invoke('dialog:select-codegraph-scope', normalizeOptions(options)),
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
  notify: (options) =>
    ipcRenderer.invoke('notification:show', normalizeNotificationOptions(options)),
});
