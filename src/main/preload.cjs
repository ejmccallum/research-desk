const { contextBridge, ipcRenderer, webUtils } = require('electron');

const api = {
  getState: () => ipcRenderer.invoke('workspace:get-state'),
  createWorkspace: (name) => ipcRenderer.invoke('workspace:create', name),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  renameWorkspace: (name) => ipcRenderer.invoke('workspace:rename', name),
  closeWorkspace: () => ipcRenderer.invoke('workspace:close'),
  importFiles: (mode, paths) => ipcRenderer.invoke('workspace:import-files', mode, paths),
  readItem: (id) => ipcRenderer.invoke('item:read', id),
  saveText: (id, text) => ipcRenderer.invoke('item:save-text', id, text),
  revealItem: (id) => ipcRenderer.invoke('item:reveal', id),
  openInSystem: (id) => ipcRenderer.invoke('item:open-system', id),
  getDroppedPaths: (files) => files.map(file => webUtils.getPathForFile(file)),
  relinkItem: (id) => ipcRenderer.invoke('item:relink', id),
  createEvidence: (data) => ipcRenderer.invoke('evidence:create', data),
  updateEvidence: (data) => ipcRenderer.invoke('evidence:update', data),
  createClaim: (data) => ipcRenderer.invoke('claim:create', data),
  linkEvidence: (claimId, evidenceId, relationship) => ipcRenderer.invoke('claim:link', claimId, evidenceId, relationship),
  createTask: (data) => ipcRenderer.invoke('task:create', data),
  reorderTasks: (ids) => ipcRenderer.invoke('task:reorder', ids),
  exportWorkspace: () => ipcRenderer.invoke('workspace:export'),
  importWorkspace: () => ipcRenderer.invoke('workspace:import'),
  getBrand: () => ipcRenderer.invoke('settings:brand-get'),
  setBrand: (brand) => ipcRenderer.invoke('settings:brand-set', brand),
  getAiSettings: () => ipcRenderer.invoke('settings:ai-get'),
  saveAiSettings: (apiKey, model) => ipcRenderer.invoke('settings:ai-save', apiKey, model),
  getChatGptStatus: () => ipcRenderer.invoke('chatgpt:status'),
  connectChatGpt: () => ipcRenderer.invoke('chatgpt:connect'),
  disconnectChatGpt: () => ipcRenderer.invoke('chatgpt:disconnect'),
  setChatGptModel: (slug) => ipcRenderer.invoke('chatgpt:model-set', slug),
  refreshChatGptModels: () => ipcRenderer.invoke('chatgpt:models-refresh'),
  chat: (request) => ipcRenderer.invoke('chat:send', request),
  onChatChunk: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:chunk', listener);
    return () => ipcRenderer.removeListener('chat:chunk', listener);
  },
  cancelChat: (conversationId) => ipcRenderer.invoke('chat:cancel', conversationId),
  openExternal: (url) => ipcRenderer.invoke('external:open', url)
};

contextBridge.exposeInMainWorld('researchDesk', api);
