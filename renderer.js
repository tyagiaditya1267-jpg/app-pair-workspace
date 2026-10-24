/**
 * renderer.js — App-Pair Workspace Engine
 * 
 * Manages real webviews (Google, Spotify, GitHub, ChatGPT, Notion),
 * local desktop apps (.exe / .lnk) with hardware/monitor snap and dock controller,
 * local offline PDF document readers with PDF.js & native Blob embeds,
 * Notion compatibility & Offline Notion Docs,
 * Custom App-Pair Builder & Add Application Modal,
 * built-in Idea Notes & Kanban Tasks,
 * Split Studio canvas, Common Palette, and AI Assistant.
 */

// Modern desktop Chrome User-Agent (Electron stripped out to prevent Notion blocks)
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Global Application State
const appState = {
  currentView: 'hub', // 'hub' | 'split'
  activePairId: null,
  splitRatio: 50, // percentage for left pane
  panes: {
    left: {
      type: 'google', // 'google' | 'spotify' | 'github' | 'chatgpt' | 'notion' | 'pdf' | 'notes' | 'tasks' | 'local-app' | 'custom'
      url: 'https://www.google.com',
      filePath: null,
      title: 'Google',
      notionOffline: false,
      appData: null
    },
    right: {
      type: 'notes',
      url: 'https://www.google.com',
      filePath: null,
      title: 'Idea Notes',
      notionOffline: false,
      appData: null
    }
  },
  customApps: [], // Pinned custom desktop apps and web apps
  recentPdfs: [],
  notes: {
    title: '',
    body: ''
  },
  notionOfflineDocs: {
    title: 'Product Architecture & Sprint Notes',
    body: `# Product Architecture & Sprint Notes

Welcome to your offline Notion-style documents workspace. Write specifications, tasks, and notes with markdown formatting.

## Key Goals
- [ ] Test side-by-side local PDF contract comparison
- [ ] Connect Spotify ambient music in Focus Flow
- [ ] Synthesize GitHub architecture alongside ChatGPT

> Pro-tip: Click "Live Notion.so" in the header to switch to cloud Notion.`
  },
  tasks: [
    { id: 't1', title: 'Review System Specs', desc: 'Inspect project architecture and layout', priority: 'high', status: 'progress' },
    { id: 't2', title: 'Setup App Pairs', desc: 'Verify real webviews for Google, Spotify, and GitHub', priority: 'medium', status: 'done' },
    { id: 't3', title: 'Local PDF Reading', desc: 'Test side-by-side offline document comparison', priority: 'low', status: 'todo' }
  ],
  snippets: [
    'https://developer.mozilla.org',
    'const app = require("electron");',
    '# Sprint Checklist\n- [ ] Compare Contract Drafts\n- [ ] Export Architecture diagram'
  ],
  swatches: ['#D94E1F', '#1E3A2F', '#1C1917', '#2563EB', '#F4F1EA']
};

// URL Mappings for Real Services
const URL_MAP = {
  google: 'https://www.google.com',
  spotify: 'https://open.spotify.com',
  github: 'https://github.com',
  chatgpt: 'https://chatgpt.com',
  notion: 'https://www.notion.so'
};

// Available Pairs Configuration
const PAIRS_CONFIG = {
  'pair-research': {
    title: 'Research & Synthesis',
    left: { type: 'google', url: URL_MAP.google, title: 'Google Search' },
    right: { type: 'notes', title: 'Idea Notes' }
  },
  'pair-coding': {
    title: 'AI Coding Assistant',
    left: { type: 'github', url: URL_MAP.github, title: 'GitHub' },
    right: { type: 'chatgpt', url: URL_MAP.chatgpt, title: 'ChatGPT' }
  },
  'pair-focus': {
    title: 'Focus Flow',
    left: { type: 'notion', url: URL_MAP.notion, title: 'Notion', notionOffline: false },
    right: { type: 'spotify', url: URL_MAP.spotify, title: 'Spotify' }
  },
  'pair-productivity': {
    title: 'Productivity Duo',
    left: { type: 'tasks', title: 'Task Board' },
    right: { type: 'notes', title: 'Idea Notes' }
  },
  'pair-dual-pdf': {
    title: 'Dual PDF Compare',
    left: { type: 'pdf', title: 'PDF Document 1' },
    right: { type: 'pdf', title: 'PDF Document 2' }
  },
  'pair-pdf-notes': {
    title: 'PDF & Idea Notes',
    left: { type: 'pdf', title: 'PDF Reader' },
    right: { type: 'notes', title: 'Idea Notes' }
  }
};

// PDF Runtime Manager: Tracks Active Blob URLs, Raw Bytes, PDF.js Docs, and View Modes
const activePdfBlobs = { left: null, right: null };
const activePdfBytes = { left: null, right: null };
const activePdfDocs = { left: null, right: null };
const pdfZoomLevels = { left: 1.15, right: 1.15 };
const pdfCurrentPages = { left: 1, right: 1 };
const pdfViewModes = { left: 'canvas', right: 'canvas' }; // 'canvas' | 'native'

// Initialize PDF.js worker if available
if (typeof window !== 'undefined' && window.pdfjsLib) {
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  } catch (e) {
    console.warn('PDF.js worker setup warning:', e);
  }
}

// Load Saved State from localStorage
function initStorage() {
  try {
    const saved = localStorage.getItem('app_pair_workspace_v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.notes) appState.notes = parsed.notes;
      if (parsed.notionOfflineDocs) appState.notionOfflineDocs = parsed.notionOfflineDocs;
      if (parsed.tasks && parsed.tasks.length > 0) appState.tasks = parsed.tasks;
      if (parsed.snippets && parsed.snippets.length > 0) appState.snippets = parsed.snippets;
      if (parsed.swatches && parsed.swatches.length > 0) appState.swatches = parsed.swatches;
      if (parsed.recentPdfs) appState.recentPdfs = parsed.recentPdfs;
      if (parsed.customApps && Array.isArray(parsed.customApps)) appState.customApps = parsed.customApps;
    }
  } catch (err) {
    console.warn('Could not read state from localStorage:', err);
  }
}

function persistStorage() {
  try {
    localStorage.setItem('app_pair_workspace_v2', JSON.stringify({
      notes: appState.notes,
      notionOfflineDocs: appState.notionOfflineDocs,
      tasks: appState.tasks,
      snippets: appState.snippets,
      swatches: appState.swatches,
      recentPdfs: appState.recentPdfs,
      customApps: appState.customApps
    }));
  } catch (err) {
    console.warn('Could not save state:', err);
  }
}

// Toast Notifications
function showToast(text) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = text;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

// DOM Elements
let hubView, splitView;
let paneLeft, paneRight, splitResizer;
let leftContentView, rightContentView;
let leftUrlInput, rightUrlInput;
let leftAppSelect, rightAppSelect;
let leftBrowsePdfBtn, rightBrowsePdfBtn;
let paletteDrawer, assistantDrawer;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  cacheDOMElements();
  bindWindowControls();
  bindNavigation();
  bindHubInteractions();
  bindSplitControls();
  bindDrawers();
  renderRecentPdfChips();
  renderSnippetsList();
  renderSwatches();
  setupSketchpad();
  setupAssistant();
  setupAddAppModal();
  setupCustomPairBuilder();
  renderCustomApps();
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheDOMElements() {
  hubView = document.getElementById('hub-view');
  splitView = document.getElementById('split-view');
  paneLeft = document.getElementById('pane-left');
  paneRight = document.getElementById('pane-right');
  splitResizer = document.getElementById('split-resizer');
  leftContentView = document.getElementById('left-content-view');
  rightContentView = document.getElementById('right-content-view');
  leftUrlInput = document.getElementById('left-url-input');
  rightUrlInput = document.getElementById('right-url-input');
  leftAppSelect = document.getElementById('left-app-select');
  rightAppSelect = document.getElementById('right-app-select');
  leftBrowsePdfBtn = document.getElementById('left-browse-pdf-btn');
  rightBrowsePdfBtn = document.getElementById('right-browse-pdf-btn');
  paletteDrawer = document.getElementById('palette-drawer');
  assistantDrawer = document.getElementById('assistant-drawer');
}

// ==========================================================================
// WINDOW CHROME CONTROLS
// ==========================================================================
function bindWindowControls() {
  const minBtn = document.getElementById('win-min-btn');
  const maxBtn = document.getElementById('win-max-btn');
  const closeBtn = document.getElementById('win-close-btn');

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      if (window.api && window.api.window) window.api.window.minimize();
    });
  }
  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      if (window.api && window.api.window) window.api.window.maximize();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.api && window.api.window) window.api.window.close();
    });
  }
}

