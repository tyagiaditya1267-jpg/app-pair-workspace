/**
 * store.js — Persistent JSON File Storage for App-Pair Workspace
 * 
 * Replaces localStorage with a robust file-based store.
 * Data is saved to %APPDATA%/app-pair-workspace/data.json
 * Includes auto-save debouncing, backup rotation, and migration from localStorage.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    // Store data in the user's app data directory
    this.storageDir = path.join(app.getPath('userData'), 'app-pair-data');
    this.filePath = path.join(this.storageDir, 'data.json');
    this.backupPath = path.join(this.storageDir, 'data.backup.json');
    
    this._data = null;
    this._saveTimer = null;
    this._saveDelay = 500; // ms debounce for writes

    // Default state matching the renderer's initial state
    this._defaults = {
      snippets: [],
      sketches: [],
      colors: ['#8b5cf6', '#06b6d4', '#ec4899', '#10b981'],
      tasks: [],
      note: { title: '', body: '' },
      leftPaneMode: 'built-in',
      rightPaneMode: 'built-in',
      leftUrl: 'https://chat.openai.com',
      rightUrl: 'https://www.youtube.com',
      customOfflineApps: [],
      registeredApps: [],
      registeredSites: [],
      appCategories: ['Productivity', 'Media', 'Development', 'Social', 'Utilities', 'Other'],
      scrapedDataHistory: []
    };
  }

  /**
   * Initialize the store — create directory, load data, handle migration
   */
  init() {
    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Try to load existing data
    this._data = this._loadFromDisk();

    if (!this._data) {
      // No existing data — start with defaults
      this._data = { ...this._defaults };
      this._saveToDisk();
    } else {
      // Ensure all default keys exist (forward compatibility)
      let needsSave = false;
      for (const [key, defaultVal] of Object.entries(this._defaults)) {
        if (!(key in this._data)) {
          this._data[key] = defaultVal;
          needsSave = true;
        }
      }
      if (needsSave) {
        this._saveToDisk();
      }
    }

    return this;
  }

  /**
   * Get the entire state object
   */
  getAll() {
    return { ...this._data };
  }

  /**
   * Get a specific key from the store
   */
  get(key) {
    if (key in this._data) {
      // Return a deep copy to prevent accidental mutations
      return JSON.parse(JSON.stringify(this._data[key]));
    }
    return undefined;
  }

  /**
   * Set a specific key in the store (debounced save)
   */
  set(key, value) {
    this._data[key] = value;
    this._debouncedSave();
  }

  /**
   * Replace the entire state object (debounced save)
   */
  setAll(data) {
    // Merge with defaults to ensure nothing is missing
    this._data = { ...this._defaults, ...data };
    this._debouncedSave();
  }

  /**
   * Migrate data from localStorage payload (sent from renderer on first run)
   */
  migrateFromLocalStorage(localStorageData) {
    if (!localStorageData) return false;

    try {
      const parsed = typeof localStorageData === 'string'
        ? JSON.parse(localStorageData)
        : localStorageData;

      // Merge with existing data, preserving defaults for missing keys
      this._data = { ...this._defaults, ...parsed };
      this._saveToDisk();
      return true;
    } catch (e) {
      console.error('[Store] Migration from localStorage failed:', e);
      return false;
    }
  }

  /**
   * Delete a key from the store
   */
  delete(key) {
    if (key in this._data) {
      delete this._data[key];
      this._debouncedSave();
    }
  }

  /**
   * Reset to defaults
   */
  reset() {
    this._createBackup();
    this._data = { ...this._defaults };
    this._saveToDisk();
  }

  /**
   * Get the file path where data is stored (for display to user)
   */
  getStoragePath() {
    return this.filePath;
  }

  // ---- Internal Methods ----

  _loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[Store] Error reading data file, trying backup:', e);
      // Try backup
      try {
        if (fs.existsSync(this.backupPath)) {
          const raw = fs.readFileSync(this.backupPath, 'utf-8');
          const data = JSON.parse(raw);
          // Restore from backup
          fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
          console.log('[Store] Restored from backup successfully.');
          return data;
        }
      } catch (e2) {
        console.error('[Store] Backup restore also failed:', e2);
      }
    }
    return null;
  }

  _saveToDisk() {
    try {
      // Create backup of current file first
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
      // Write new data
      fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Store] Error writing data file:', e);
    }
  }

  _createBackup() {
    try {
      if (fs.existsSync(this.filePath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `data.backup.${timestamp}.json`;
        const backupFile = path.join(this.storageDir, backupName);
        fs.copyFileSync(this.filePath, backupFile);
      }
    } catch (e) {
      console.error('[Store] Backup creation failed:', e);
    }
  }

  _debouncedSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveToDisk();
    }, this._saveDelay);
  }

  /**
   * Force an immediate save (e.g., before app quit)
   */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveToDisk();
  }
}

module.exports = Store;
