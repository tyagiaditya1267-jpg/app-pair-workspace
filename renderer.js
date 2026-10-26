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
      type: 'google', // 'google' | 'spotify' | 'github' | 'chatgpt' | 'notion' | 'pdf' | 'notes' | 'tasks' | 'local-app' | 'custom' | 'word'
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
  swatches: ['#D94E1F', '#1E3A2F', '#1C1917', '#2563EB', '#F4F1EA'],
  // Telemetry & Screen Time (Feature 3)
  usage: {
    todaySeconds: 0,
    cumulativeSeconds: {},
    pairSeconds: {},
    sessions: [],
    sessionStart: Date.now()
  },
  // In-App Word Document Studio (Feature 6)
  wordDoc: {
    id: 'doc_default',
    title: 'Specification Notes.docx',
    html: '',
    plainText: '',
    wordCount: 0,
    charCount: 0,
    filePath: null,
    lastEdited: null
  },
  savedWordDocs: [],
  // Palette Auto-Sync (Feature 4)
  paletteAutoSync: false,
  paletteSyncTarget: 'notes'
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
const activePdfPageTexts = { left: {}, right: {} };
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
      if (parsed.paletteAutoSync !== undefined) appState.paletteAutoSync = parsed.paletteAutoSync;
      if (parsed.paletteSyncTarget) appState.paletteSyncTarget = parsed.paletteSyncTarget;
      if (parsed.wordDoc) appState.wordDoc = Object.assign({}, appState.wordDoc, parsed.wordDoc);
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
      customApps: appState.customApps,
      paletteAutoSync: appState.paletteAutoSync,
      paletteSyncTarget: appState.paletteSyncTarget,
      wordDoc: appState.wordDoc
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
let hubView, splitView, usageView, wordDocView;
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
  initUsageAnalytics();
  setupPaletteBridge();
  setupWordStudio();
  setupInstantUrlOpening();
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheDOMElements() {
  hubView = document.getElementById('hub-view');
  splitView = document.getElementById('split-view');
  usageView = document.getElementById('usage-history-view');
  wordDocView = document.getElementById('word-doc-view');
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
  
  const sideWordBtn = document.getElementById('side-word-btn');
  if (sideWordBtn) sideWordBtn.addEventListener('click', () => switchView('word-doc'));

  const sideHistoryBtn = document.getElementById('side-history-btn');
  if (sideHistoryBtn) sideHistoryBtn.addEventListener('click', () => switchView('usage'));

  const hubViewAnalyticsBtn = document.getElementById('hub-view-analytics-btn');
  if (hubViewAnalyticsBtn) hubViewAnalyticsBtn.addEventListener('click', () => switchView('usage'));

  const usageBackHubBtn = document.getElementById('usage-back-hub-btn');
  if (usageBackHubBtn) usageBackHubBtn.addEventListener('click', () => switchView('hub'));

  const wordBackHubBtn = document.getElementById('word-back-hub-btn');
  if (wordBackHubBtn) wordBackHubBtn.addEventListener('click', () => switchView('hub'));

  document.getElementById('side-palette-toggle-btn').addEventListener('click', togglePaletteDrawer);
  document.getElementById('side-assistant-toggle-btn').addEventListener('click', toggleAssistantDrawer);
}