// ==========================================================================
// NAVIGATION & VIEW SWITCHING
// ==========================================================================
function bindNavigation() {
  const navLauncher = document.getElementById('nav-launcher-btn');
  const navSplit = document.getElementById('nav-split-btn');
  const sideHub = document.getElementById('side-hub-btn');

  navLauncher.addEventListener('click', () => switchView('hub'));
  sideHub.addEventListener('click', () => switchView('hub'));
  navSplit.addEventListener('click', () => switchView('split'));

  // Top Search Bar (Ctrl+K)
  const topSearch = document.getElementById('top-search-input');
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      topSearch.focus();
      topSearch.select();
    }
  });

  topSearch.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = topSearch.value.trim();
      if (q) handleUniversalLaunch(q);
    }
  });

  // Sidebar Direct Shortcuts
  document.getElementById('side-google-btn').addEventListener('click', () => launchSingleApp('google'));
  document.getElementById('side-spotify-btn').addEventListener('click', () => launchSingleApp('spotify'));
  document.getElementById('side-github-btn').addEventListener('click', () => launchSingleApp('github'));
  document.getElementById('side-notion-btn').addEventListener('click', () => launchSingleApp('notion'));
  document.getElementById('side-chatgpt-btn').addEventListener('click', () => launchSingleApp('chatgpt'));
  document.getElementById('side-pdf-btn').addEventListener('click', () => launchSingleApp('pdf'));
  document.getElementById('side-notes-btn').addEventListener('click', () => launchSingleApp('notes'));
  document.getElementById('side-tasks-btn').addEventListener('click', () => launchSingleApp('tasks'));
  document.getElementById('side-palette-toggle-btn').addEventListener('click', togglePaletteDrawer);
  document.getElementById('side-assistant-toggle-btn').addEventListener('click', toggleAssistantDrawer);
}

function switchView(viewName) {
  appState.currentView = viewName;
  if (viewName === 'hub') {
    hubView.classList.remove('hidden');
    splitView.classList.add('hidden');
    document.getElementById('nav-launcher-btn').classList.add('active');
    document.getElementById('nav-split-btn').classList.remove('active');
    document.getElementById('side-hub-btn').classList.add('active');
  } else {
    hubView.classList.add('hidden');
    splitView.classList.remove('hidden');
    document.getElementById('nav-launcher-btn').classList.remove('active');
    document.getElementById('nav-split-btn').classList.add('active');
    document.getElementById('side-hub-btn').classList.remove('active');
    renderSplitPanes();
  }
}

// ==========================================================================
// WORKSPACE HUB INTERACTIONS
// ==========================================================================
function bindHubInteractions() {
  const hubSearchInput = document.getElementById('hub-search-input');
  const hubClearBtn = document.getElementById('hub-clear-search-btn');
  const hubGoBtn = document.getElementById('hub-go-btn');

  hubSearchInput.addEventListener('input', () => {
    const val = hubSearchInput.value.trim();
    if (val) {
      hubClearBtn.classList.remove('hidden');
      filterHubCards(val);
    } else {
      hubClearBtn.classList.add('hidden');
      filterHubCards('');
    }
  });

  hubClearBtn.addEventListener('click', () => {
    hubSearchInput.value = '';
    hubClearBtn.classList.add('hidden');
    filterHubCards('');
    hubSearchInput.focus();
  });

  const triggerGo = () => {
    const val = hubSearchInput.value.trim();
    if (val) handleUniversalLaunch(val);
  };

  hubGoBtn.addEventListener('click', triggerGo);
  hubSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') triggerGo();
  });

  // Quick Hint Chips
  document.querySelectorAll('.hint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.getAttribute('data-url');
      handleUniversalLaunch(url);
    });
  });

  // Launch Pair Buttons
  document.querySelectorAll('.launch-pair-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pairId = btn.getAttribute('data-pair');
      launchPair(pairId);
    });
  });

  // Offline PDF Shelf Buttons
  document.getElementById('hub-browse-pdf-btn').addEventListener('click', () => {
    pickLocalPdfFile('left', (pdfData) => {
      loadPdfInPane('left', pdfData);
      appState.panes.right = { type: 'notes', title: 'Idea Notes' };
      switchView('split');
    });
  });

  document.getElementById('hub-open-sample-pdf-btn').addEventListener('click', () => {
    loadPdfInPane('left', 'sample1.pdf');
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
    switchView('split');
  });

  // Single App Cards
  document.querySelectorAll('.single-app-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.single-app-delete-btn')) return;
      const launch = card.getAttribute('data-launch');
      const url = card.getAttribute('data-url');
      if (url) {
        handleUniversalLaunch(url);
      } else {
        launchSingleApp(launch);
      }
    });
  });
}

function filterHubCards(query) {
  const q = query.toLowerCase();
  const pairCards = document.querySelectorAll('.workspace-card');
  const appCards = document.querySelectorAll('.single-app-card');

  pairCards.forEach(card => {
    const text = card.innerText.toLowerCase();
    card.style.display = !q || text.includes(q) ? 'flex' : 'none';
  });

  appCards.forEach(card => {
    const text = card.innerText.toLowerCase();
    card.style.display = !q || text.includes(q) ? 'flex' : 'none';
  });
}

// Launching a Paired Workspace
function launchPair(pairId) {
  const config = PAIRS_CONFIG[pairId];
  if (!config) return;

  appState.activePairId = pairId;
  appState.panes.left = { ...config.left };
  appState.panes.right = { ...config.right };

  // Set sample documents if in dual PDF mode and no custom files chosen
  if (pairId === 'pair-dual-pdf') {
    if (!appState.panes.left.filePath) appState.panes.left.filePath = 'sample1.pdf';
    if (!appState.panes.right.filePath) appState.panes.right.filePath = 'sample2.pdf';
  } else if (pairId === 'pair-pdf-notes') {
    if (!appState.panes.left.filePath) appState.panes.left.filePath = 'sample1.pdf';
  }

  document.getElementById('current-pair-title').innerText = config.title;
  switchView('split');
  showToast(`Launched ${config.title}`);
}

// Launching an Individual App in Full View
function launchSingleApp(appType) {
  if (appType === 'palette') {
    togglePaletteDrawer();
    return;
  }
  if (appType === 'notes') {
    appState.panes.left = { type: 'notes', title: 'Idea Notes' };
    appState.panes.right = { type: 'tasks', title: 'Task Board' };
  } else if (appType === 'tasks') {
    appState.panes.left = { type: 'tasks', title: 'Task Board' };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
  } else if (appType === 'pdf') {
    pickLocalPdfFile('left', (pdfData) => {
      loadPdfInPane('left', pdfData);
      appState.panes.right = { type: 'notes', title: 'Idea Notes' };
      switchView('split');
    });
    return;
  } else if (appType === 'notion') {
    appState.panes.left = { type: 'notion', url: URL_MAP.notion, title: 'Notion', notionOffline: false };
    appState.panes.right = { type: 'spotify', url: URL_MAP.spotify, title: 'Spotify' };
  } else {
    const url = URL_MAP[appType] || 'https://www.google.com';
    appState.panes.left = { type: appType, url, title: appType.toUpperCase() };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
  }

  document.getElementById('current-pair-title').innerText = `${appType.toUpperCase()} Workspace`;
  switchView('split');
}

// Universal URL & Search Launcher
function handleUniversalLaunch(input) {
  let url = input.trim();
  if (!url) return;

  // Check if it's a URL
  if (/^https?:\/\//i.test(url) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(url)) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    appState.panes.left = { type: 'custom', url, title: new URL(url).hostname };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
  } else {
    // Google search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    appState.panes.left = { type: 'google', url: searchUrl, title: `Search: ${url}` };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
  }

  document.getElementById('current-pair-title').innerText = 'Web Studio';
  switchView('split');
  showToast(`Navigating to ${url}`);
}

