/**
 * preload.js — Secure IPC Bridge for App-Pair Workspace
 * 
 * Exposes backend APIs to the renderer process via contextBridge.
 * This replaces the direct nodeIntegration approach with a secure channel.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // ========================================
  // STORE (Persistent State)
  // ========================================
  
  /** Get the full workspace state */
  store: {
    getAll: () => ipcRenderer.invoke('store:getAll'),
    setAll: (data) => ipcRenderer.invoke('store:setAll', data),
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    reset: () => ipcRenderer.invoke('store:reset'),
    migrate: (localStorageData) => ipcRenderer.invoke('store:migrate', localStorageData),
    getPath: () => ipcRenderer.invoke('store:getPath')
  },

  // ========================================
  // APP REGISTRY
  // ========================================

  registry: {
    getApps: () => ipcRenderer.invoke('registry:getApps'),
    addApp: (appData) => ipcRenderer.invoke('registry:addApp', appData),
    removeApp: (id) => ipcRenderer.invoke('registry:removeApp', id),
    updateApp: (id, updates) => ipcRenderer.invoke('registry:updateApp', id, updates),

    getSites: () => ipcRenderer.invoke('registry:getSites'),
    addSite: (siteData) => ipcRenderer.invoke('registry:addSite', siteData),
    removeSite: (id) => ipcRenderer.invoke('registry:removeSite', id),
    updateSite: (id, updates) => ipcRenderer.invoke('registry:updateSite', id, updates),

    getCategories: () => ipcRenderer.invoke('registry:getCategories'),
    addCategory: (category) => ipcRenderer.invoke('registry:addCategory', category),

    search: (query) => ipcRenderer.invoke('registry:search', query),
    filterByCategory: (category) => ipcRenderer.invoke('registry:filterByCategory', category),
    
    discoverApps: () => ipcRenderer.invoke('registry:discoverApps')
  },

  // ========================================
  // DATA SERVICE (Web Scraping + File Reading)
  // ========================================

  data: {
    scrapeUrl: (url) => ipcRenderer.invoke('data:scrapeUrl', url),
    getHistory: () => ipcRenderer.invoke('data:getHistory'),
    clearHistory: () => ipcRenderer.invoke('data:clearHistory'),

    readFile: (filePath) => ipcRenderer.invoke('data:readFile', filePath),
    listDirectory: (dirPath) => ipcRenderer.invoke('data:listDirectory', dirPath),
    getFileInfo: (filePath) => ipcRenderer.invoke('data:getFileInfo', filePath)
  },

  // ========================================
  // LOCAL LAPTOP APPS
  // ========================================

  localApps: {
    pickLocalApp: () => ipcRenderer.invoke('pick-local-app'),
    scanInstalledApps: () => ipcRenderer.invoke('scan-installed-apps'),
    launchApp: (appPath) => ipcRenderer.invoke('launch-local-app', appPath),
    snapWindowSplit: (side, appPath) => ipcRenderer.invoke('snap-window-split', { side, appPath })
  },

  // ========================================
  // SYSTEM UTILITIES
  // ========================================

  system: {
    /** Launch a native application */
    launchApp: (appPath, appName) => ipcRenderer.invoke('system:launchApp', appPath, appName),

    /** Open a file dialog */
    openFileDialog: (options) => ipcRenderer.invoke('system:openFileDialog', options),

    /** Read local PDF file as base64 */
    readPdfFile: (filePath) => ipcRenderer.invoke('system:readPdfFile', filePath),

    /** Open a directory dialog */
    openDirectoryDialog: (options) => ipcRenderer.invoke('system:openDirectoryDialog', options),

    /** Get system clipboard text */
    getClipboard: () => ipcRenderer.invoke('system:getClipboard'),

    /** Set system clipboard text */
    setClipboard: (text) => ipcRenderer.invoke('system:setClipboard', text),

    /** Get platform info */
    getPlatform: () => ipcRenderer.invoke('system:getPlatform')
  },

  // ========================================
  // WINDOW CONTROLS (Native Frameless Window)
  // ========================================

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  // ========================================
  // SERVER & BACKEND STATUS
  // ========================================

  server: {
    /** Get embedded server status, REST API url, and WebSocket url */
    getInfo: () => ipcRenderer.invoke('server:getInfo')
  },

  // ========================================
  // EVENTS (Main → Renderer communication)
  // ========================================

  on: (channel, callback) => {
    const validChannels = ['app:stateUpdated', 'app:error', 'app:notification', 'window:maximized'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});
