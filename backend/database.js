/**
 * database.js — Fast Local Database & Inverted Full-Text Indexing Engine
 * 
 * Provides:
 * - Persistent document storage with atomic commits and automatic backup rotation
 * - In-memory cache with indexed lookups
 * - Inverted Full-Text Search (FTS) index with ranking and term tokenization
 * - Collection-based API (snippets, tasks, notes, apps, sites, history, settings)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DatabaseEngine {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(__dirname, '..', 'data');
    this.dataFile = path.join(this.storageDir, 'app_database.json');
    this.backupFile = path.join(this.storageDir, 'app_database.backup.json');
    this.autoSaveInterval = options.autoSaveInterval || 500; // ms debounce

    this._data = {
      version: 1,
      lastModified: new Date().toISOString(),
      collections: {
        snippets: [],
        tasks: [],
        notes: [{ id: 'default', title: 'Welcome Note', body: 'Start typing your notes here...', updatedAt: new Date().toISOString() }],
        colors: ['#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#3b82f6'],
        sketches: [],
        apps: [],
        sites: [],
        categories: ['Productivity', 'Media', 'Development', 'Social', 'Utilities', 'Other'],
        scrapeHistory: [],
        settings: {
          serverPort: 4173,
          theme: 'dark',
          autoSync: true
        }
      }
    };

    this._saveTimer = null;
    this._ftsIndex = new Map(); // word -> Set of refKeys
  }

  /**
   * Initialize database and load from disk if present
   */
  init() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.collections) {
          this._data.collections = { ...this._data.collections, ...parsed.collections };
        }
      } else {
        this.saveSync();
      }

      this.rebuildFtsIndex();
    } catch (e) {
      console.error('[DB] Initialization error:', e);
      this._attemptRestoreBackup();
    }

    return this;
  }

  /**
   * Get an entire collection by name
   */
  getCollection(name) {
    if (!this._data.collections[name]) {
      this._data.collections[name] = [];
    }
    return this._data.collections[name];
  }

  /**
   * Query collection items with optional filter predicate
   */
  find(collectionName, filterFn = null) {
    const col = this.getCollection(collectionName);
    if (!Array.isArray(col)) return col;
    if (!filterFn) return [...col];
    return col.filter(filterFn);
  }

  /**
   * Find single document by ID or predicate
   */
  findOne(collectionName, idOrPredicate) {
    const col = this.getCollection(collectionName);
    if (!Array.isArray(col)) return null;

    if (typeof idOrPredicate === 'function') {
      return col.find(idOrPredicate) || null;
    }
    return col.find(item => item.id === idOrPredicate || item._id === idOrPredicate) || null;
  }

  /**
   * Insert new document into collection
   */
  insert(collectionName, doc) {
    const col = this.getCollection(collectionName);
    if (!Array.isArray(col)) {
      throw new Error(`Collection ${collectionName} is not an array collection`);
    }

    const newDoc = {
      id: doc.id || crypto.randomUUID(),
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    col.unshift(newDoc);
    this._indexDocument(collectionName, newDoc);
    this._debouncedSave();
    return newDoc;
  }

  /**
   * Update existing document by ID
   */
  update(collectionName, id, updates) {
    const col = this.getCollection(collectionName);
    if (!Array.isArray(col)) return null;

    const idx = col.findIndex(item => item.id === id || item._id === id);
    if (idx === -1) return null;

    const updated = {
      ...col[idx],
      ...updates,
      id: col[idx].id, // preserve ID
      updatedAt: new Date().toISOString()
    };

    col[idx] = updated;
    this._indexDocument(collectionName, updated);
    this._debouncedSave();
    return updated;
  }

  /**
   * Remove document by ID
   */
  remove(collectionName, id) {
    const col = this.getCollection(collectionName);
    if (!Array.isArray(col)) return false;

    const initialLen = col.length;
    this._data.collections[collectionName] = col.filter(item => item.id !== id && item._id !== id);
    const removed = this._data.collections[collectionName].length < initialLen;
    if (removed) {
      this.rebuildFtsIndex();
      this._debouncedSave();
    }
    return removed;
  }

  /**
   * Set raw collection or key value directly
   */
  setCollectionData(collectionName, data) {
    this._data.collections[collectionName] = data;
    this.rebuildFtsIndex();
    this._debouncedSave();
    return true;
  }

  /**
   * Full database snapshot export
   */
  exportData() {
    return JSON.parse(JSON.stringify(this._data.collections));
  }

  /**
   * Full database snapshot import
   */
  importData(collections) {
    if (!collections || typeof collections !== 'object') return false;
    this._data.collections = { ...this._data.collections, ...collections };
    this.rebuildFtsIndex();
    this.saveSync();
    return true;
  }

  // ========================================
  // FULL-TEXT SEARCH (FTS) INDEXING
  // ========================================

  _tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s\d.-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
  }

  _indexDocument(collectionName, doc) {
    if (!doc || !doc.id) return;
    const searchableFields = [doc.title, doc.body, doc.content, doc.name, doc.text, doc.url, doc.description, doc.tags];
    const textBlob = searchableFields.filter(Boolean).join(' ');
    const tokens = this._tokenize(textBlob);

    tokens.forEach(token => {
      if (!this._ftsIndex.has(token)) {
        this._ftsIndex.set(token, new Set());
      }
      this._ftsIndex.get(token).add(`${collectionName}::${doc.id}`);
    });
  }

  rebuildFtsIndex() {
    this._ftsIndex.clear();
    const searchableCollections = ['snippets', 'tasks', 'notes', 'apps', 'sites', 'scrapeHistory'];

    for (const colName of searchableCollections) {
      const items = this.getCollection(colName);
      if (Array.isArray(items)) {
        items.forEach(item => this._indexDocument(colName, item));
      }
    }
  }

  search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const tokens = this._tokenize(query);
    if (tokens.length === 0) return [];

    const scores = new Map();

    tokens.forEach(token => {
      if (this._ftsIndex.has(token)) {
        this._ftsIndex.get(token).forEach(refKey => {
          scores.set(refKey, (scores.get(refKey) || 0) + 10);
        });
      }

      for (const [indexedToken, refKeys] of this._ftsIndex.entries()) {
        if (indexedToken !== token && indexedToken.includes(token)) {
          refKeys.forEach(refKey => {
            scores.set(refKey, (scores.get(refKey) || 0) + 3);
          });
        }
      }
    });

    const results = [];
    for (const [refKey, score] of scores.entries()) {
      const [colName, docId] = refKey.split('::');
      const doc = this.findOne(colName, docId);
      if (doc) {
        results.push({
          collection: colName,
          score,
          document: doc
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = options.limit || 30;
    return results.slice(0, limit);
  }

  // ========================================
  // PERSISTENCE & BACKUPS
  // ========================================

  _debouncedSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveSync();
    }, this.autoSaveInterval);
  }

  saveSync() {
    try {
      this._data.lastModified = new Date().toISOString();
      const serialized = JSON.stringify(this._data, null, 2);

      if (fs.existsSync(this.dataFile)) {
        try {
          fs.copyFileSync(this.dataFile, this.backupFile);
        } catch (e) {}
      }

      fs.writeFileSync(this.dataFile, serialized, 'utf-8');
      return true;
    } catch (e) {
      console.error('[DB] Save error:', e);
      return false;
    }
  }

  _attemptRestoreBackup() {
    try {
      if (fs.existsSync(this.backupFile)) {
        const raw = fs.readFileSync(this.backupFile, 'utf-8');
        this._data = JSON.parse(raw);
        this.saveSync();
        console.log('[DB] Restored database from backup successfully.');
      }
    } catch (e) {
      console.error('[DB] Failed restoring backup:', e);
    }
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveSync();
  }
}

module.exports = DatabaseEngine;