// ==========================================================================
// SPLIT STUDIO CONTROLS & RESIZER
// ==========================================================================
function bindSplitControls() {
  document.getElementById('split-back-hub-btn').addEventListener('click', () => switchView('hub'));

  // Swap Left and Right Panes
  document.getElementById('split-swap-panes-btn').addEventListener('click', () => {
    const temp = appState.panes.left;
    appState.panes.left = appState.panes.right;
    appState.panes.right = temp;
    renderSplitPanes();
    showToast('Panes Swapped');
  });

  // Split Ratio Buttons
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const ratio = parseInt(btn.getAttribute('data-ratio'), 10);
      setSplitRatio(ratio);
    });
  });

  // Fullscreen Left / Right
  document.getElementById('split-left-fullscreen-btn').addEventListener('click', () => {
    setSplitRatio(100);
  });
  document.getElementById('split-right-fullscreen-btn').addEventListener('click', () => {
    setSplitRatio(0);
  });

  // Divider Dragging Physics
  let isDragging = false;
  splitResizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const canvas = document.getElementById('split-canvas');
    const rect = canvas.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const ratio = Math.max(15, Math.min(85, (offsetX / rect.width) * 100));
    setSplitRatio(ratio);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = 'default';
    }
  });

  // Pane App Switcher Dropdowns
  leftAppSelect.addEventListener('change', () => {
    handlePaneSelectChange('left', leftAppSelect.value);
  });
  rightAppSelect.addEventListener('change', () => {
    handlePaneSelectChange('right', rightAppSelect.value);
  });

  // Pane URL Inputs
  leftUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') navigatePaneUrl('left', leftUrlInput.value);
  });
  rightUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') navigatePaneUrl('right', rightUrlInput.value);
  });

  // Browse PDF Buttons on Pane Nav
  leftBrowsePdfBtn.addEventListener('click', () => pickLocalPdfFile('left', (file) => loadPdfInPane('left', file)));
  rightBrowsePdfBtn.addEventListener('click', () => pickLocalPdfFile('right', (file) => loadPdfInPane('right', file)));

  // Navigation Arrows
  document.getElementById('left-back-btn').addEventListener('click', () => navHistory('left', 'back'));
  document.getElementById('left-forward-btn').addEventListener('click', () => navHistory('left', 'forward'));
  document.getElementById('left-reload-btn').addEventListener('click', () => navHistory('left', 'reload'));

  document.getElementById('right-back-btn').addEventListener('click', () => navHistory('right', 'back'));
  document.getElementById('right-forward-btn').addEventListener('click', () => navHistory('right', 'forward'));
  document.getElementById('right-reload-btn').addEventListener('click', () => navHistory('right', 'reload'));
}

function setSplitRatio(ratio) {
  appState.splitRatio = ratio;
  if (ratio === 100) {
    paneLeft.style.width = '100%';
    paneRight.style.display = 'none';
    splitResizer.style.display = 'none';
  } else if (ratio === 0) {
    paneLeft.style.display = 'none';
    paneRight.style.width = '100%';
    splitResizer.style.display = 'none';
  } else {
    paneLeft.style.display = 'flex';
    paneRight.style.display = 'flex';
    splitResizer.style.display = 'flex';
    paneLeft.style.width = `${ratio}%`;
    paneRight.style.width = `${100 - ratio}%`;
  }
}

function handlePaneSelectChange(side, appType) {
  resolvePaneFromChoice(side, appType);
  renderPane(side);
}

function resolvePaneFromChoice(side, val) {
  if (val.startsWith('custom_')) {
    const appId = val.replace('custom_', '');
    const app = appState.customApps.find(a => a.id === appId);
    if (app) {
      if (app.type === 'local') {
        appState.panes[side] = {
          type: 'local-app',
          name: app.name,
          path: app.path,
          icon: app.icon,
          title: app.name
        };
      } else {
        appState.panes[side] = {
          type: 'custom',
          url: app.url,
          title: app.name
        };
      }
      return;
    }
  }

  // Built-in standard options
  if (val === 'pdf') {
    appState.panes[side] = { type: 'pdf', title: 'Local PDF Reader', filePath: 'sample1.pdf' };
  } else if (val === 'notes') {
    appState.panes[side] = { type: 'notes', title: 'Idea Notes' };
  } else if (val === 'tasks') {
    appState.panes[side] = { type: 'tasks', title: 'Task Board' };
  } else if (val === 'notion') {
    appState.panes[side] = { type: 'notion', url: URL_MAP.notion, title: 'Notion', notionOffline: false };
  } else {
    const url = URL_MAP[val] || 'https://www.google.com';
    appState.panes[side] = { type: val, url, title: val.toUpperCase() };
  }
}

function navigatePaneUrl(side, val) {
  let url = val.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(url)) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  appState.panes[side].url = url;
  renderPane(side);
}

function navHistory(side, action) {
  const container = side === 'left' ? leftContentView : rightContentView;
  const webview = container.querySelector('webview');
  if (!webview) return;
  try {
    if (action === 'back' && webview.canGoBack()) webview.goBack();
    if (action === 'forward' && webview.canGoForward()) webview.goForward();
    if (action === 'reload') webview.reload();
  } catch (e) {
    console.warn(e);
  }
}

// ==========================================================================
// RENDERING SPLIT PANES (REAL WEBVIEWS, LOCAL APPS, PDF, NOTION, NOTES, TASKS)
// ==========================================================================
function renderSplitPanes() {
  renderPane('left');
  renderPane('right');
}

