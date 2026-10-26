const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, session, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');

let mammoth = null;
try { mammoth = require('mammoth'); } catch (e) { console.warn('mammoth load warning:', e.message); }

let docx = null;
try { docx = require('docx'); } catch (e) { console.warn('docx load warning:', e.message); }

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

  // Helper function to snap an external Windows application to a screen rectangle
  function positionExternalAppWindow(appPath, targetX, targetY, targetW, targetH) {
    if (!appPath) return;
    const baseName = path.basename(appPath, path.extname(appPath)).replace(/[^a-zA-Z0-9_\-\s]/g, '');
    const psScript = `
\$code = @"
using System;
using System.Runtime.InteropServices;
public class WinOps {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
Add-Type -TypeDefinition \$code -ErrorAction SilentlyContinue

\$base = "${baseName}"
for (\$i = 0; \$i -lt 15; \$i++) {
  Start-Sleep -Milliseconds 300
  \$proc = Get-Process | Where-Object { \$_.MainWindowHandle -ne [IntPtr]::Zero -and (\$_.ProcessName -like "*\$base*" -or \$_.MainWindowTitle -like "*\$base*") } | Select-Object -First 1
  if (\$proc) {
    [WinOps]::ShowWindow(\$proc.MainWindowHandle, 9)
    [WinOps]::MoveWindow(\$proc.MainWindowHandle, ${targetX}, ${targetY}, ${targetW}, ${targetH}, \$true)
    [WinOps]::SetForegroundWindow(\$proc.MainWindowHandle)
    break
  }
}
`;
    exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\r?\n/g, '; ')}"`, (err) => {
      if (err) console.warn('positionExternalAppWindow notice:', err.message);
    });
  }

  // 4. Snap window side-by-side on laptop monitor (50/50 hardware snap)
  ipcMain.handle('snap-window-split', async (event, { side, appPath }) => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.workArea;
      const halfWidth = Math.floor(width / 2);

      let appTargetX = x;
      let appTargetW = halfWidth;

      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        }

        // If local app is on the LEFT pane of the workspace,
        // snap App-Pair Workspace to the RIGHT half of the monitor so the local app is on the LEFT!
        if (side === 'left') {
          mainWindow.setBounds({
            x: x + halfWidth,
            y: y,
            width: width - halfWidth,
            height: height
          });
          appTargetX = x;
          appTargetW = halfWidth;
        } else {
          // If local app is on the RIGHT pane of the workspace,
          // snap App-Pair Workspace to the LEFT half of the monitor!
          mainWindow.setBounds({
            x: x,
            y: y,
            width: halfWidth,
            height: height
          });
          appTargetX = x + halfWidth;
          appTargetW = width - halfWidth;
        }
      }

      if (appPath) {
        await shell.openPath(appPath).catch(() => {
          exec(`"${appPath}"`);
        });
        positionExternalAppWindow(appPath, appTargetX, y, appTargetW, height);
      }

      return { success: true };
    } catch (err) {
      console.error('snap-window-split error:', err);
      return { success: false, error: err.message };
    }
  });

  // 5. True 50/50 Native App Half-Window Snapper (Feature 2)
  ipcMain.handle('snap-native-app-half-window', async (event, { appPath, side = 'left' }) => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.workArea;
      const halfWidth = Math.floor(width / 2);

      // App-Pair Workspace snaps to the opposite side of the native app
      const workspaceX = side === 'left' ? x + halfWidth : x;
      const workspaceW = side === 'left' ? width - halfWidth : halfWidth;

      const nativeX = side === 'left' ? x : x + halfWidth;
      const nativeW = side === 'left' ? halfWidth : width - halfWidth;

      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        }
        mainWindow.setBounds({
          x: workspaceX,
          y: y,
          width: workspaceW,
          height: height
        });
      }

      if (appPath) {
        await shell.openPath(appPath).catch(() => {
          exec(`"${appPath}"`);
        });
        positionExternalAppWindow(appPath, nativeX, y, nativeW, height);
      }

      return { success: true, nativeBounds: { x: nativeX, y, width: nativeW, height } };
    } catch (err) {
      console.error('snap-native-app-half-window error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ========================================
// IPC HANDLERS — IN-APP WORD DOCUMENT STUDIO (Feature 6)
// ========================================

function registerWordHandlers() {
  const docsDir = path.join(app.getPath('userData'), 'saved_word_docs');
  if (!fs.existsSync(docsDir)) {
    try { fs.mkdirSync(docsDir, { recursive: true }); } catch (e) {}
  }

  // 1. Pick real .docx / .doc / .rtf file from laptop and convert to clean HTML
  ipcMain.handle('word:pickFile', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open Word Document (.docx, .doc, .rtf)',
        filters: [
          { name: 'Word Documents', extensions: ['docx', 'doc', 'rtf', 'txt', 'md'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).toLowerCase();
      const title = path.basename(filePath, ext);
      let html = '';
      let rawText = '';

      if (ext === '.docx' && mammoth) {
        const fileBuffer = fs.readFileSync(filePath);
        const conversion = await mammoth.convertToHtml({ buffer: fileBuffer });
        html = conversion.value || '<p></p>';
        rawText = (await mammoth.extractRawText({ buffer: fileBuffer })).value || '';
      } else {
        rawText = fs.readFileSync(filePath, 'utf8');
        html = rawText.split(/\r?\n\r?\n/).map(p => `<p>${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
      }

      return {
        success: true,
        filePath,
        title,
        html,
        rawText,
        wordCount: rawText ? rawText.trim().split(/\s+/).length : 0
      };
    } catch (err) {
      console.error('word:pickFile error:', err);
      return { success: false, error: err.message };
    }
  });

  // 2. Save document inside App Workspace (userData/saved_word_docs/)
  ipcMain.handle('word:saveDocWorkspace', async (event, docData) => {
    try {
      if (!docData || !docData.id) {
        docData = Object.assign({ id: 'doc_' + Date.now() }, docData);
      }
      const safeId = String(docData.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const docFile = path.join(docsDir, `${safeId}.json`);
      const payload = {
        id: docData.id,
        title: docData.title || 'Untitled Document',
        html: docData.html || '',
        plainText: docData.plainText || '',
        wordCount: docData.wordCount || 0,
        filePath: docData.filePath || null,
        lastEdited: new Date().toISOString(),
        createdAt: docData.createdAt || new Date().toISOString()
      };
      fs.writeFileSync(docFile, JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, doc: payload };
    } catch (err) {
      console.error('word:saveDocWorkspace error:', err);
      return { success: false, error: err.message };
    }
  });

  // 3. Get all saved Word Documents for shelf / workspace resume
  ipcMain.handle('word:getSavedDocs', async () => {
    try {
      if (!fs.existsSync(docsDir)) return { success: true, docs: [] };
      const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.json'));
      const docs = [];
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(docsDir, f), 'utf8');
          docs.push(JSON.parse(raw));
        } catch (e) {}
      }
      docs.sort((a, b) => new Date(b.lastEdited || 0) - new Date(a.lastEdited || 0));
      return { success: true, docs };
    } catch (err) {
      console.error('word:getSavedDocs error:', err);
      return { success: false, error: err.message, docs: [] };
    }
  });

  // 4. Delete saved Word Document
  ipcMain.handle('word:deleteSavedDoc', async (event, id) => {
    try {
      const safeId = String(id).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const docFile = path.join(docsDir, `${safeId}.json`);
      if (fs.existsSync(docFile)) {
        fs.unlinkSync(docFile);
      }
      return { success: true };
    } catch (err) {
      console.error('word:deleteSavedDoc error:', err);
      return { success: false, error: err.message };
    }
  });

  // 5. Export back to real .docx file on laptop
  ipcMain.handle('word:exportDocx', async (event, { title, plainText, html, suggestedPath }) => {
    try {
      const defaultName = (title || 'Document').replace(/[^a-zA-Z0-9_\-\s]/g, '') + '.docx';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Document to .docx',
        defaultPath: suggestedPath || path.join(app.getPath('documents'), defaultName),
        filters: [
          { name: 'Word Document (*.docx)', extensions: ['docx'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const outPath = result.filePath;

      if (docx) {
        const lines = (plainText || '').split(/\r?\n/);
        const docxParagraphs = lines.map(line => {
          if (!line.trim()) {
            return new docx.Paragraph({ text: '' });
          }
          if (line.startsWith('# ')) {
            return new docx.Paragraph({
              text: line.replace(/^#\s+/, ''),
              heading: docx.HeadingLevel.HEADING_1
            });
          }
          if (line.startsWith('## ')) {
            return new docx.Paragraph({
              text: line.replace(/^##\s+/, ''),
              heading: docx.HeadingLevel.HEADING_2
            });
          }
          return new docx.Paragraph({
            children: [new docx.TextRun(line)]
          });
        });

        const doc = new docx.Document({
          sections: [{
            properties: {},
            children: docxParagraphs.length > 0 ? docxParagraphs : [new docx.Paragraph({ text: title || 'Document' })]
          }]
        });

        const buffer = await docx.Packer.toBuffer(doc);
        fs.writeFileSync(outPath, buffer);
      } else {
        // Fallback: write text/html or RTF content
        fs.writeFileSync(outPath, plainText || html || '', 'utf8');
      }

      return { success: true, filePath: outPath };
    } catch (err) {
      console.error('word:exportDocx error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ========================================
// IPC HANDLERS — COMMON PALETTE EXTERNAL PASTE (Feature 4)
// ========================================

function registerExternalPasteHandlers() {
  ipcMain.handle('paste-to-external-app', async (event, { target, text }) => {
    try {
      const cleanText = text || '';
      clipboard.writeText(cleanText);

      if (target === 'notepad') {
        const tempPath = path.join(app.getPath('temp'), 'palette-transfer.txt');
        fs.writeFileSync(tempPath, cleanText, 'utf8');
        exec(`notepad.exe "${tempPath}"`, (err) => {
          if (err) console.warn('notepad open notice:', err.message);
        });
        return { success: true, target: 'notepad', filePath: tempPath };
      }

      if (target === 'word') {
        // Automate Microsoft Word via COM or temp RTF file
        const tempRtf = path.join(app.getPath('temp'), 'palette-transfer.rtf');
        const rtfEscaped = cleanText
          .replace(/\\/g, '\\\\')
          .replace(/{/g, '\\{')
          .replace(/}/g, '\\}')
          .replace(/\r?\n/g, '\\par\n');
        const rtfContent = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Calibri;}} \\f0\\fs24 ${rtfEscaped}}`;
        fs.writeFileSync(tempRtf, rtfContent, 'utf8');

        const escapedText = cleanText.replace(/'/g, "''").replace(/\r?\n/g, ' ');
        const psWord = `try { \$word = New-Object -ComObject Word.Application; \$word.Visible = \$true; \$doc = \$word.Documents.Add(); \$word.Selection.TypeText('${escapedText}'); \$word.Activate() } catch { Start-Process 'winword.exe' '${tempRtf.replace(/\\/g, '\\\\')}' }`;
        exec(`powershell -NoProfile -Command "${psWord}"`, (err) => {
          if (err) {
            // Fallback: open temp RTF with default application (Word / WordPad)
            shell.openPath(tempRtf);
          }
        });
        return { success: true, target: 'word' };
      }

      return { success: true };
    } catch (err) {
      console.error('paste-to-external-app error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ========================================
// IPC HANDLERS — USAGE & SCREEN TIME ANALYTICS (Feature 3)
// ========================================

function registerUsageHandlers() {
  const usageFile = path.join(app.getPath('userData'), 'usage-history.json');

  ipcMain.handle('usage:saveAnalytics', async (event, data) => {
    try {
      fs.writeFileSync(usageFile, JSON.stringify(data, null, 2), 'utf8');
      return { success: true };
    } catch (err) {
      console.error('usage:saveAnalytics error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('usage:getAnalytics', async () => {
    try {
      if (fs.existsSync(usageFile)) {
        const raw = fs.readFileSync(usageFile, 'utf8');
        return { success: true, data: JSON.parse(raw) };
      }
      return { success: true, data: null };
    } catch (err) {
      console.error('usage:getAnalytics error:', err);
      return { success: false, error: err.message, data: null };
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
  registerWordHandlers();
  registerExternalPasteHandlers();
  registerUsageHandlers();

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

