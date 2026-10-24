const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, session, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Standard modern desktop Chrome User-Agent with Electron stripped out
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
app.userAgentFallback = CHROME_USER_AGENT;

// Backend modules
const Store = require('./store');
const AppRegistry = require('./app-registry');
const DataService = require('./data-service');
const BackendServer = require('./backend/server');

let mainWindow;
let store;
let registry;
let dataService;
let backendServer;

const destIcon = path.join(__dirname, 'icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // Enable webview tag to embed any website side-by-side
      plugins: true, // Enable native PDF and plugin viewing
      webSecurity: false, // Allow local PDF files, blobs, and cross-origin rendering
      allowRunningInsecureContent: true
    },
    icon: fs.existsSync(destIcon) ? destIcon : undefined,
    backgroundColor: '#F4F1EA',
    title: 'App-Pair Workspace'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Remove default menu bar for clean app appearance
  Menu.setApplicationMenu(null);

  mainWindow.on('maximize', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('window:maximized', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('window:maximized', false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ========================================
// IPC HANDLERS — STORE
// ========================================

function registerStoreHandlers() {
  ipcMain.handle('store:getAll', () => {
    return store.getAll();
  });

  ipcMain.handle('store:setAll', (event, data) => {
    store.setAll(data);
    return { success: true };
  });

  ipcMain.handle('store:get', (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
    return { success: true };
  });

  ipcMain.handle('store:reset', () => {
    store.reset();
    return { success: true };
  });

  ipcMain.handle('store:migrate', (event, localStorageData) => {
    return store.migrateFromLocalStorage(localStorageData);
  });

  ipcMain.handle('store:getPath', () => {
    return store.getStoragePath();
  });
}

// ========================================
// IPC HANDLERS — APP REGISTRY
// ========================================

function registerRegistryHandlers() {
  // Desktop Apps
  ipcMain.handle('registry:getApps', () => registry.getApps());
  ipcMain.handle('registry:addApp', (event, appData) => registry.addApp(appData));
  ipcMain.handle('registry:removeApp', (event, id) => registry.removeApp(id));
  ipcMain.handle('registry:updateApp', (event, id, updates) => registry.updateApp(id, updates));

  // Website Bookmarks
  ipcMain.handle('registry:getSites', () => registry.getSites());
  ipcMain.handle('registry:addSite', (event, siteData) => registry.addSite(siteData));
  ipcMain.handle('registry:removeSite', (event, id) => registry.removeSite(id));
  ipcMain.handle('registry:updateSite', (event, id, updates) => registry.updateSite(id, updates));

  // Categories
  ipcMain.handle('registry:getCategories', () => registry.getCategories());
  ipcMain.handle('registry:addCategory', (event, category) => registry.addCategory(category));

  // Search & Filter
  ipcMain.handle('registry:search', (event, query) => registry.search(query));
  ipcMain.handle('registry:filterByCategory', (event, category) => registry.filterByCategory(category));

  // Auto-discovery
  ipcMain.handle('registry:discoverApps', async () => {
    try {
      return { success: true, apps: await registry.discoverInstalledApps() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

// ========================================
// IPC HANDLERS — DATA SERVICE
// ========================================

function registerDataHandlers() {
  ipcMain.handle('data:scrapeUrl', async (event, url) => {
    return dataService.scrapeUrl(url);
  });

  ipcMain.handle('data:getHistory', () => dataService.getHistory());
  ipcMain.handle('data:clearHistory', () => {
    dataService.clearHistory();
    return { success: true };
  });

  ipcMain.handle('data:readFile', (event, filePath) => dataService.readFile(filePath));
  ipcMain.handle('data:listDirectory', (event, dirPath) => dataService.listDirectory(dirPath));
  ipcMain.handle('data:getFileInfo', (event, filePath) => dataService.getFileInfo(filePath));
}

// ========================================
// IPC HANDLERS — SYSTEM UTILITIES
// ========================================

function registerSystemHandlers() {
  // Launch a native app
  ipcMain.handle('system:launchApp', (event, appPath, appName) => {
    return new Promise((resolve) => {
      try {
        exec(`"${appPath}"`, (err) => {
          if (err) {
            console.error('Launch error:', err);
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });

  // Open file dialog
  ipcMain.handle('system:openFileDialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Select File',
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      properties: options?.properties || ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePaths: result.filePaths };
  });

  // Read local PDF file into Base64 for reliable rendering
  ipcMain.handle('system:readPdfFile', async (event, filePath) => {
    try {
      let resolved = filePath;
      if (!path.isAbsolute(resolved)) {
        resolved = path.join(__dirname, resolved);
      }
      const buffer = await fs.promises.readFile(resolved);
      return {
        success: true,
        data: buffer.toString('base64'),
        name: path.basename(resolved),
        size: buffer.length
      };
    } catch (err) {
      console.error('Failed to read PDF file:', err);
      return { success: false, error: err.message };
    }
  });

  // Open directory dialog
  ipcMain.handle('system:openDirectoryDialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Select Directory',
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePaths: result.filePaths };
  });

  // Clipboard operations
  ipcMain.handle('system:getClipboard', () => {
    return clipboard.readText();
  });

  ipcMain.handle('system:setClipboard', (event, text) => {
    clipboard.writeText(text);
    return { success: true };
  });

  // Platform info
  ipcMain.handle('system:getPlatform', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.getSystemVersion()
    };
  });

  // Server Info & Health
  ipcMain.handle('server:getInfo', () => {
    if (backendServer) {
      return backendServer.getInfo();
    }
    return { isRunning: false };
  });
}

// ========================================
// IPC HANDLERS — LOCAL LAPTOP APPS
// ========================================

function registerLocalAppHandlers() {
  // 1. Pick a local laptop executable or shortcut
  ipcMain.handle('pick-local-app', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Application or Shortcut',
        filters: [
          { name: 'Applications & Shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'appref-ms'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const filePath = result.filePaths[0];
      const ext = path.extname(filePath);
      let baseName = path.basename(filePath, ext)
        .replace(/^Microsoft\s+/i, '')
        .replace(/\s+-\s+Shortcut$/i, '')
        .trim();

      const knownExeMap = {
        'code': 'VS Code',
        'chrome': 'Google Chrome',
        'msedge': 'Microsoft Edge',
        'firefox': 'Mozilla Firefox',
        'brave': 'Brave Browser',
        'spotify': 'Spotify',
        'vlc': 'VLC Media Player',
        'discord': 'Discord',
        'slack': 'Slack',
        'notion': 'Notion',
        'sublime_text': 'Sublime Text',
        'postman': 'Postman',
        'steam': 'Steam',
        'figma': 'Figma',
        'devenv': 'Visual Studio',
        'cmd': 'Command Prompt',
        'powershell': 'PowerShell',
        'calc': 'Calculator',
        'notepad': 'Notepad',
        'mspaint': 'Paint'
      };

      if (knownExeMap[baseName.toLowerCase()]) {
        baseName = knownExeMap[baseName.toLowerCase()];
      }

      let iconDataUrl = null;
      try {
        const icon = await app.getFileIcon(filePath, { size: 'normal' });
        iconDataUrl = icon.toDataURL();
      } catch (e) {}

      return {
        canceled: false,
        path: filePath,
        name: baseName,
        icon: iconDataUrl
      };
    } catch (err) {
      console.error('pick-local-app error:', err);
      return { canceled: true, error: err.message };
    }
  });

  // 2. Scan Windows Start Menu and Desktop shortcuts for one-click add
  ipcMain.handle('scan-installed-apps', async () => {
    try {
      const searchDirs = [
        path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
        path.join(process.env.USERPROFILE || '', 'Desktop')
      ];

      const found = [];
      const seenNames = new Set();

      function scanDir(dir, depth = 0) {
        if (depth > 2 || !fs.existsSync(dir)) return;
        try {
          const items = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
              scanDir(fullPath, depth + 1);
            } else if (item.isFile()) {
              const ext = path.extname(item.name).toLowerCase();
              if (['.lnk', '.exe'].includes(ext)) {
                let baseName = path.basename(item.name, ext)
                  .replace(/^Microsoft\s+/i, '')
                  .replace(/\s+-\s+Shortcut$/i, '')
                  .replace(/\s+\(64-bit\)$/i, '')
                  .trim();
                if (/uninstall|help|doc|readme|setup/i.test(baseName)) continue;
                if (!seenNames.has(baseName.toLowerCase())) {
                  seenNames.add(baseName.toLowerCase());
                  found.push({ name: baseName, path: fullPath });
                }
              }
            }
          }
        } catch (e) {}
      }

      for (const d of searchDirs) scanDir(d);

      // Add common Windows apps
      const commonApps = [
        { name: 'Notepad', path: 'C:\\Windows\\notepad.exe' },
        { name: 'Paint', path: 'C:\\Windows\\system32\\mspaint.exe' },
        { name: 'Calculator', path: 'calc.exe' },
        { name: 'Command Prompt', path: 'C:\\Windows\\system32\\cmd.exe' },
        { name: 'PowerShell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }
      ];
      for (const ca of commonApps) {
        if (!seenNames.has(ca.name.toLowerCase())) {
          seenNames.add(ca.name.toLowerCase());
          found.push(ca);
        }
      }

      // Fetch icons for the top 50 discovered applications
      const appsWithIcons = [];
      for (const item of found.slice(0, 50)) {
        let iconDataUrl = null;
        try {
          if (fs.existsSync(item.path)) {
            const icon = await app.getFileIcon(item.path, { size: 'normal' });
            iconDataUrl = icon.toDataURL();
          }
        } catch (e) {}
        appsWithIcons.push({
          name: item.name,
          path: item.path,
          icon: iconDataUrl
        });
      }

      appsWithIcons.sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, apps: appsWithIcons };
    } catch (err) {
      console.error('scan-installed-apps error:', err);
      return { success: false, apps: [] };
    }
  });

  // 3. Launch standalone local application
  ipcMain.handle('launch-local-app', async (event, appPath) => {
    try {
      const errMsg = await shell.openPath(appPath);
      if (errMsg) {
        exec(`"${appPath}"`, (err) => {
          if (err) console.error('exec fallback error:', err);
        });
      }
      return { success: true };
    } catch (err) {
      try {
        exec(`"${appPath}"`);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  });

  // 4. Snap window side-by-side on laptop monitor (50/50 hardware snap)
  ipcMain.handle('snap-window-split', async (event, { side, appPath }) => {
    try {
      if (mainWindow) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { x, y, width, height } = primaryDisplay.workArea;
        const halfWidth = Math.floor(width / 2);

        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        }

        // If local app is on the LEFT pane of the workspace,
        // snap App-Pair Workspace to the RIGHT half of the monitor so the local app can be on the LEFT!
        if (side === 'left') {
          mainWindow.setBounds({
            x: x + halfWidth,
            y: y,
            width: halfWidth,
            height: height
          });
        } else {
          // If local app is on the RIGHT pane of the workspace,
          // snap App-Pair Workspace to the LEFT half of the monitor!
          mainWindow.setBounds({
            x: x,
            y: y,
            width: halfWidth,
            height: height
          });
        }
      }

      if (appPath) {
        await shell.openPath(appPath);
      }

      return { success: true };
    } catch (err) {
      console.error('snap-window-split error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ========================================
// IPC HANDLERS — WINDOW CONTROLS
// ========================================

function registerWindowHandlers() {
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return mainWindow.isMaximized();
    }
    return false;
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });
}

// ========================================
// APP LIFECYCLE
// ========================================

app.whenReady().then(async () => {
  // Override User-Agent globally in defaultSession and strip Electron for compatibility with Notion and Google
  try {
    session.defaultSession.setUserAgent(CHROME_USER_AGENT);
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
  } catch (err) {
    console.error('Failed to configure defaultSession User-Agent:', err);
  }

  // Initialize backend services
  store = new Store();
  store.init();

  registry = new AppRegistry(store);
  dataService = new DataService(store);

  // Initialize and start Backend REST & WebSocket Server
  try {
    backendServer = new BackendServer({
      port: 4173,
      host: '127.0.0.1',
      storageDir: path.join(app.getPath('userData'), 'app-pair-data'),
      dataService,
      appRegistry: registry
    });
    const serverInfo = await backendServer.start();
    console.log('[Main] Backend server running at:', serverInfo.apiUrl);
  } catch (err) {
    console.error('[Main] Failed to start backend server:', err);
  }

  // Register all IPC handlers
  registerWindowHandlers();
  registerStoreHandlers();
  registerRegistryHandlers();
  registerDataHandlers();
  registerSystemHandlers();
  registerLocalAppHandlers();

  // Set the app to open automatically when the computer/laptop boots up
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath
    });
  } catch (e) {
    console.error('Failed to set login item settings:', e);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Flush store and stop server before quitting
  if (backendServer) {
    backendServer.stop();
  }
  if (store) {
    store.flush();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure data is saved before the app exits
  if (backendServer) {
    backendServer.stop();
  }
  if (store) {
    store.flush();
  }
});