async function renderPane(side) {
  const paneConfig = appState.panes[side];
  const container = side === 'left' ? leftContentView : rightContentView;
  const urlInput = side === 'left' ? leftUrlInput : rightUrlInput;
  const appSelect = side === 'left' ? leftAppSelect : rightAppSelect;
  const titleEl = document.getElementById(`${side}-pane-title`);
  const browseBtn = side === 'left' ? leftBrowsePdfBtn : rightBrowsePdfBtn;
  const paneNavCenter = urlInput.parentElement;

  // Clean existing dynamic toggle buttons
  const existingToggle = paneNavCenter.querySelector('.pane-nav-notion-toggle');
  if (existingToggle) existingToggle.remove();

  container.innerHTML = '';
  titleEl.innerText = paneConfig.title || paneConfig.type.toUpperCase();

  // Sync select value if possible
  if (paneConfig.type === 'local-app' && paneConfig.path) {
    const matched = appState.customApps.find(a => a.path === paneConfig.path);
    if (matched) appSelect.value = `custom_${matched.id}`;
  } else {
    appSelect.value = paneConfig.type;
  }

  // ----------------------------------------------------
  // MODE 1: LOCAL LAPTOP APPLICATION DOCK CONTROLLER
  // ----------------------------------------------------
  if (paneConfig.type === 'local-app') {
    browseBtn.style.display = 'none';
    urlInput.style.display = 'none';
    renderLocalAppDock(side, paneConfig, container);
    return;
  }

  // ----------------------------------------------------
  // MODE 2: NOTION (With Offline Docs Toggle & User-Agent Bypass)
  // ----------------------------------------------------
  if (paneConfig.type === 'notion') {
    browseBtn.style.display = 'none';

    const notionToggleBtn = document.createElement('button');
    notionToggleBtn.className = 'pane-nav-notion-toggle';
    notionToggleBtn.innerText = paneConfig.notionOffline ? '🌐 Live Notion.so' : '📝 Offline Notion Docs';
    notionToggleBtn.title = 'Switch between live cloud Notion and local offline Notion workspace';
    paneNavCenter.appendChild(notionToggleBtn);

    notionToggleBtn.addEventListener('click', () => {
      paneConfig.notionOffline = !paneConfig.notionOffline;
      renderPane(side);
    });

    if (paneConfig.notionOffline) {
      urlInput.style.display = 'none';
      renderOfflineNotionDocs(side, container);
      return;
    }

    urlInput.style.display = 'block';
    let targetUrl = paneConfig.url || URL_MAP.notion;
    if (targetUrl.includes('unsupported-browser')) {
      targetUrl = 'https://www.notion.so/login';
      paneConfig.url = targetUrl;
    }
    urlInput.value = targetUrl;

    const webview = document.createElement('webview');
    webview.setAttribute('src', targetUrl);
    webview.setAttribute('useragent', CHROME_USER_AGENT);
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('plugins', 'true');
    webview.style.width = '100%';
    webview.style.height = '100%';

    webview.addEventListener('will-navigate', (e) => {
      if (e.url && e.url.includes('unsupported-browser')) {
        e.preventDefault();
        webview.loadURL('https://www.notion.so/login');
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      if (e.url && e.url.includes('unsupported-browser')) {
        webview.loadURL('https://www.notion.so/login');
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      try {
        const cur = webview.getURL();
        if (cur && cur !== 'about:blank') {
          if (cur.includes('unsupported-browser')) {
            webview.loadURL('https://www.notion.so/login');
          } else {
            urlInput.value = cur;
          }
        }
      } catch (e) {}
    });

    webview.addEventListener('page-title-updated', (e) => {
      if (e.title && !e.title.includes('Notion')) titleEl.innerText = e.title;
    });

    container.appendChild(webview);
  }

  // ----------------------------------------------------
  // MODE 3: OTHER WEBVIEWS (Google, Spotify, GitHub, ChatGPT, Custom)
  // ----------------------------------------------------
  else if (['google', 'spotify', 'github', 'chatgpt', 'custom'].includes(paneConfig.type)) {
    browseBtn.style.display = 'none';
    urlInput.style.display = 'block';
    urlInput.value = paneConfig.url || URL_MAP[paneConfig.type] || 'https://www.google.com';

    const webview = document.createElement('webview');
    webview.setAttribute('src', urlInput.value);
    webview.setAttribute('useragent', CHROME_USER_AGENT);
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('plugins', 'true');
    webview.style.width = '100%';
    webview.style.height = '100%';

    webview.addEventListener('did-stop-loading', () => {
      try {
        const cur = webview.getURL();
        if (cur && cur !== 'about:blank') urlInput.value = cur;
      } catch (e) {}
    });

    webview.addEventListener('page-title-updated', (e) => {
      if (e.title) titleEl.innerText = e.title;
    });

    container.appendChild(webview);
  }

  // ----------------------------------------------------
  // MODE 4: LOCAL OFFLINE PDF READER (PDF.js + Native Typed Blob Embed)
  // ----------------------------------------------------
  else if (paneConfig.type === 'pdf') {
    browseBtn.style.display = 'flex';
    urlInput.style.display = 'none';

    const initialFile = paneConfig.filePath || 'sample1.pdf';
    await renderPdfViewerComponent(side, initialFile, container);
  }

  // ----------------------------------------------------
  // MODE 5: BUILT-IN MARKDOWN IDEA NOTES EDITOR
  // ----------------------------------------------------
  else if (paneConfig.type === 'notes') {
    browseBtn.style.display = 'none';
    urlInput.style.display = 'none';

    const notesEl = document.createElement('div');
    notesEl.className = 'notes-container';
    notesEl.innerHTML = `
      <input type="text" class="notes-title-input" id="${side}-note-title" placeholder="Untitled Idea Note..." value="${escapeHtml(appState.notes.title)}">
      <div class="notes-toolbar">
        <button class="notes-tool-btn" data-fmt="bold"><strong>B</strong></button>
        <button class="notes-tool-btn" data-fmt="italic"><em>I</em></button>
        <button class="notes-tool-btn" data-fmt="h2">H2</button>
        <button class="notes-tool-btn" data-fmt="list">• List</button>
        <button class="notes-tool-btn" data-fmt="quote">" Quote</button>
        <button class="notes-tool-btn" id="${side}-push-palette-btn"><i data-lucide="share-2"></i> Push to Palette</button>
      </div>
      <textarea class="notes-textarea" id="${side}-note-body" placeholder="Start typing ideas, specifications, or notes here...">${escapeHtml(appState.notes.body)}</textarea>
      <div class="notes-footer">
        <span id="${side}-word-count">0 words</span>
        <span>Auto-saved to local workspace</span>
      </div>
    `;

    container.appendChild(notesEl);
    if (window.lucide) window.lucide.createIcons();

    const titleInput = notesEl.querySelector(`#${side}-note-title`);
    const bodyInput = notesEl.querySelector(`#${side}-note-body`);
    const wordCount = notesEl.querySelector(`#${side}-word-count`);

    const updateNotes = () => {
      appState.notes.title = titleInput.value;
      appState.notes.body = bodyInput.value;
      const words = appState.notes.body.trim().split(/\s+/).filter(Boolean).length;
      wordCount.innerText = `${words} words`;
      persistStorage();
    };

    titleInput.addEventListener('input', updateNotes);
    bodyInput.addEventListener('input', updateNotes);
    updateNotes();

    notesEl.querySelectorAll('.notes-tool-btn[data-fmt]').forEach(b => {
      b.addEventListener('click', () => {
        const fmt = b.getAttribute('data-fmt');
        applyNoteFormatting(bodyInput, fmt);
        updateNotes();
      });
    });

    notesEl.querySelector(`#${side}-push-palette-btn`).addEventListener('click', () => {
      const text = `${titleInput.value}\n${bodyInput.value}`.trim();
      if (text) {
        appState.snippets.unshift(text);
        persistStorage();
        renderSnippetsList();
        showToast('Pushed note to Common Palette!');
      }
    });
  }

  // ----------------------------------------------------
  // MODE 6: BUILT-IN KANBAN TASK BOARD
  // ----------------------------------------------------
  else if (paneConfig.type === 'tasks') {
    browseBtn.style.display = 'none';
    urlInput.style.display = 'none';

    const kanbanEl = document.createElement('div');
    kanbanEl.className = 'kanban-container';
    kanbanEl.innerHTML = `
      <div class="kanban-header">
        <h3>Sprint Task Board</h3>
        <button class="tactile-btn primary" id="${side}-add-task-btn"><i data-lucide="plus"></i> Add Task</button>
      </div>
      <div class="kanban-columns">
        <div class="kanban-column" data-status="todo">
          <div class="column-header">TO DO (<span class="col-count">0</span>)</div>
          <div class="cards-list" id="${side}-todo-list"></div>
        </div>
        <div class="kanban-column" data-status="progress">
          <div class="column-header">IN PROGRESS (<span class="col-count">0</span>)</div>
          <div class="cards-list" id="${side}-progress-list"></div>
        </div>
        <div class="kanban-column" data-status="done">
          <div class="column-header">DONE (<span class="col-count">0</span>)</div>
          <div class="cards-list" id="${side}-done-list"></div>
        </div>
      </div>
    `;

    container.appendChild(kanbanEl);
    if (window.lucide) window.lucide.createIcons();
    renderKanbanCards(kanbanEl, side);

    kanbanEl.querySelector(`#${side}-add-task-btn`).addEventListener('click', () => {
      const title = prompt('Enter new task summary:');
      if (title) {
        appState.tasks.push({
          id: 't_' + Date.now(),
          title: title.trim(),
          desc: 'Created in task board',
          priority: 'medium',
          status: 'todo'
        });
        persistStorage();
        renderKanbanCards(kanbanEl, side);
        showToast('Task Added');
      }
    });
  }
}

// ==========================================================================
// LIVE LOCAL APP CONTROLLER DOCK
// ==========================================================================
function renderLocalAppDock(side, appInfo, container) {
  const dock = document.createElement('div');
  dock.className = 'local-app-dock';

  const iconHtml = appInfo.icon 
    ? `<img src="${appInfo.icon}" alt="${escapeHtml(appInfo.name)}">`
    : `<i data-lucide="terminal"></i>`;

  dock.innerHTML = `
    <div class="dock-badge-pill">
      <span class="dock-status-dot"></span>
      <span>LOCAL LAPTOP APPLICATION — RUNNING / READY</span>
    </div>

    <div class="dock-icon-box">
      ${iconHtml}
    </div>

    <h2 class="dock-app-name">${escapeHtml(appInfo.name)}</h2>
    <div class="dock-app-path" title="${escapeHtml(appInfo.path)}">${escapeHtml(appInfo.path)}</div>

    <p class="dock-app-notice">
      This application runs as a native Windows desktop window outside the browser. Use the docking controls below to launch, bring to front, or snap side-by-side on your monitor.
    </p>

    <div class="dock-action-buttons">
      <button class="dock-btn primary" id="${side}-dock-launch-btn">
        <i data-lucide="play"></i>
        <span>Launch / Bring App to Front</span>
      </button>

      <button class="dock-btn snap" id="${side}-dock-snap-btn" title="Snaps App-Pair Workspace to the other half of your screen while positioning this app next to it!">
        <i data-lucide="columns"></i>
        <span>Snap Side-by-Side on Monitor (50/50)</span>
      </button>

      <button class="dock-btn secondary" id="${side}-dock-relaunch-btn">
        <i data-lucide="rotate-cw"></i>
        <span>Close / Relaunch App</span>
      </button>
    </div>
  `;

  container.appendChild(dock);
  if (window.lucide) window.lucide.createIcons();

  dock.querySelector(`#${side}-dock-launch-btn`).addEventListener('click', async () => {
    if (window.api?.localApps?.launchApp) {
      await window.api.localApps.launchApp(appInfo.path);
      showToast(`🚀 Launched ${appInfo.name}`);
    }
  });

  dock.querySelector(`#${side}-dock-snap-btn`).addEventListener('click', async () => {
    if (window.api?.localApps?.snapWindowSplit) {
      await window.api.localApps.snapWindowSplit(side, appInfo.path);
      showToast(`◨ Snapped ${appInfo.name} side-by-side on monitor!`);
    }
  });

  dock.querySelector(`#${side}-dock-relaunch-btn`).addEventListener('click', async () => {
    if (window.api?.localApps?.launchApp) {
      await window.api.localApps.launchApp(appInfo.path);
      showToast(`↻ Relaunched ${appInfo.name}`);
    }
  });
}

// ==========================================================================
// OFFLINE NOTION DOCS WORKSPACE
// ==========================================================================
function renderOfflineNotionDocs(side, container) {
  const notionEl = document.createElement('div');
  notionEl.className = 'notion-offline-container';
  notionEl.innerHTML = `
    <div class="notion-offline-header">
      <div class="notion-badge-row">
        <span><i data-lucide="file-text"></i> OFFLINE NOTION WORKSPACE</span>
        <span style="color:#10B981;">• Local Mode</span>
      </div>
      <button class="notion-toggle-live-btn" id="${side}-notion-live-btn">
        <i data-lucide="globe"></i>
        <span>Live Notion.so</span>
      </button>
    </div>

    <input type="text" class="notion-title-input" id="${side}-notion-doc-title" placeholder="Untitled Notion Document..." value="${escapeHtml(appState.notionOfflineDocs.title)}">

    <div class="notion-quick-actions">
      <button class="notion-action-pill" data-insert="# ">+ Heading 1</button>
      <button class="notion-action-pill" data-insert="## ">+ Heading 2</button>
      <button class="notion-action-pill" data-insert="- [ ] ">+ Todo Item</button>
      <button class="notion-action-pill" data-insert="- ">+ Bullet</button>
      <button class="notion-action-pill" data-insert="\`\`\`javascript\n\n\`\`\`">+ Code</button>
      <button class="notion-action-pill" data-insert="> ">+ Quote</button>
    </div>

    <div class="notion-slash-hint">
      💡 Type standard Markdown or click any block shortcut above. All documents auto-save offline.
    </div>

    <textarea class="notion-editor-body" id="${side}-notion-doc-body" placeholder="Press Enter to type, or write markdown...">${escapeHtml(appState.notionOfflineDocs.body)}</textarea>
  `;

  container.appendChild(notionEl);
  if (window.lucide) window.lucide.createIcons();

  const titleInp = notionEl.querySelector(`#${side}-notion-doc-title`);
  const bodyInp = notionEl.querySelector(`#${side}-notion-doc-body`);

  const saveNotionDoc = () => {
    appState.notionOfflineDocs.title = titleInp.value;
    appState.notionOfflineDocs.body = bodyInp.value;
    persistStorage();
  };

  titleInp.addEventListener('input', saveNotionDoc);
  bodyInp.addEventListener('input', saveNotionDoc);

  notionEl.querySelectorAll('.notion-action-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const ins = btn.getAttribute('data-insert');
      const start = bodyInp.selectionStart;
      const end = bodyInp.selectionEnd;
      bodyInp.setRangeText(`\n${ins}`, start, end, 'end');
      saveNotionDoc();
      bodyInp.focus();
    });
  });

  notionEl.querySelector(`#${side}-notion-live-btn`).addEventListener('click', () => {
    appState.panes[side].notionOffline = false;
    renderPane(side);
  });
}