function switchView(viewName) {
  appState.currentView = viewName;
  const allViews = [hubView, splitView, usageView, wordDocView].filter(Boolean);
  allViews.forEach(v => v.classList.add('hidden'));

  const navLauncher = document.getElementById('nav-launcher-btn');
  const navSplit = document.getElementById('nav-split-btn');
  const sideHub = document.getElementById('side-hub-btn');
  const sideWord = document.getElementById('side-word-btn');
  const sideHistory = document.getElementById('side-history-btn');

  [navLauncher, navSplit, sideHub, sideWord, sideHistory].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  if (viewName === 'hub') {
    if (hubView) hubView.classList.remove('hidden');
    if (navLauncher) navLauncher.classList.add('active');
    if (sideHub) sideHub.classList.add('active');
    updateHubScreenTimeStrip();
    renderWordSavedDocsShelf();
  } else if (viewName === 'split') {
    if (splitView) splitView.classList.remove('hidden');
    if (navSplit) navSplit.classList.add('active');
    renderSplitPanes();
  } else if (viewName === 'usage') {
    if (usageView) usageView.classList.remove('hidden');
    if (sideHistory) sideHistory.classList.add('active');
    renderUsageAnalytics();
  } else if (viewName === 'word-doc') {
    if (wordDocView) wordDocView.classList.remove('hidden');
    if (sideWord) sideWord.classList.add('active');
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
  logSession(config.left.title, config.right.title, 50);
  showToast(`Launched ${config.title}`);
}

// Launching an Individual App in Full View
function launchSingleApp(appType) {
  if (appType === 'palette') {
    togglePaletteDrawer();
    return;
  }
  if (appType === 'word') {
    switchView('word-doc');
    return;
  }
  if (appType === 'history') {
    switchView('usage');
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
      logSession('Local PDF Reader', 'Idea Notes', 50);
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
  logSession(appState.panes.left.title, appState.panes.right.title, 50);
}

// URL Detection & Formatting Helper (Feature 5)
function detectAndFormatUrl(raw) {
  if (!raw) return null;
  const str = raw.trim();
  if (/^https?:\/\//i.test(str)) return str;
  if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(str)) {
    return 'http://' + str;
  }
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(str) || /^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(str)) {
    return 'https://' + str;
  }
  return null;
}

function setupInstantUrlOpening() {
  const hubSearch = document.getElementById('hub-search-input');
  const topSearch = document.getElementById('top-search-input');

  const bindInstant = (inp) => {
    if (!inp) return;
    inp.addEventListener('paste', () => {
      setTimeout(() => {
        const text = inp.value.trim();
        const url = detectAndFormatUrl(text);
        if (url) {
          handleUniversalLaunch(url);
        }
      }, 50);
    });
  };

  bindInstant(hubSearch);
  bindInstant(topSearch);
}

// Universal URL & Search Launcher
function handleUniversalLaunch(input) {
  let text = input.trim();
  if (!text) return;

  const formattedUrl = detectAndFormatUrl(text);
  if (formattedUrl) {
    try {
      const u = new URL(formattedUrl);
      appState.panes.left = { type: 'custom', url: formattedUrl, title: u.hostname || 'Web App' };
    } catch (e) {
      appState.panes.left = { type: 'custom', url: formattedUrl, title: 'Web App' };
    }
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
    logSession(appState.panes.left.title, 'Idea Notes', 50);
  } else {
    // Google search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    appState.panes.left = { type: 'google', url: searchUrl, title: `Search: ${text}` };
    appState.panes.right = { type: 'notes', title: 'Idea Notes' };
    logSession(`Search: ${text}`, 'Idea Notes', 50);
  }

  document.getElementById('current-pair-title').innerText = 'Web Studio';
  switchView('split');
  showToast(`Navigating to ${formattedUrl || text}`);
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
  if (!val) return;

  // 1. Support Entity Objects (e.g. from AIAgent, Custom Pair Builder, or Add Modal)
  if (typeof val === 'object') {
    if (val.isNative || val.isLocal || val.type === 'local' || val.type === 'local-app' || val.path) {
      appState.panes[side] = {
        type: 'local-app',
        name: val.name,
        path: val.path,
        icon: val.icon || null,
        title: val.name
      };
    } else if (val.type === 'word') {
      appState.panes[side] = { type: 'word', title: 'Word Document Studio' };
    } else if (val.type === 'pdf') {
      appState.panes[side] = { type: 'pdf', title: val.title || 'Local PDF Reader', filePath: val.filePath || 'sample1.pdf' };
    } else if (val.type === 'notes') {
      appState.panes[side] = { type: 'notes', title: 'Idea Notes' };
    } else if (val.type === 'tasks') {
      appState.panes[side] = { type: 'tasks', title: 'Task Board' };
    } else if (val.type === 'notion') {
      appState.panes[side] = { type: 'notion', url: URL_MAP.notion, title: 'Notion', notionOffline: false };
    } else if (val.type === 'custom' || val.type === 'web' || val.url) {
      appState.panes[side] = {
        type: 'custom',
        url: val.url,
        title: val.name || val.title || 'Web App'
      };
    } else {
      const u = val.url || URL_MAP[val.type || val.id] || 'https://www.google.com';
      appState.panes[side] = { type: val.type || val.id || 'google', url: u, title: val.name || val.title || 'Google' };
    }
    return;
  }

  // 2. String Choices
  if (typeof val === 'string' && val.startsWith('custom_')) {
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
  } else if (val === 'word') {
    appState.panes[side] = { type: 'word', title: 'Word Document Studio' };
  } else if (val === 'tasks') {
    appState.panes[side] = { type: 'tasks', title: 'Task Board' };
  } else if (val === 'notion') {
    appState.panes[side] = { type: 'notion', url: URL_MAP.notion, title: 'Notion', notionOffline: false };
  } else {
    // Check if matching custom app by name
    const customMatch = appState.customApps.find(a => a.name.toLowerCase() === val.toLowerCase());
    if (customMatch) {
      if (customMatch.type === 'local') {
        appState.panes[side] = {
          type: 'local-app',
          name: customMatch.name,
          path: customMatch.path,
          icon: customMatch.icon,
          title: customMatch.name
        };
      } else {
        appState.panes[side] = {
          type: 'custom',
          url: customMatch.url,
          title: customMatch.name
        };
      }
      return;
    }

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

  // ----------------------------------------------------
  // MODE 7: IN-APP WORD DOCUMENT STUDIO (Inline Split Mode)
  // ----------------------------------------------------
  else if (paneConfig.type === 'word') {
    browseBtn.style.display = 'none';
    urlInput.style.display = 'none';
    renderWordEditorComponent(side, container);
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
// ROBUST LOCAL PDF VIEWER COMPONENT (PDF.js Canvas + Selectable Text Layer + Typed Blob Embed)
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
  activePdfPageTexts[side] = {};

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

        <span style="color:#57534E;">|</span>

        <button class="pdf-ctrl-btn" id="${side}-pdf-copy-page-btn" title="Copy all text from the current PDF page">
          <i data-lucide="copy"></i> Copy Page Text
        </button>
      </div>

      <div class="pdf-bar-right">
        <button class="pdf-ctrl-btn" id="${side}-pdf-toggle-mode" title="Toggle between PDF.js canvas with text selection and native Chromium viewer">
          <i data-lucide="layers"></i> <span>Mode: ${viewMode === 'canvas' ? 'Canvas + Text' : 'Native PDF'}</span>
        </button>
        <button class="pdf-ctrl-btn primary" id="${side}-reselect-pdf-btn">
          <i data-lucide="folder-open"></i> Change PDF...
        </button>
      </div>
    </div>

    <!-- Floating Selection Action Bar (Feature Upgrade) -->
    <div class="pdf-floating-toolbar hidden" id="${side}-pdf-floating-toolbar">
      <button class="pdf-float-btn" id="${side}-float-copy-btn" title="Copy text to clipboard (Ctrl+C)">
        <i data-lucide="copy"></i> Copy Text (Ctrl+C)
      </button>
      <button class="pdf-float-btn accent" id="${side}-float-notes-btn" title="Send selected text to Idea Notes editor">
        <i data-lucide="arrow-right-circle"></i> &gt;&gt; Send to Idea Notes
      </button>
      <button class="pdf-float-btn" id="${side}-float-palette-btn" title="Push selected text to Common Palette">
        <i data-lucide="share-2"></i> Push to Palette
      </button>
    </div>

    <!-- Mode A: PDF.js Canvas Page Viewport with Text Selection Overlay -->
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
  const floatingBar = pdfContainer.querySelector(`#${side}-pdf-floating-toolbar`);

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

  // Copy Full Page Text Button
  const copyPageBtn = pdfContainer.querySelector(`#${side}-pdf-copy-page-btn`);
  if (copyPageBtn) {
    copyPageBtn.addEventListener('click', () => {
      const curP = pdfCurrentPages[side] || 1;
      const text = activePdfPageTexts[side]?.[curP];
      if (text && text.trim()) {
        navigator.clipboard.writeText(text.trim());
        showToast(`Copied Page ${curP} text (${text.trim().length} chars)!`);
      } else {
        showToast(`No text found on Page ${curP}`);
      }
    });
  }

  // Toggle Mode (Canvas + Text vs Native PDF)
  const toggleBtn = pdfContainer.querySelector(`#${side}-pdf-toggle-mode`);
  toggleBtn.addEventListener('click', () => {
    if (pdfViewModes[side] === 'canvas') {
      pdfViewModes[side] = 'native';
      canvasViewport.style.display = 'none';
      nativeFrame.style.display = 'block';
      toggleBtn.innerHTML = '<i data-lucide="layers"></i> <span>Mode: Native PDF</span>';
      showToast('Switched to Native Chromium PDF Viewer');
    } else {
      pdfViewModes[side] = 'canvas';
      canvasViewport.style.display = 'block';
      nativeFrame.style.display = 'none';
      toggleBtn.innerHTML = '<i data-lucide="layers"></i> <span>Mode: Canvas + Text</span>';
      showToast('Switched to Canvas + Selectable Text');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  pdfContainer.querySelector(`#${side}-reselect-pdf-btn`).addEventListener('click', () => {
    pickLocalPdfFile(side, (newPdfData) => loadPdfInPane(side, newPdfData));
  });

  // Floating Action Bar & Text Selection Handling
  let lastSelectedPdfText = '';

  const updateFloatingToolbarPosition = () => {
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : '';

    if (!selectedText) {
      if (floatingBar) floatingBar.classList.add('hidden');
      lastSelectedPdfText = '';
      return;
    }

    if (!sel.rangeCount || !pdfContainer.contains(sel.anchorNode)) {
      if (floatingBar) floatingBar.classList.add('hidden');
      return;
    }

    lastSelectedPdfText = selectedText;

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = pdfContainer.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        const topPos = Math.max(46, rect.top - containerRect.top - 46);
        const leftPos = Math.max(12, Math.min(containerRect.width - 340, rect.left - containerRect.left + (rect.width / 2) - 160));

        floatingBar.style.top = `${topPos}px`;
        floatingBar.style.left = `${leftPos}px`;
        floatingBar.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      }
    } catch (err) {
      floatingBar.classList.remove('hidden');
    }
  };

  pdfContainer.addEventListener('mouseup', () => {
    setTimeout(updateFloatingToolbarPosition, 30);
  });

  pdfContainer.addEventListener('keyup', (e) => {
    if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      updateFloatingToolbarPosition();
    }
  });

  // Copy (Ctrl+C / Cmd+C) inside PDF
  pdfContainer.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const selText = window.getSelection()?.toString()?.trim();
      if (selText) {
        navigator.clipboard.writeText(selText);
        showToast('Copied selected text (Ctrl+C)!');
      }
    }
  });

  // Right-Click Copy
  pdfContainer.addEventListener('contextmenu', (e) => {
    const selText = window.getSelection()?.toString()?.trim();
    if (selText) {
      navigator.clipboard.writeText(selText);
      showToast('Copied selected text to clipboard!');
    }
  });

  // Floating Action Bar Buttons
  const floatCopyBtn = pdfContainer.querySelector(`#${side}-float-copy-btn`);
  if (floatCopyBtn) {
    floatCopyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    floatCopyBtn.addEventListener('click', () => {
      const textToCopy = lastSelectedPdfText || window.getSelection()?.toString()?.trim();
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        showToast('Copied text to clipboard!');
        if (floatingBar) floatingBar.classList.add('hidden');
      }
    });
  }

  const floatNotesBtn = pdfContainer.querySelector(`#${side}-float-notes-btn`);
  if (floatNotesBtn) {
    floatNotesBtn.addEventListener('mousedown', (e) => e.preventDefault());
    floatNotesBtn.addEventListener('click', () => {
      const textToSend = lastSelectedPdfText || window.getSelection()?.toString()?.trim();
      if (textToSend) {
        const otherSide = side === 'left' ? 'right' : 'left';
        pasteIntoNotesPane(textToSend, otherSide);
        showToast('Inserted selection into Idea Notes!');
        if (floatingBar) floatingBar.classList.add('hidden');
      }
    });
  }

  const floatPaletteBtn = pdfContainer.querySelector(`#${side}-float-palette-btn`);
  if (floatPaletteBtn) {
    floatPaletteBtn.addEventListener('mousedown', (e) => e.preventDefault());
    floatPaletteBtn.addEventListener('click', () => {
      const textToPush = lastSelectedPdfText || window.getSelection()?.toString()?.trim();
      if (textToPush) {
        appState.snippets.unshift(textToPush);
        persistStorage();
        renderSnippetsList();
        showToast('Pushed selection to Common Palette!');
        if (floatingBar) floatingBar.classList.add('hidden');
      }
    });
  }
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
    activePdfPageTexts[side] = {};
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
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'pdf-text-layer';
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

      pageWrapper.appendChild(canvas);
      pageWrapper.appendChild(textLayerDiv);
      viewportEl.appendChild(pageWrapper);

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      await page.render(renderContext).promise;

      // Extract and render selectable text overlay
      const textContent = await page.getTextContent();
      activePdfPageTexts[side][pageNum] = textContent.items.map(i => i.str).filter(Boolean).join(' ');

      let renderedTextLayer = false;
      if (window.pdfjsLib && typeof window.pdfjsLib.renderTextLayer === 'function') {
        try {
          const textLayerTask = window.pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
          });
          if (textLayerTask && textLayerTask.promise) {
            await textLayerTask.promise;
            renderedTextLayer = true;
          }
        } catch (err) {
          console.warn('pdfjsLib.renderTextLayer error:', err);
        }
      }

      if (!renderedTextLayer) {
        // Precise manual transform fallback
        textLayerDiv.innerHTML = '';
        for (const item of textContent.items) {
          if (!item.str) continue;
          const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]) || (item.height * viewport.scale) || 12;
          const span = document.createElement('span');
          span.textContent = item.str;
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = item.fontName || 'sans-serif';
          textLayerDiv.appendChild(span);
        }
      }
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

  // Save & Open in 50/50 Split (Feature 2)
  const splitPickedBtn = document.getElementById('modal-split-picked-app-btn');
  if (splitPickedBtn) {
    splitPickedBtn.addEventListener('click', () => {
      if (!currentPickedApp) return;
      const name = document.getElementById('picked-app-name').value.trim() || currentPickedApp.name;
      const cat = document.getElementById('picked-app-category').value;
      const companion = document.getElementById('picked-app-companion-select')?.value || 'notes';

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

      window.launchCustomSplitPair(newApp, companion, 50);
    });
  }

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
        <div class="detected-actions" style="display:flex; gap:6px;">
          <button class="add-detected-btn">+ Add</button>
          <button class="split-detected-btn" title="Add and open in 50/50 Split View">+ 50/50 Split</button>
        </div>
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

      itemEl.querySelector('.split-detected-btn').addEventListener('click', () => {
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

        const companion = document.getElementById('picked-app-companion-select')?.value || 'notes';
        window.launchCustomSplitPair(newApp, companion, 50);
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

  // Save Web App & Open in 50/50 Split (Feature 2)
  const splitWebBtn = document.getElementById('modal-split-web-app-btn');
  if (splitWebBtn) {
    splitWebBtn.addEventListener('click', () => {
      const nameInp = document.getElementById('web-app-name-input');
      const urlInp = document.getElementById('web-app-url-input');
      const catInp = document.getElementById('web-app-category-input');
      const companion = document.getElementById('web-app-companion-select')?.value || 'notes';

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

      window.launchCustomSplitPair(newApp, companion, 50);
    });
  }
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
// DUAL-APP SPLIT LAUNCHER WITH WIN32 SNAP (Feature 1 & Feature 2)
// ==========================================================================
window.launchCustomSplitPair = async function(appA, appB, ratio = 50) {
  resolvePaneFromChoice('left', appA);
  resolvePaneFromChoice('right', appB);

  setSplitRatio(ratio);

  const titleA = appState.panes.left.title || 'App A';
  const titleB = appState.panes.right.title || 'App B';
  const pairTitleEl = document.getElementById('current-pair-title');
  if (pairTitleEl) pairTitleEl.innerText = `${titleA} + ${titleB}`;

  // Check if either is a native desktop app requiring Win32 hardware window snap
  const isLeftNative = appState.panes.left.type === 'local-app' && appState.panes.left.path;
  const isRightNative = appState.panes.right.type === 'local-app' && appState.panes.right.path;

  if (window.api?.localApps?.snapNativeAppHalfWindow) {
    if (isLeftNative && !isRightNative) {
      window.api.localApps.snapNativeAppHalfWindow({
        appPath: appState.panes.left.path,
        side: 'left',
        ratio: ratio
      });
    } else if (isRightNative && !isLeftNative) {
      window.api.localApps.snapNativeAppHalfWindow({
        appPath: appState.panes.right.path,
        side: 'right',
        ratio: 100 - ratio
      });
    }
  }

  switchView('split');
  logSession(titleA, titleB, ratio);
  showToast(`Launched ${titleA} + ${titleB} (${ratio}/${100 - ratio})`);
};

// ==========================================================================
// AI ASSISTANT CONVERSATION & AUTOMATION (Feature 1)
// ==========================================================================
function setupAssistant() {
  const sendBtn = document.getElementById('assistant-send-btn');
  const input = document.getElementById('assistant-input');
  const messagesContainer = document.getElementById('assistant-messages');

  let agentInstance = null;
  try {
    const AgentClass = typeof AIAgent !== 'undefined' ? AIAgent : (window.AIAgent || null);
    if (AgentClass) {
      agentInstance = new AgentClass({
        workspace: {
          launchSplitPair: async (appA, appB, ratio) => {
            await window.launchCustomSplitPair(appA, appB, ratio);
          },
          openApp: (app) => {
            if (app.path || app.isNative) {
              window.launchCustomSplitPair(app, 'notes', 50);
            } else {
              launchSingleApp(app.id || app.name.toLowerCase());
            }
          },
          openUrl: (url, name) => {
            handleUniversalLaunch(url);
          }
        }
      });
    }
  } catch (err) {
    console.warn('AIAgent initialization warning:', err);
  }

  const executeCommand = async (text) => {
    const q = text.trim();
    if (!q) return;

    // Append User message
    const userMsg = document.createElement('div');
    userMsg.className = 'assistant-bubble user';
    userMsg.innerHTML = `<p>${escapeHtml(q)}</p>`;
    messagesContainer.appendChild(userMsg);
    input.value = '';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Execute through AIAgent if available
    if (agentInstance) {
      try {
        const result = await agentInstance.processCommand(q);
        const botMsg = document.createElement('div');
        botMsg.className = 'assistant-bubble bot';
        
        // Format markdown bold
        const formatted = escapeHtml(result.content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        botMsg.innerHTML = `
          <div class="bubble-header"><i data-lucide="bot"></i> <strong>Assistant Jarvis</strong></div>
          <p>${formatted}</p>
        `;
        messagesContainer.appendChild(botMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (window.lucide) window.lucide.createIcons();
        return;
      } catch (err) {
        console.warn('AIAgent processing error:', err);
      }
    }

    // Offline rule-based fallback
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
        <p>${responseText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
      `;
      messagesContainer.appendChild(botMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      if (window.lucide) window.lucide.createIcons();
    }, 250);
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

// ==========================================================================
// USAGE HISTORY & SCREEN TIME ANALYTICS (Feature 3)
// ==========================================================================
let usageTickerInterval = null;

function initUsageAnalytics() {
  if (window.api?.usage?.getAnalytics) {
    window.api.usage.getAnalytics().then(res => {
      if (res && res.success && res.data) {
        if (res.data.cumulativeSeconds) {
          appState.usage.cumulativeSeconds = Object.assign({}, appState.usage.cumulativeSeconds, res.data.cumulativeSeconds);
        }
        if (res.data.pairSeconds) {
          appState.usage.pairSeconds = Object.assign({}, appState.usage.pairSeconds, res.data.pairSeconds);
        }
        if (Array.isArray(res.data.sessions) && res.data.sessions.length > 0) {
          appState.usage.sessions = res.data.sessions;
        }
        updateHubScreenTimeStrip();
      }
    }).catch(e => console.warn('Usage analytics get error:', e));
  }

  try {
    const saved = localStorage.getItem('app_pair_usage_v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.cumulativeSeconds) {
        appState.usage.cumulativeSeconds = Object.assign({}, parsed.cumulativeSeconds, appState.usage.cumulativeSeconds);
      }
      if (parsed.pairSeconds) {
        appState.usage.pairSeconds = Object.assign({}, parsed.pairSeconds, appState.usage.pairSeconds);
      }
      if (Array.isArray(parsed.sessions) && appState.usage.sessions.length === 0) {
        appState.usage.sessions = parsed.sessions;
      }
    }
  } catch (e) {}

  if (!usageTickerInterval) {
    usageTickerInterval = setInterval(recordUsageTick, 1000);
  }

  setInterval(persistUsageAnalytics, 12000);

  const resetBtn = document.getElementById('usage-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all app usage telemetry and screen time data?')) {
        appState.usage.todaySeconds = 0;
        appState.usage.cumulativeSeconds = {};
        appState.usage.pairSeconds = {};
        appState.usage.sessions = [];
        persistUsageAnalytics();
        renderUsageAnalytics();
        updateHubScreenTimeStrip();
        showToast('Telemetry reset');
      }
    });
  }

  updateHubScreenTimeStrip();
}

function recordUsageTick() {
  if (document.hidden) return; // Only count when active

  appState.usage.todaySeconds++;

  if (appState.currentView === 'split') {
    const leftTitle = appState.panes.left.title || appState.panes.left.type || 'Left Pane';
    const rightTitle = appState.panes.right.title || appState.panes.right.type || 'Right Pane';

    appState.usage.cumulativeSeconds[leftTitle] = (appState.usage.cumulativeSeconds[leftTitle] || 0) + 1;
    appState.usage.cumulativeSeconds[rightTitle] = (appState.usage.cumulativeSeconds[rightTitle] || 0) + 1;

    const pairKey = `${leftTitle} + ${rightTitle}`;
    appState.usage.pairSeconds[pairKey] = (appState.usage.pairSeconds[pairKey] || 0) + 1;
  } else if (appState.currentView === 'word-doc') {
    appState.usage.cumulativeSeconds['Word Document Studio'] = (appState.usage.cumulativeSeconds['Word Document Studio'] || 0) + 1;
  } else if (appState.currentView === 'hub') {
    appState.usage.cumulativeSeconds['Workspace Hub'] = (appState.usage.cumulativeSeconds['Workspace Hub'] || 0) + 1;
  }

  if (appState.currentView === 'usage') {
    const totalEl = document.getElementById('metric-total-time');
    if (totalEl) totalEl.innerText = formatHoursMinutes(appState.usage.todaySeconds);
  }
}

function persistUsageAnalytics() {
  try {
    const payload = {
      todaySeconds: appState.usage.todaySeconds,
      cumulativeSeconds: appState.usage.cumulativeSeconds,
      pairSeconds: appState.usage.pairSeconds,
      sessions: appState.usage.sessions.slice(-80)
    };
    localStorage.setItem('app_pair_usage_v2', JSON.stringify(payload));
    if (window.api?.usage?.saveAnalytics) {
      window.api.usage.saveAnalytics(payload);
    }
  } catch (e) {}
}

function logSession(appA, appB, ratio = 50) {
  const newSession = {
    id: 'sess_' + Date.now(),
    appA: typeof appA === 'object' ? appA.name : appA,
    appB: typeof appB === 'object' ? appB.name : appB,
    rawA: appA,
    rawB: appB,
    ratio: ratio,
    timestamp: Date.now(),
    dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
  };

  appState.usage.sessions.unshift(newSession);
  if (appState.usage.sessions.length > 80) appState.usage.sessions.pop();
  persistUsageAnalytics();
}

function formatHoursMinutes(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function updateHubScreenTimeStrip() {
  const totalTimeEl = document.getElementById('hub-total-time-val');
  const topAppEl = document.getElementById('hub-top-app-val');
  const todaySessionsEl = document.getElementById('hub-today-sessions-val');

  if (totalTimeEl) totalTimeEl.innerText = formatHoursMinutes(appState.usage.todaySeconds);

  let topApp = 'None';
  let maxSec = 0;
  for (const [app, sec] of Object.entries(appState.usage.cumulativeSeconds)) {
    if (sec > maxSec) {
      maxSec = sec;
      topApp = app;
    }
  }
  if (topAppEl) topAppEl.innerText = topApp;
  if (todaySessionsEl) todaySessionsEl.innerText = `${appState.usage.sessions.length} sessions`;
}

function renderUsageAnalytics() {
  const totalTimeEl = document.getElementById('metric-total-time');
  const topAppEl = document.getElementById('metric-top-app');
  const topAppTimeEl = document.getElementById('metric-top-app-time');
  const totalSessionsEl = document.getElementById('metric-total-sessions');
  const topPairEl = document.getElementById('metric-top-pair');
  const topPairTimeEl = document.getElementById('metric-top-pair-time');
  const appBarsContainer = document.getElementById('usage-app-bars');
  const sessionTbody = document.getElementById('session-history-tbody');
  const sessionCountBadge = document.getElementById('usage-session-count-badge');

  if (totalTimeEl) totalTimeEl.innerText = formatHoursMinutes(appState.usage.todaySeconds);
  if (totalSessionsEl) totalSessionsEl.innerText = appState.usage.sessions.length.toString();
  if (sessionCountBadge) sessionCountBadge.innerText = `${appState.usage.sessions.length} SESSIONS`;

  // Top App
  const sortedApps = Object.entries(appState.usage.cumulativeSeconds).sort((a, b) => b[1] - a[1]);
  if (sortedApps.length > 0) {
    if (topAppEl) topAppEl.innerText = sortedApps[0][0];
    if (topAppTimeEl) topAppTimeEl.innerText = `${formatHoursMinutes(sortedApps[0][1])} active`;
  } else {
    if (topAppEl) topAppEl.innerText = 'None';
    if (topAppTimeEl) topAppTimeEl.innerText = '0h 00m active';
  }

  // Top Pair
  const sortedPairs = Object.entries(appState.usage.pairSeconds).sort((a, b) => b[1] - a[1]);
  if (sortedPairs.length > 0) {
    if (topPairEl) topPairEl.innerText = sortedPairs[0][0];
    if (topPairTimeEl) topPairTimeEl.innerText = `${formatHoursMinutes(sortedPairs[0][1])} paired`;
  } else {
    if (topPairEl) topPairEl.innerText = 'None';
    if (topPairTimeEl) topPairTimeEl.innerText = '0h 00m paired';
  }

  // Horizontal Ranked Progress Bars
  if (appBarsContainer) {
    appBarsContainer.innerHTML = '';
    if (sortedApps.length === 0) {
      appBarsContainer.innerHTML = '<div style="padding:16px;color:var(--ink-muted);font-size:12px;">No app telemetry recorded yet. Start working in Split View or Hub to record hours.</div>';
    } else {
      const highestSec = sortedApps[0][1] || 1;
      sortedApps.slice(0, 8).forEach(([appName, seconds]) => {
        const pct = Math.min(100, Math.round((seconds / highestSec) * 100));
        const barItem = document.createElement('div');
        barItem.className = 'app-time-bar-item';
        barItem.innerHTML = `
          <div class="app-bar-info">
            <span class="app-bar-name">${escapeHtml(appName)}</span>
            <span class="app-bar-time">${formatHoursMinutes(seconds)}</span>
          </div>
          <div class="app-bar-track">
            <div class="app-bar-fill" style="width: ${pct}%"></div>
          </div>
        `;
        appBarsContainer.appendChild(barItem);
      });
    }
  }

  // Chronological Session History Log Table
  if (sessionTbody) {
    sessionTbody.innerHTML = '';
    if (appState.usage.sessions.length === 0) {
      sessionTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--ink-muted);">No sessions logged yet. Launch pairs from the Hub or AI Assistant.</td></tr>`;
    } else {
      appState.usage.sessions.slice(0, 25).forEach(sess => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(sess.appA)}</strong></td>
          <td><span class="session-paired-pill">${escapeHtml(sess.appB)}</span> (${sess.ratio}/${100 - sess.ratio})</td>
          <td>${sess.dateStr}</td>
          <td><span class="session-active-tag">Recorded</span></td>
          <td style="text-align: right;">
            <button class="tactile-btn small primary re-open-session-btn" data-sess-id="${sess.id}">
              <i data-lucide="play"></i> Re-open Session
            </button>
          </td>
        `;

        tr.querySelector('.re-open-session-btn').addEventListener('click', () => {
          window.launchCustomSplitPair(sess.rawA || sess.appA, sess.rawB || sess.appB, sess.ratio || 50);
        });

        sessionTbody.appendChild(tr);
      });
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// ==========================================================================
// COMMON PALETTE AUTO-PASTE BRIDGE (Feature 4)
// ==========================================================================
function setupPaletteBridge() {
  const pasteSplitBtn = document.getElementById('palette-paste-split-btn');
  const pasteNotepadBtn = document.getElementById('palette-paste-notepad-btn');
  const pasteWordBtn = document.getElementById('palette-paste-word-btn');
  const autoSyncToggle = document.getElementById('palette-auto-sync-toggle');
  const syncTargetSelect = document.getElementById('palette-sync-target-select');
  const snippetInput = document.getElementById('drawer-snippet-input');

  const getActivePaletteText = () => {
    return (snippetInput ? snippetInput.value : '') || (appState.snippets[0] || '');
  };

  if (pasteSplitBtn) {
    pasteSplitBtn.addEventListener('click', () => {
      const text = getActivePaletteText();
      if (!text) {
        showToast('Type text into Palette or select a snippet first');
        return;
      }
      pasteIntoActiveSplitPane(text);
    });
  }

  if (pasteNotepadBtn) {
    pasteNotepadBtn.addEventListener('click', async () => {
      const text = getActivePaletteText();
      if (!text) {
        showToast('Palette input is empty');
        return;
      }
      if (window.api?.external?.pasteToExternalApp) {
        const res = await window.api.external.pasteToExternalApp({ app: 'notepad', text });
        if (res && res.success) {
          showToast('Pasted & Launched in Windows Notepad (.exe)');
        } else {
          showToast(`Notepad: ${res?.error || 'Launched'}`);
        }
      } else {
        navigator.clipboard.writeText(text);
        showToast('Copied to clipboard');
      }
    });
  }

  if (pasteWordBtn) {
    pasteWordBtn.addEventListener('click', async () => {
      const text = getActivePaletteText();
      if (!text) {
        showToast('Palette input is empty');
        return;
      }

      const wordCanvas = document.getElementById('word-editable-canvas');
      if (wordCanvas) {
        const p = document.createElement('p');
        p.innerText = text;
        wordCanvas.appendChild(p);
      }

      if (window.api?.external?.pasteToExternalApp) {
        const res = await window.api.external.pasteToExternalApp({ app: 'word', text });
        if (res && res.success) {
          showToast('Inserted into Word Workspace & System Clipboard');
        } else {
          showToast('Inserted into Word Studio');
        }
      } else {
        showToast('Inserted into in-app Word Studio');
      }
    });
  }

  if (autoSyncToggle) {
    autoSyncToggle.checked = appState.paletteAutoSync;
    autoSyncToggle.addEventListener('change', () => {
      appState.paletteAutoSync = autoSyncToggle.checked;
      persistStorage();
      showToast(`Palette Auto-Sync: ${appState.paletteAutoSync ? 'ENABLED' : 'DISABLED'}`);
    });
  }

  if (syncTargetSelect) {
    syncTargetSelect.value = appState.paletteSyncTarget || 'notes';
    syncTargetSelect.addEventListener('change', () => {
      appState.paletteSyncTarget = syncTargetSelect.value;
      persistStorage();
    });
  }

  let autoSyncDebounce = null;
  if (snippetInput) {
    snippetInput.addEventListener('input', () => {
      if (!appState.paletteAutoSync) return;
      clearTimeout(autoSyncDebounce);
      autoSyncDebounce = setTimeout(() => {
        const text = snippetInput.value;
        if (!text) return;
        const target = appState.paletteSyncTarget;
        if (target === 'notes') {
          pasteIntoNotesPane(text);
        } else if (target === 'word') {
          const wordCanvas = document.getElementById('word-editable-canvas');
          if (wordCanvas) {
            wordCanvas.innerHTML += `<p>${escapeHtml(text)}</p>`;
          }
        } else if (target === 'notepad') {
          if (window.api?.external?.pasteToExternalApp) {
            window.api.external.pasteToExternalApp({ app: 'notepad', text });
          }
        }
      }, 500);
    });
  }
}

function pasteIntoActiveSplitPane(text) {
  if (appState.panes.right.type === 'notes') {
    pasteIntoNotesPane(text, 'right');
  } else if (appState.panes.left.type === 'notes') {
    pasteIntoNotesPane(text, 'left');
  } else if (appState.panes.right.type === 'word' || appState.panes.left.type === 'word') {
    const inlineCanvas = document.querySelector('.word-inline-sheet');
    if (inlineCanvas) {
      inlineCanvas.innerHTML += `<p>${escapeHtml(text)}</p>`;
      showToast('Pasted into Split Word Document Pane');
    }
  } else {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard for Split View');
  }
}

function pasteIntoNotesPane(text, side = 'right') {
  const container = side === 'left' ? leftContentView : rightContentView;
  const textarea = container ? container.querySelector('.notes-textarea') : null;
  if (textarea) {
    textarea.value = (textarea.value ? textarea.value + '\n\n' : '') + text;
    textarea.dispatchEvent(new Event('input'));
    showToast(`Pasted to ${side.toUpperCase()} Notes Pane`);
  } else {
    appState.notes.body = (appState.notes.body ? appState.notes.body + '\n\n' : '') + text;
    persistStorage();
    showToast('Appended to Idea Notes');
  }
}

// ==========================================================================
// IN-APP WORD DOCUMENT STUDIO (Feature 6)
// ==========================================================================
let wordAutosaveTimer = null;

function setupWordStudio() {
  const titleInput = document.getElementById('word-doc-title-input');
  const editableCanvas = document.getElementById('word-editable-canvas');
  const autosaveBadge = document.getElementById('word-autosave-badge');
  const metricsPill = document.getElementById('word-metrics-pill');
  const openLaptopBtn = document.getElementById('word-open-laptop-btn');
  const saveWorkspaceBtn = document.getElementById('word-save-workspace-btn');
  const exportDocxBtn = document.getElementById('word-export-docx-btn');

  // Formatting Ribbon Controls
  const headingSelect = document.getElementById('word-heading-select');
  if (headingSelect) {
    headingSelect.addEventListener('change', () => {
      const val = headingSelect.value;
      if (val === 'p') {
        document.execCommand('formatBlock', false, '<p>');
      } else if (val === 'blockquote') {
        document.execCommand('formatBlock', false, '<blockquote>');
      } else {
        document.execCommand('formatBlock', false, `<${val}>`);
      }
      if (editableCanvas) editableCanvas.focus();
    });
  }

  const fontSelect = document.getElementById('word-font-select');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      document.execCommand('fontName', false, fontSelect.value);
      if (editableCanvas) editableCanvas.focus();
    });
  }

  const bindCmd = (id, cmd, arg = null) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        document.execCommand(cmd, false, arg);
        if (editableCanvas) editableCanvas.focus();
        updateWordMetrics();
      });
    }
  };

  bindCmd('word-cmd-bold', 'bold');
  bindCmd('word-cmd-italic', 'italic');
  bindCmd('word-cmd-underline', 'underline');
  bindCmd('word-cmd-strike', 'strikeThrough');
  bindCmd('word-cmd-ul', 'insertUnorderedList');
  bindCmd('word-cmd-ol', 'insertOrderedList');
  bindCmd('word-cmd-align-left', 'justifyLeft');
  bindCmd('word-cmd-align-center', 'justifyCenter');
  bindCmd('word-cmd-align-right', 'justifyRight');
  bindCmd('word-cmd-clear', 'removeFormat');

  // Insert 3x3 Table
  const tableBtn = document.getElementById('word-cmd-table');
  if (tableBtn) {
    tableBtn.addEventListener('click', () => {
      const tableHtml = `
        <table style="width:100%; border-collapse: collapse; margin: 12px 0;">
          <tbody>
            <tr>
              <th style="border: 1.5px solid #141413; padding: 6px 10px; background: #FAF8F5;">Header 1</th>
              <th style="border: 1.5px solid #141413; padding: 6px 10px; background: #FAF8F5;">Header 2</th>
              <th style="border: 1.5px solid #141413; padding: 6px 10px; background: #FAF8F5;">Header 3</th>
            </tr>
            <tr>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Item 1</td>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Item 2</td>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Item 3</td>
            </tr>
            <tr>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Data A</td>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Data B</td>
              <td style="border: 1.5px solid #141413; padding: 6px 10px;">Data C</td>
            </tr>
          </tbody>
        </table>
      `;
      document.execCommand('insertHTML', false, tableHtml);
      if (editableCanvas) editableCanvas.focus();
      updateWordMetrics();
    });
  }

  // Update metrics & trigger autosave
  const updateWordMetrics = () => {
    if (!editableCanvas) return;
    const text = editableCanvas.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    if (metricsPill) metricsPill.innerText = `${words} words • ${chars} chars`;

    appState.wordDoc.title = titleInput ? titleInput.value : 'Specification Notes.docx';
    appState.wordDoc.html = editableCanvas.innerHTML;
    appState.wordDoc.plainText = text;
    appState.wordDoc.wordCount = words;
    appState.wordDoc.charCount = chars;
    appState.wordDoc.lastEdited = Date.now();

    if (autosaveBadge) autosaveBadge.innerHTML = '<i data-lucide="loader"></i> Saving changes...';
    if (window.lucide) window.lucide.createIcons();

    clearTimeout(wordAutosaveTimer);
    wordAutosaveTimer = setTimeout(triggerWordAutosave, 3000);
  };

  if (editableCanvas) {
    editableCanvas.addEventListener('input', updateWordMetrics);
  }
  if (titleInput) {
    titleInput.addEventListener('input', updateWordMetrics);
  }

  // Open Real .docx from Laptop
  if (openLaptopBtn) {
    openLaptopBtn.addEventListener('click', async () => {
      if (window.api?.word?.pickFile) {
        const res = await window.api.word.pickFile();
        if (res && res.success) {
          if (titleInput) titleInput.value = res.fileName;
          if (editableCanvas) editableCanvas.innerHTML = res.html;
          appState.wordDoc.filePath = res.filePath;
          appState.wordDoc.title = res.fileName;
          updateWordMetrics();
          showToast(`Loaded ${res.fileName} from laptop`);
        } else if (res && !res.canceled) {
          showToast(`Error opening docx: ${res.error || 'Failed'}`);
        }
      }
    });
  }

  // Save to Workspace
  if (saveWorkspaceBtn) {
    saveWorkspaceBtn.addEventListener('click', async () => {
      await triggerWordAutosave();
      showToast('Document saved in Workspace Storage!');
    });
  }

  // Export to .docx
  if (exportDocxBtn) {
    exportDocxBtn.addEventListener('click', async () => {
      if (window.api?.word?.exportDocx) {
        showToast('Exporting to .docx format...');
        const res = await window.api.word.exportDocx({
          title: appState.wordDoc.title || 'Specification Notes.docx',
          html: editableCanvas ? editableCanvas.innerHTML : '',
          plainText: editableCanvas ? editableCanvas.innerText : ''
        });
        if (res && res.success) {
          showToast(`Exported to ${res.filePath}`);
        } else if (res && !res.canceled) {
          showToast(`Export error: ${res.error || 'Failed'}`);
        }
      }
    });
  }

  loadSavedWordDocs();
  updateWordMetrics();
}

async function triggerWordAutosave() {
  const autosaveBadge = document.getElementById('word-autosave-badge');
  const doc = {
    id: appState.wordDoc.id || 'doc_' + Date.now(),
    title: appState.wordDoc.title || 'Specification Notes.docx',
    html: appState.wordDoc.html,
    plainText: appState.wordDoc.plainText,
    wordCount: appState.wordDoc.wordCount,
    charCount: appState.wordDoc.charCount,
    lastEdited: Date.now()
  };

  try {
    localStorage.setItem('app_pair_word_current', JSON.stringify(doc));
    if (window.api?.word?.saveDocWorkspace) {
      await window.api.word.saveDocWorkspace(doc);
    }

    const existingIdx = appState.savedWordDocs.findIndex(d => d.id === doc.id || d.title === doc.title);
    if (existingIdx >= 0) {
      appState.savedWordDocs[existingIdx] = doc;
    } else {
      appState.savedWordDocs.unshift(doc);
    }
    renderWordSavedDocsShelf();

    if (autosaveBadge) {
      autosaveBadge.innerHTML = '<i data-lucide="check-circle"></i> Auto-saved in Workspace';
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (e) {
    console.warn('Word autosave error:', e);
  }
}

async function loadSavedWordDocs() {
  if (window.api?.word?.getSavedDocs) {
    const res = await window.api.word.getSavedDocs();
    if (res && res.success && Array.isArray(res.docs) && res.docs.length > 0) {
      appState.savedWordDocs = res.docs;
    }
  }
  if (appState.savedWordDocs.length === 0) {
    try {
      const saved = localStorage.getItem('app_pair_word_shelf');
      if (saved) appState.savedWordDocs = JSON.parse(saved);
    } catch (e) {}
  }
  renderWordSavedDocsShelf();
}

function renderWordSavedDocsShelf() {
  const shelfContainer = document.getElementById('hub-word-saved-shelf');
  if (!shelfContainer) return;

  shelfContainer.innerHTML = '';
  if (appState.savedWordDocs.length === 0) {
    shelfContainer.innerHTML = '<div style="padding:12px;color:var(--ink-muted);font-size:12px;">No saved documents yet. Start typing in Word Studio to autosave your work.</div>';
    return;
  }

  appState.savedWordDocs.slice(0, 6).forEach(doc => {
    const card = document.createElement('div');
    card.className = 'word-doc-shelf-item';
    const dateStr = doc.lastEdited ? new Date(doc.lastEdited).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently saved';

    card.innerHTML = `
      <div class="shelf-item-top">
        <i data-lucide="file-text"></i>
        <span class="shelf-doc-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</span>
      </div>
      <div class="shelf-item-snippet">${escapeHtml((doc.plainText || 'No text content...').slice(0, 90))}...</div>
      <div class="shelf-item-bottom">
        <span class="shelf-item-meta">${doc.wordCount || 0} words &bull; ${dateStr}</span>
        <button class="tactile-btn small primary resume-doc-btn">Continue Working &rarr;</button>
      </div>
    `;

    card.querySelector('.resume-doc-btn').addEventListener('click', () => {
      appState.wordDoc = { ...doc };
      const titleInput = document.getElementById('word-doc-title-input');
      const editableCanvas = document.getElementById('word-editable-canvas');
      if (titleInput) titleInput.value = doc.title;
      if (editableCanvas) editableCanvas.innerHTML = doc.html || `<p>${escapeHtml(doc.plainText || '')}</p>`;
      switchView('word-doc');
      showToast(`Resumed "${doc.title}"`);
    });

    shelfContainer.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderWordEditorComponent(side, container) {
  const editorEl = document.createElement('div');
  editorEl.className = 'word-editor-inline-container';
  editorEl.innerHTML = `
    <div class="word-inline-toolbar">
      <span class="word-inline-badge"><i data-lucide="file-edit"></i> Word Studio (.docx)</span>
      <div class="word-inline-actions">
        <button class="notes-tool-btn" data-cmd="bold"><strong>B</strong></button>
        <button class="notes-tool-btn" data-cmd="italic"><em>I</em></button>
        <button class="notes-tool-btn" data-cmd="underline"><u>U</u></button>
        <button class="notes-tool-btn" data-cmd="insertUnorderedList">• List</button>
        <button class="tactile-btn small secondary" id="${side}-word-full-btn" title="Open in Full Word Studio"><i data-lucide="maximize-2"></i> Full</button>
      </div>
    </div>
    <div class="word-inline-sheet" contenteditable="true" spellcheck="true">
      ${appState.wordDoc.html || '<h2>Specification Notes</h2><p>Start writing document here...</p>'}
    </div>
    <div class="word-inline-footer">
      <span id="${side}-word-inline-metrics">Autosaved to Workspace</span>
      <button class="tactile-btn small primary" id="${side}-word-export-inline-btn"><i data-lucide="download"></i> Export</button>
    </div>
  `;

  container.appendChild(editorEl);
  if (window.lucide) window.lucide.createIcons();

  const sheet = editorEl.querySelector('.word-inline-sheet');
  sheet.addEventListener('input', () => {
    appState.wordDoc.html = sheet.innerHTML;
    appState.wordDoc.plainText = sheet.innerText;
    clearTimeout(wordAutosaveTimer);
    wordAutosaveTimer = setTimeout(triggerWordAutosave, 3000);
  });

  editorEl.querySelectorAll('.notes-tool-btn[data-cmd]').forEach(b => {
    b.addEventListener('click', () => {
      document.execCommand(b.getAttribute('data-cmd'));
      sheet.focus();
    });
  });

  editorEl.querySelector(`#${side}-word-full-btn`).addEventListener('click', () => {
    switchView('word-doc');
  });

  editorEl.querySelector(`#${side}-word-export-inline-btn`).addEventListener('click', async () => {
    if (window.api?.word?.exportDocx) {
      showToast('Exporting to .docx format...');
      const res = await window.api.word.exportDocx({
        title: appState.wordDoc.title || 'Specification Notes.docx',
        html: sheet.innerHTML,
        plainText: sheet.innerText
      });
      if (res && res.success) showToast(`Exported to ${res.filePath}`);
    }
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
