/**
 * app-registry.js — Unified App & Website Registry
 * 
 * Manages both local desktop applications (.exe) and website bookmarks
 * from a single searchable, categorized registry.
 * Includes auto-discovery of installed Windows programs.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class AppRegistry {
  constructor(store) {
    this.store = store;
  }

  // ========================================
  // DESKTOP APPS
  // ========================================

  /**
   * Get all registered desktop apps
   */
  getApps() {
    return this.store.get('registeredApps') || [];
  }

  /**
   * Add a desktop application to the registry
   */
  addApp({ name, path: appPath, category = 'Other', icon = null }) {
    const apps = this.getApps();
    
    // Check for duplicates
    if (apps.some(a => a.path === appPath)) {
      return { success: false, error: 'App is already registered.' };
    }

    const newApp = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      name: name || path.basename(appPath, '.exe'),
      path: appPath,
      category,
      icon,
      type: 'desktop',
      addedAt: new Date().toISOString()
    };

    apps.push(newApp);
    this.store.set('registeredApps', apps);
    return { success: true, app: newApp };
  }

  /**
   * Remove a desktop app by ID
   */
  removeApp(id) {
    let apps = this.getApps();
    const before = apps.length;
    apps = apps.filter(a => a.id !== id);
    this.store.set('registeredApps', apps);
    return { success: apps.length < before };
  }

  /**
   * Update an app's details
   */
  updateApp(id, updates) {
    const apps = this.getApps();
    const idx = apps.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, error: 'App not found.' };
    
    apps[idx] = { ...apps[idx], ...updates, id: apps[idx].id }; // preserve ID
    this.store.set('registeredApps', apps);
    return { success: true, app: apps[idx] };
  }

  // ========================================
  // WEBSITE BOOKMARKS
  // ========================================

  /**
   * Get all registered website bookmarks
   */
  getSites() {
    return this.store.get('registeredSites') || [];
  }

  /**
   * Add a website bookmark
   */
  addSite({ name, url, category = 'Other', icon = null, description = '' }) {
    const sites = this.getSites();
    
    // Normalize URL
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Check for duplicates
    if (sites.some(s => s.url === normalizedUrl)) {
      return { success: false, error: 'Website is already registered.' };
    }

    const newSite = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      name: name || new URL(normalizedUrl).hostname,
      url: normalizedUrl,
      category,
      icon,
      description,
      type: 'website',
      addedAt: new Date().toISOString()
    };

    sites.push(newSite);
    this.store.set('registeredSites', sites);
    return { success: true, site: newSite };
  }

  /**
   * Remove a website bookmark by ID
   */
  removeSite(id) {
    let sites = this.getSites();
    const before = sites.length;
    sites = sites.filter(s => s.id !== id);
    this.store.set('registeredSites', sites);
    return { success: sites.length < before };
  }

  /**
   * Update a site's details
   */
  updateSite(id, updates) {
    const sites = this.getSites();
    const idx = sites.findIndex(s => s.id === id);
    if (idx === -1) return { success: false, error: 'Site not found.' };
    
    sites[idx] = { ...sites[idx], ...updates, id: sites[idx].id };
    this.store.set('registeredSites', sites);
    return { success: true, site: sites[idx] };
  }

  // ========================================
  // CATEGORIES
  // ========================================

  /**
   * Get all available categories
   */
  getCategories() {
    return this.store.get('appCategories') || ['Productivity', 'Media', 'Development', 'Social', 'Utilities', 'Other'];
  }

  /**
   * Add a custom category
   */
  addCategory(category) {
    const categories = this.getCategories();
    if (!categories.includes(category)) {
      categories.push(category);
      this.store.set('appCategories', categories);
    }
    return categories;
  }

  // ========================================
  // SEARCH & FILTER
  // ========================================

  /**
   * Search across all apps and sites
   */
  search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return { apps: this.getApps(), sites: this.getSites() };

    const apps = this.getApps().filter(a => 
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.path.toLowerCase().includes(q)
    );

    const sites = this.getSites().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    );

    return { apps, sites };
  }

  /**
   * Filter by category
   */
  filterByCategory(category) {
    if (!category || category === 'All') {
      return { apps: this.getApps(), sites: this.getSites() };
    }

    return {
      apps: this.getApps().filter(a => a.category === category),
      sites: this.getSites().filter(s => s.category === category)
    };
  }

  // ========================================
  // AUTO-DISCOVERY (Windows)
  // ========================================

  /**
   * Discover installed programs from common Windows locations
   * Returns a list of found executables (user chooses which to add)
   */
  async discoverInstalledApps() {
    const discovered = [];
    const searchPaths = [];

    // Common Windows program locations
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const userDesktop = path.join(process.env['USERPROFILE'] || '', 'Desktop');
    const startMenu = path.join(process.env['APPDATA'] || '', 'Microsoft\\Windows\\Start Menu\\Programs');
    const publicStartMenu = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';

    // Search Start Menu shortcuts (.lnk files)
    for (const menuPath of [startMenu, publicStartMenu]) {
      try {
        if (fs.existsSync(menuPath)) {
          const shortcuts = this._findFilesRecursive(menuPath, ['.lnk'], 2);
          shortcuts.forEach(s => {
            discovered.push({
              name: path.basename(s, '.lnk'),
              path: s,
              source: 'Start Menu',
              category: this._guessCategory(path.basename(s, '.lnk'))
            });
          });
        }
      } catch (e) {
        // Silently skip inaccessible paths
      }
    }

    // Search Desktop shortcuts
    try {
      if (fs.existsSync(userDesktop)) {
        const desktopFiles = this._findFilesRecursive(userDesktop, ['.lnk', '.exe'], 0);
        desktopFiles.forEach(s => {
          const ext = path.extname(s);
          discovered.push({
            name: path.basename(s, ext),
            path: s,
            source: 'Desktop',
            category: this._guessCategory(path.basename(s, ext))
          });
        });
      }
    } catch (e) {
      // Silently skip
    }

    // Deduplicate by name
    const seen = new Set();
    const unique = [];
    for (const app of discovered) {
      const key = app.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(app);
      }
    }

    // Sort alphabetically
    unique.sort((a, b) => a.name.localeCompare(b.name));

    return unique;
  }

  /**
   * Recursively find files matching extensions up to a max depth
   */
  _findFilesRecursive(dir, extensions, maxDepth, currentDepth = 0) {
    const results = [];
    
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        } else if (item.isDirectory() && currentDepth < maxDepth) {
          try {
            results.push(...this._findFilesRecursive(fullPath, extensions, maxDepth, currentDepth + 1));
          } catch (e) {
            // Skip inaccessible directories
          }
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
    
    return results;
  }

  /**
   * Guess category based on app name heuristics
   */
  _guessCategory(name) {
    const n = name.toLowerCase();
    
    if (/code|visual studio|intellij|eclipse|git|node|python|docker|postman|terminal|powershell|sublime|atom|vim|webpack|npm/.test(n)) return 'Development';
    if (/chrome|firefox|edge|opera|brave|browser|explorer/.test(n)) return 'Utilities';
    if (/spotify|vlc|media|music|video|player|youtube|audacity|obs|stream/.test(n)) return 'Media';
    if (/word|excel|powerpoint|onenote|outlook|teams|slack|zoom|notion|obsidian|evernote|todo|calendar/.test(n)) return 'Productivity';
    if (/discord|telegram|whatsapp|messenger|twitter|instagram|facebook|reddit|signal/.test(n)) return 'Social';
    if (/steam|epic|game|play|minecraft|roblox|unity|unreal/.test(n)) return 'Other';
    if (/notepad|calc|paint|snip|task|file|disk|cmd|control|settings|defender/.test(n)) return 'Utilities';
    
    return 'Other';
  }
}

module.exports = AppRegistry;