// ==========================================================================
// ROBUST LOCAL PDF VIEWER COMPONENT (PDF.js Canvas + Typed Blob Embed)
// ==========================================================================
async function renderPdfViewerComponent(side, initialFile, container) {
  const pdfData = await resolvePdfData(initialFile);
  if (!pdfData) {
    container.innerHTML = `<div style="padding:24px; color:#DC2626; font-family:var(--font-mono);">Failed to load PDF: ${initialFile}. Please select a valid .pdf file.</div>`;
    return;
  }

  if (activePdfBlobs[side] && activePdfBlobs[side] !== pdfData.blobUrl) {
    try { URL.revokeObjectURL(activePdfBlobs[side]); } catch (e) {}
  }
  activePdfBlobs[side] = pdfData.blobUrl;
  activePdfBytes[side] = pdfData.bytes;

  const fileName = pdfData.name || initialFile.split(/[\\/]/).pop();
  const currentZoom = pdfZoomLevels[side] || 1.15;
  const viewMode = pdfViewModes[side] || 'canvas';

  const pdfContainer = document.createElement('div');
  pdfContainer.className = 'pdf-viewer-container';
  pdfContainer.innerHTML = `
    <!-- Top PDF Controls Bar -->
    <div class="pdf-bar">
      <div class="pdf-bar-left">
        <i data-lucide="file-check"></i>
        <span class="pdf-file-label" title="${escapeHtml(fileName)}">Reading: ${escapeHtml(fileName)}</span>
      </div>

      <div class="pdf-bar-center">
        <button class="pdf-ctrl-btn" id="${side}-pdf-prev-btn" title="Previous Page">◄ Prev</button>
        <div class="pdf-page-display">
          <span>Page</span>
          <input type="number" id="${side}-pdf-page-inp" min="1" value="1">
          <span>/ <span id="${side}-pdf-total-pages">1</span></span>
        </div>
        <button class="pdf-ctrl-btn" id="${side}-pdf-next-btn" title="Next Page">Next ►</button>

        <span style="color:#57534E;">|</span>

        <button class="pdf-ctrl-btn" id="${side}-pdf-zoom-out" title="Zoom Out">-</button>
        <span class="pdf-file-label" id="${side}-pdf-zoom-label" style="min-width:38px; text-align:center;">${Math.round(currentZoom * 100)}%</span>
        <button class="pdf-ctrl-btn" id="${side}-pdf-zoom-in" title="Zoom In">+</button>
        <button class="pdf-ctrl-btn" id="${side}-pdf-fit-width" title="Fit to Pane Width">Fit</button>
      </div>

      <div class="pdf-bar-right">
        <button class="pdf-ctrl-btn" id="${side}-pdf-toggle-mode" title="Toggle between PDF.js canvas and native Chromium viewer">
          ⇄ ${viewMode === 'canvas' ? 'Native View' : 'Canvas View'}
        </button>
        <button class="pdf-ctrl-btn primary" id="${side}-reselect-pdf-btn">
          <i data-lucide="folder-open"></i> Change PDF...
        </button>
      </div>
    </div>

    <!-- Mode A: PDF.js Canvas Page Viewport -->
    <div class="pdf-canvas-viewport" id="${side}-pdf-canvas-viewport" style="${viewMode === 'canvas' ? '' : 'display:none;'}">
      <div style="color:var(--espresso); padding:24px; font-family:var(--font-mono); font-size:12px;">Rendering PDF document...</div>
    </div>

    <!-- Mode B: Native Chromium Embed with Plugins Enabled -->
    <iframe class="pdf-frame-view" id="${side}-pdf-native-frame" src="${pdfData.blobUrl}#toolbar=1" style="${viewMode === 'native' ? '' : 'display:none;'}"></iframe>
  `;

  container.appendChild(pdfContainer);
  if (window.lucide) window.lucide.createIcons();

  const canvasViewport = pdfContainer.querySelector(`#${side}-pdf-canvas-viewport`);
  const nativeFrame = pdfContainer.querySelector(`#${side}-pdf-native-frame`);
  const totalPagesEl = pdfContainer.querySelector(`#${side}-pdf-total-pages`);
  const pageInp = pdfContainer.querySelector(`#${side}-pdf-page-inp`);
  const zoomLabel = pdfContainer.querySelector(`#${side}-pdf-zoom-label`);

  await renderPdfJsCanvasPages(side, pdfData.bytes, canvasViewport, totalPagesEl);

  const reZoom = async (newZoom) => {
    pdfZoomLevels[side] = Math.max(0.5, Math.min(3.0, newZoom));
    zoomLabel.innerText = `${Math.round(pdfZoomLevels[side] * 100)}%`;
    await renderPdfJsCanvasPages(side, pdfData.bytes, canvasViewport, totalPagesEl);
  };

  pdfContainer.querySelector(`#${side}-pdf-zoom-in`).addEventListener('click', () => reZoom(pdfZoomLevels[side] + 0.15));
  pdfContainer.querySelector(`#${side}-pdf-zoom-out`).addEventListener('click', () => reZoom(pdfZoomLevels[side] - 0.15));
  pdfContainer.querySelector(`#${side}-pdf-fit-width`).addEventListener('click', () => reZoom(1.0));

  const scrollToPage = (p) => {
    const pageEl = document.getElementById(`${side}-page-${p}`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pageInp.value = p;
      pdfCurrentPages[side] = p;
    }
  };

  pdfContainer.querySelector(`#${side}-pdf-prev-btn`).addEventListener('click', () => {
    if (pdfCurrentPages[side] > 1) scrollToPage(pdfCurrentPages[side] - 1);
  });

  pdfContainer.querySelector(`#${side}-pdf-next-btn`).addEventListener('click', () => {
    const max = activePdfDocs[side]?.numPages || 1;
    if (pdfCurrentPages[side] < max) scrollToPage(pdfCurrentPages[side] + 1);
  });

  pageInp.addEventListener('change', () => {
    const val = parseInt(pageInp.value, 10);
    const max = activePdfDocs[side]?.numPages || 1;
    if (val >= 1 && val <= max) scrollToPage(val);
  });

  const toggleBtn = pdfContainer.querySelector(`#${side}-pdf-toggle-mode`);
  toggleBtn.addEventListener('click', () => {
    if (pdfViewModes[side] === 'canvas') {
      pdfViewModes[side] = 'native';
      canvasViewport.style.display = 'none';
      nativeFrame.style.display = 'block';
      toggleBtn.innerText = '⇄ Canvas View';
    } else {
      pdfViewModes[side] = 'canvas';
      canvasViewport.style.display = 'flex';
      nativeFrame.style.display = 'none';
      toggleBtn.innerText = '⇄ Native View';
    }
  });

  pdfContainer.querySelector(`#${side}-reselect-pdf-btn`).addEventListener('click', () => {
    pickLocalPdfFile(side, (newPdfData) => loadPdfInPane(side, newPdfData));
  });
}

async function renderPdfJsCanvasPages(side, bytes, viewportEl, totalPagesEl) {
  if (!window.pdfjsLib) {
    viewportEl.innerHTML = `<div style="padding:24px; font-family:var(--font-mono); font-size:12px;">PDF.js worker loading... Please use native view.</div>`;
    return;
  }

  try {
    const loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice() });
    const pdfDoc = await loadingTask.promise;
    activePdfDocs[side] = pdfDoc;
    viewportEl.innerHTML = '';

    const numPages = pdfDoc.numPages;
    if (totalPagesEl) totalPagesEl.innerText = numPages;

    const zoom = pdfZoomLevels[side] || 1.15;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom });

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.id = `${side}-page-${pageNum}`;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      pageWrapper.appendChild(canvas);
      viewportEl.appendChild(pageWrapper);

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      await page.render(renderContext).promise;
    }
  } catch (err) {
    console.error('PDF.js render error:', err);
    viewportEl.innerHTML = `
      <div style="padding:24px; color:#DC2626; font-family:var(--font-mono); font-size:12px;">
        Notice: PDF.js canvas render could not parse stream. Showing embedded native viewer...
      </div>
    `;
    const nativeFrame = document.getElementById(`${side}-pdf-native-frame`);
    if (nativeFrame) {
      nativeFrame.style.display = 'block';
      viewportEl.style.display = 'none';
    }
  }
}

async function resolvePdfData(source) {
  if (!source) return null;

  if (typeof source === 'object' && source.bytes && source.blobUrl) {
    return source;
  }

  if (source instanceof File) {
    const arrayBuffer = await source.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    return { bytes, blobUrl, name: source.name, path: source.path || source.name };
  }

  if (typeof source === 'string') {
    let resolvedPath = source;
    if (source === 'sample1.pdf' || source === 'sample2.pdf' || source.startsWith('data/')) {
      resolvedPath = source.startsWith('data/') ? source : `data/${source}`;
    }

    if (window.api && window.api.system && window.api.system.readPdfFile) {
      try {
        const fileRes = await window.api.system.readPdfFile(resolvedPath);
        if (fileRes && fileRes.success && fileRes.data) {
          const binaryString = atob(fileRes.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          return { bytes, blobUrl, name: fileRes.name || source.split(/[\\/]/).pop(), path: resolvedPath };
        }
      } catch (e) {
        console.warn('readPdfFile error:', e);
      }
    }

    try {
      const resp = await fetch(resolvedPath);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        return { bytes, blobUrl, name: source.split(/[\\/]/).pop(), path: source };
      }
    } catch (e) {
      console.warn('Fetch fallback error:', e);
    }
  }

  return null;
}

async function pickLocalPdfFile(side = 'left', callback) {
  if (window.api && window.api.system && window.api.system.openFileDialog) {
    try {
      const res = await window.api.system.openFileDialog({
        title: 'Select PDF Document',
        filters: [{ name: 'PDF Documents (*.pdf)', extensions: ['pdf'] }]
      });
      if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
        const filePath = res.filePaths[0];
        const pdfData = await resolvePdfData(filePath);
        if (pdfData) {
          addRecentPdf(filePath);
          callback(pdfData);
          return;
        }
      }
    } catch (err) {
      console.warn('Native dialog failed, falling back to input:', err);
    }
  }

  const fileInput = document.getElementById('pdf-file-selector');
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const pdfData = await resolvePdfData(file);
      if (pdfData) {
        addRecentPdf(file.path || file.name);
        callback(pdfData);
      }
    }
  };
  fileInput.click();
}

function loadPdfInPane(side, pdfDataOrPath) {
  const name = typeof pdfDataOrPath === 'object' ? pdfDataOrPath.name : pdfDataOrPath.split(/[\\/]/).pop();
  appState.panes[side] = {
    type: 'pdf',
    filePath: typeof pdfDataOrPath === 'string' ? pdfDataOrPath : pdfDataOrPath.path,
    title: name
  };
  renderPane(side);
  showToast(`Loaded ${name}`);
}

function addRecentPdf(path) {
  if (!appState.recentPdfs.includes(path)) {
    appState.recentPdfs.unshift(path);
    if (appState.recentPdfs.length > 5) appState.recentPdfs.pop();
    persistStorage();
    renderRecentPdfChips();
  }
}

function renderRecentPdfChips() {
  const container = document.getElementById('recent-chips-container');
  if (!container) return;
  if (appState.recentPdfs.length === 0) {
    container.innerHTML = '<span class="chip-empty">No recent files yet. Click Browse to open a PDF.</span>';
    return;
  }
  container.innerHTML = '';
  appState.recentPdfs.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'recent-file-chip';
    chip.innerHTML = `<i data-lucide="file"></i> <span>${escapeHtml(p.split(/[\\/]/).pop())}</span>`;
    chip.addEventListener('click', () => {
      loadPdfInPane('left', p);
      appState.panes.right = { type: 'notes', title: 'Idea Notes' };
      switchView('split');
    });
    container.appendChild(chip);
  });
  if (window.lucide) window.lucide.createIcons();
}

// ==========================================================================
// PINNED CUSTOM APPS (SIDEBAR, HUB, DROPDOWNS & REMOVAL)
// ==========================================================================
function renderCustomApps() {
  const sidebarContainer = document.getElementById('sidebar-custom-apps');
  const singleAppsGrid = document.getElementById('single-apps-grid');
  const leftSelect = document.getElementById('left-app-select');
  const rightSelect = document.getElementById('right-app-select');
  const builderLeft = document.getElementById('builder-left-select');
  const builderRight = document.getElementById('builder-right-select');

  // 1. Sidebar Pinned Custom Apps
  if (sidebarContainer) {
    sidebarContainer.innerHTML = '';
    appState.customApps.forEach(app => {
      const btn = document.createElement('button');
      btn.className = 'side-btn custom-app-btn';
      btn.setAttribute('data-id', app.id);
      btn.title = `${app.name} (${app.type === 'local' ? 'Laptop App' : 'Web App'})`;
      
      const iconHtml = app.icon 
        ? `<img src="${app.icon}" alt="App">` 
        : (app.type === 'local' ? `<i data-lucide="terminal"></i>` : `<i data-lucide="globe"></i>`);

      btn.innerHTML = `
        ${iconHtml}
        <span class="side-tooltip">${escapeHtml(app.name)}</span>
        <span class="remove-custom-btn" title="Remove App">✕</span>
      `;

      btn.querySelector('.remove-custom-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomApp(app.id);
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`Remove "${app.name}" from workspace?`)) {
          removeCustomApp(app.id);
        }
      });

      btn.addEventListener('click', () => launchCustomApp(app));
      sidebarContainer.appendChild(btn);
    });
  }

  // 2. Hub Single Apps Grid
  if (singleAppsGrid) {
    document.querySelectorAll('.custom-single-card').forEach(el => el.remove());
    appState.customApps.forEach(app => {
      const card = document.createElement('div');
      card.className = 'single-app-card custom-single-card';
      const iconHtml = app.icon 
        ? `<img src="${app.icon}" style="width:24px;height:24px;object-fit:contain;">` 
        : (app.type === 'local' ? `<i data-lucide="terminal"></i>` : `<i data-lucide="globe"></i>`);

      card.innerHTML = `
        <div class="single-app-icon">${iconHtml}</div>
        <div class="single-app-meta">
          <h4>${escapeHtml(app.name)}</h4>
          <span>${app.type === 'local' ? 'Laptop App' : 'Custom Web App'}</span>
        </div>
        <button class="open-app-btn">Open</button>
        <button class="single-app-delete-btn" title="Remove App"><i data-lucide="trash-2"></i></button>
      `;

      card.querySelector('.open-app-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        launchCustomApp(app);
      });

      card.querySelector('.single-app-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomApp(app.id);
      });

      card.addEventListener('click', () => launchCustomApp(app));
      singleAppsGrid.appendChild(card);
    });
  }

  // 3. Dropdowns (Pane Switchers and Custom Pair Builder)
  [leftSelect, rightSelect, builderLeft, builderRight].forEach(sel => {
    if (!sel) return;
    sel.querySelectorAll('.custom-app-opt').forEach(opt => opt.remove());
    appState.customApps.forEach(app => {
      const opt = document.createElement('option');
      opt.className = 'custom-app-opt';
      opt.value = `custom_${app.id}`;
      opt.innerText = `${app.name} (${app.type === 'local' ? 'Laptop App' : 'Web App'})`;
      sel.appendChild(opt);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function launchCustomApp(app) {
  if (app.type === 'local') {
    // Open in split view with Live Local App Controller Dock
    appState.panes.left = {
      type: 'local-app',
      name: app.name,
      path: app.path,
      icon: app.icon,
      title: app.name
    };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
    document.getElementById('current-pair-title').innerText = `${app.name} + Idea Notes`;
    switchView('split');

    // Also trigger native launch on laptop
    if (window.api?.localApps?.launchApp) {
      window.api.localApps.launchApp(app.path);
      showToast(`🚀 Launched ${app.name}`);
    }
  } else {
    // Custom Web App
    appState.panes.left = { type: 'custom', url: app.url, title: app.name };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
    document.getElementById('current-pair-title').innerText = `${app.name} Workspace`;
    switchView('split');
  }
}

function removeCustomApp(appId) {
  const app = appState.customApps.find(a => a.id === appId);
  const name = app ? app.name : 'App';
  appState.customApps = appState.customApps.filter(a => a.id !== appId);
  persistStorage();
  renderCustomApps();
  showToast(`Removed ${name}`);
}

// ==========================================================================
// CUSTOM APP-PAIR BUILDER IN WORKSPACE HUB
// ==========================================================================
function setupCustomPairBuilder() {
  const leftSelect = document.getElementById('builder-left-select');
  const rightSelect = document.getElementById('builder-right-select');
  const launchBtn = document.getElementById('builder-launch-btn');
  if (!launchBtn) return;
  let selectedRatio = 50;

  document.querySelectorAll('.b-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.b-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRatio = parseInt(btn.getAttribute('data-ratio'), 10);
    });
  });

  launchBtn.addEventListener('click', () => {
    const leftVal = leftSelect.value;
    const rightVal = rightSelect.value;

    resolvePaneFromChoice('left', leftVal);
    resolvePaneFromChoice('right', rightVal);

    setSplitRatio(selectedRatio);
    document.getElementById('current-pair-title').innerText = `Custom App-Pair (${appState.panes.left.title} + ${appState.panes.right.title})`;
    switchView('split');
    showToast(`Launched Custom Pair (${appState.panes.left.title} + ${appState.panes.right.title})`);
  });
}

// ==========================================================================
// ADD APPLICATION OR SITE MODAL LOGIC
// ==========================================================================
function setupAddAppModal() {
  const modal = document.getElementById('add-app-modal');
  const openBtn = document.getElementById('side-add-site-btn');
  const closeBtn = document.getElementById('close-add-modal-btn');
  const browseBtn = document.getElementById('modal-browse-app-btn');
  const savePickedBtn = document.getElementById('modal-save-picked-app-btn');
  const formGrid = document.getElementById('local-app-form-grid');
  const searchDetectedInp = document.getElementById('detected-app-search');
  const saveWebBtn = document.getElementById('modal-save-web-app-btn');

  let currentPickedApp = null;
  let detectedAppsCache = [];

  const openModal = async () => {
    modal.classList.remove('hidden');
    scanAndRenderInstalledApps();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    formGrid.style.display = 'none';
    currentPickedApp = null;
  };

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Modal Tab Switching
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-modal-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // 1. Browse Laptop for App (.exe / .lnk)
  browseBtn.addEventListener('click', async () => {
    if (window.api?.localApps?.pickLocalApp) {
      const res = await window.api.localApps.pickLocalApp();
      if (!res.canceled && res.path) {
        currentPickedApp = res;
        document.getElementById('picked-app-name').value = res.name;
        document.getElementById('picked-app-path').value = res.path;
        
        const previewBox = document.getElementById('picked-icon-preview');
        if (res.icon) {
          previewBox.innerHTML = `<img src="${res.icon}" alt="Icon">`;
        } else {
          previewBox.innerHTML = `<i data-lucide="terminal"></i>`;
          if (window.lucide) window.lucide.createIcons();
        }

        formGrid.style.display = 'flex';
      }
    }
  });

  // Save Picked Local App
  savePickedBtn.addEventListener('click', () => {
    if (!currentPickedApp) return;
    const name = document.getElementById('picked-app-name').value.trim() || currentPickedApp.name;
    const cat = document.getElementById('picked-app-category').value;

    const newApp = {
      id: 'app_' + Date.now(),
      name,
      type: 'local',
      path: currentPickedApp.path,
      icon: currentPickedApp.icon || null,
      category: cat
    };

    appState.customApps.push(newApp);
    persistStorage();
    renderCustomApps();
    closeModal();
    showToast(`Added ${name} to Workspace`);
  });

  // 2. Scan & Render Installed Laptop Apps
  async function scanAndRenderInstalledApps() {
    const listEl = document.getElementById('detected-apps-list');
    const countBadge = document.getElementById('detected-apps-count');
    countBadge.innerText = 'Scanning...';

    if (window.api?.localApps?.scanInstalledApps) {
      const res = await window.api.localApps.scanInstalledApps();
      if (res && res.success && res.apps) {
        detectedAppsCache = res.apps;
        countBadge.innerText = `${res.apps.length} FOUND`;
        renderDetectedAppsList(detectedAppsCache);
      } else {
        countBadge.innerText = '0 FOUND';
        listEl.innerHTML = '<div style="padding:16px;color:var(--ink-muted);font-size:12px;">No shortcut apps found. Use the Browse button above.</div>';
      }
    }
  }

  function renderDetectedAppsList(apps) {
    const listEl = document.getElementById('detected-apps-list');
    listEl.innerHTML = '';
    if (apps.length === 0) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--ink-muted);font-size:12px;">No matching applications found.</div>';
      return;
    }

    apps.forEach(appItem => {
      const itemEl = document.createElement('div');
      itemEl.className = 'detected-app-item';
      const iconHtml = appItem.icon 
        ? `<img src="${appItem.icon}" alt="Icon">` 
        : `<i data-lucide="terminal"></i>`;

      itemEl.innerHTML = `
        <div class="detected-item-info">
          ${iconHtml}
          <div class="detected-item-text">
            <span class="detected-item-name">${escapeHtml(appItem.name)}</span>
            <span class="detected-item-path" title="${escapeHtml(appItem.path)}">${escapeHtml(appItem.path)}</span>
          </div>
        </div>
        <button class="add-detected-btn">+ Add</button>
      `;

      itemEl.querySelector('.add-detected-btn').addEventListener('click', () => {
        const newApp = {
          id: 'app_' + Date.now() + Math.random().toString(36).substr(2, 4),
          name: appItem.name,
          type: 'local',
          path: appItem.path,
          icon: appItem.icon || null,
          category: 'Productivity'
        };
        appState.customApps.push(newApp);
        persistStorage();
        renderCustomApps();
        closeModal();
        showToast(`Added ${appItem.name} to Workspace`);
      });

      listEl.appendChild(itemEl);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // Filter detected apps by search input
  searchDetectedInp.addEventListener('input', () => {
    const q = searchDetectedInp.value.toLowerCase().trim();
    if (!q) {
      renderDetectedAppsList(detectedAppsCache);
    } else {
      const filtered = detectedAppsCache.filter(a => 
        a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q)
      );
      renderDetectedAppsList(filtered);
    }
  });

  // 3. Save Web App
  saveWebBtn.addEventListener('click', () => {
    const nameInp = document.getElementById('web-app-name-input');
    const urlInp = document.getElementById('web-app-url-input');
    const catInp = document.getElementById('web-app-category-input');

    let name = nameInp.value.trim();
    let url = urlInp.value.trim();
    if (!url) {
      alert('Please enter a valid website URL.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (!name) {
      try { name = new URL(url).hostname; } catch (e) { name = 'Web App'; }
    }

    const newApp = {
      id: 'app_' + Date.now(),
      name,
      type: 'web',
      path: null,
      url,
      icon: null,
      category: catInp.value
    };

    appState.customApps.push(newApp);
    persistStorage();
    renderCustomApps();
    nameInp.value = '';
    urlInp.value = '';
    closeModal();
    showToast(`Added ${name} to Workspace`);
  });
}

// Kanban Helper Functions
function renderKanbanCards(kanbanEl, side) {
  const todoList = kanbanEl.querySelector(`#${side}-todo-list`);
  const progList = kanbanEl.querySelector(`#${side}-progress-list`);
  const doneList = kanbanEl.querySelector(`#${side}-done-list`);

  todoList.innerHTML = '';
  progList.innerHTML = '';
  doneList.innerHTML = '';

  appState.tasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.innerHTML = `
      <div class="kanban-card-title">${escapeHtml(task.title)}</div>
      <div class="kanban-card-desc">${escapeHtml(task.desc)}</div>
      <div style="display:flex; justify-content:space-between; margin-top:8px;">
        <select class="task-status-sel" data-task-id="${task.id}" style="font-size:10px;">
          <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
          <option value="progress" ${task.status === 'progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
        <button class="delete-task-btn" data-task-id="${task.id}" style="border:none; background:none; cursor:pointer; color:#DC2626;">✕</button>
      </div>
    `;

    card.querySelector('.task-status-sel').addEventListener('change', (e) => {
      task.status = e.target.value;
      persistStorage();
      renderKanbanCards(kanbanEl, side);
    });

    card.querySelector('.delete-task-btn').addEventListener('click', () => {
      appState.tasks = appState.tasks.filter(t => t.id !== task.id);
      persistStorage();
      renderKanbanCards(kanbanEl, side);
    });

    if (task.status === 'todo') todoList.appendChild(card);
    else if (task.status === 'progress') progList.appendChild(card);
    else doneList.appendChild(card);
  });
}

function applyNoteFormatting(textarea, fmt) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const sel = textarea.value.substring(start, end) || 'text';
  let replacement = '';

  if (fmt === 'bold') replacement = `**${sel}**`;
  if (fmt === 'italic') replacement = `*${sel}*`;
  if (fmt === 'h2') replacement = `\n## ${sel}\n`;
  if (fmt === 'list') replacement = `\n- ${sel}`;
  if (fmt === 'quote') replacement = `\n> ${sel}\n`;

  textarea.setRangeText(replacement, start, end, 'end');
}

// ==========================================================================
// COMMON PALETTE & DRAWERS
// ==========================================================================
function bindDrawers() {
  const navPalette = document.getElementById('nav-palette-btn');
  const navAssistant = document.getElementById('nav-assistant-btn');
  const closePalette = document.getElementById('close-palette-drawer-btn');
  const closeAssistant = document.getElementById('close-assistant-drawer-btn');

  navPalette.addEventListener('click', togglePaletteDrawer);
  closePalette.addEventListener('click', togglePaletteDrawer);

  navAssistant.addEventListener('click', toggleAssistantDrawer);
  closeAssistant.addEventListener('click', toggleAssistantDrawer);

  // Palette Tabs
  document.querySelectorAll('.drawer-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drawer-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.drawer-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Save Snippet
  document.getElementById('drawer-save-snippet-btn').addEventListener('click', () => {
    const input = document.getElementById('drawer-snippet-input');
    const val = input.value.trim();
    if (val) {
      appState.snippets.unshift(val);
      persistStorage();
      renderSnippetsList();
      input.value = '';
      showToast('Snippet Stored');
    }
  });

  // Save Swatch
  document.getElementById('drawer-save-color-btn').addEventListener('click', () => {
    const hex = document.getElementById('drawer-color-hex').value.trim();
    if (hex && !appState.swatches.includes(hex)) {
      appState.swatches.unshift(hex);
      persistStorage();
      renderSwatches();
      showToast('Color Added');
    }
  });

  document.getElementById('drawer-color-picker').addEventListener('input', (e) => {
    document.getElementById('drawer-color-hex').value = e.target.value.toUpperCase();
  });
}

function togglePaletteDrawer() {
  paletteDrawer.classList.toggle('open');
  if (paletteDrawer.classList.contains('open')) {
    assistantDrawer.classList.remove('open');
  }
}

function toggleAssistantDrawer() {
  assistantDrawer.classList.toggle('open');
  if (assistantDrawer.classList.contains('open')) {
    paletteDrawer.classList.remove('open');
    document.getElementById('assistant-input').focus();
  }
}

function renderSnippetsList() {
  const list = document.getElementById('drawer-snippets-list');
  if (!list) return;
  list.innerHTML = '';
  appState.snippets.forEach((snip, idx) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    card.innerHTML = `
      <div>${escapeHtml(snip)}</div>
      <div class="snippet-actions">
        <button class="snippet-btn copy-btn">Copy</button>
        <button class="snippet-btn push-btn">Push to Note</button>
        <button class="snippet-btn del-btn" style="color:#DC2626;">Delete</button>
      </div>
    `;

    card.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(snip);
      showToast('Copied to Clipboard!');
    });

    card.querySelector('.push-btn').addEventListener('click', () => {
      appState.notes.body += `\n\n${snip}`;
      persistStorage();
      showToast('Appended to Notes');
    });

    card.querySelector('.del-btn').addEventListener('click', () => {
      appState.snippets.splice(idx, 1);
      persistStorage();
      renderSnippetsList();
    });

    list.appendChild(card);
  });
}

function renderSwatches() {
  const grid = document.getElementById('drawer-colors-grid');
  if (!grid) return;
  grid.innerHTML = '';
  appState.swatches.forEach(c => {
    const swatch = document.createElement('div');
    swatch.style.width = '36px';
    swatch.style.height = '36px';
    swatch.style.backgroundColor = c;
    swatch.style.border = '1.5px solid #1C1917';
    swatch.style.cursor = 'pointer';
    swatch.title = `Click to copy ${c}`;
    swatch.addEventListener('click', () => {
      navigator.clipboard.writeText(c);
      showToast(`Copied ${c}`);
    });
    grid.appendChild(swatch);
  });
}

// Sketchpad Canvas
function setupSketchpad() {
  const canvas = document.getElementById('drawer-sketch-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let currentColor = '#1C1917';
  let brushSize = 4;

  const brushInput = document.getElementById('sketch-brush-size');
  brushInput.addEventListener('input', (e) => brushSize = e.target.value);

  document.querySelectorAll('.sketch-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.sketch-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      currentColor = dot.getAttribute('data-color');
    });
  });

  document.getElementById('sketch-clear-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  });

  window.addEventListener('mouseup', () => drawing = false);

  document.getElementById('sketch-save-btn').addEventListener('click', () => {
    const dataUrl = canvas.toDataURL();
    const grid = document.getElementById('drawer-sketches-grid');
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '70px';
    img.style.height = '50px';
    img.style.border = '1px solid #1C1917';
    grid.prepend(img);
    showToast('Sketch Saved');
  });
}

// ==========================================================================
// AI ASSISTANT CONVERSATION & AUTOMATION
// ==========================================================================
function setupAssistant() {
  const sendBtn = document.getElementById('assistant-send-btn');
  const input = document.getElementById('assistant-input');
  const messagesContainer = document.getElementById('assistant-messages');

  const executeCommand = (text) => {
    const q = text.trim();
    if (!q) return;

    // Append User message
    const userMsg = document.createElement('div');
    userMsg.className = 'assistant-bubble user';
    userMsg.innerHTML = `<p>${escapeHtml(q)}</p>`;
    messagesContainer.appendChild(userMsg);
    input.value = '';

    // Process with Smart Workspace Rules
    setTimeout(() => {
      const lower = q.toLowerCase();
      let responseText = '';

      if (lower.includes('spotify') || lower.includes('music')) {
        responseText = 'Opening **Spotify Web Player** in your workspace!';
        launchSingleApp('spotify');
      } else if (lower.includes('google') || lower.includes('search')) {
        responseText = 'Opening **Google Search** webview.';
        launchSingleApp('google');
      } else if (lower.includes('dual pdf') || lower.includes('compare pdf')) {
        responseText = 'Launching **Dual PDF Compare** side-by-side.';
        launchPair('pair-dual-pdf');
      } else if (lower.includes('github') || lower.includes('coding')) {
        responseText = 'Launching **AI Coding Assistant** (GitHub + ChatGPT).';
        launchPair('pair-coding');
      } else if (lower.includes('notion')) {
        responseText = 'Opening **Notion Workspace** in Focus Flow.';
        launchPair('pair-focus');
      } else if (lower.includes('mail') || lower.includes('@')) {
        const match = q.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const email = match ? match[1] : 'your account';
        responseText = `Credential **"${email}"** detected. Navigating to sign-in and ready to assist!`;
        handleUniversalLaunch('https://accounts.google.com');
      } else {
        responseText = `Command received: "${escapeHtml(q)}". Executing workspace task...`;
        handleUniversalLaunch(q);
      }

      const botMsg = document.createElement('div');
      botMsg.className = 'assistant-bubble bot';
      botMsg.innerHTML = `
        <div class="bubble-header"><i data-lucide="bot"></i> <strong>Assistant Jarvis</strong></div>
        <p>${responseText}</p>
      `;
      messagesContainer.appendChild(botMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      if (window.lucide) window.lucide.createIcons();
    }, 300);
  };

  sendBtn.addEventListener('click', () => executeCommand(input.value));
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand(input.value);
    }
  });

  // Assistant Quick Query Chips
  document.querySelectorAll('.chat-hint').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query');
      executeCommand(q);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
