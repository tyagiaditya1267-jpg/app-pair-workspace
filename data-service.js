/**
 * data-service.js — Unified Data Access Service
 * 
 * Provides two core capabilities:
 * 1. Web Scraping: Fetch any URL and extract title, description, text, links, images, OG metadata
 * 2. Local File Reader: Read text files, list directories, get file info
 * 
 * Uses Electron's built-in net module for HTTP requests (no external deps for fetching)
 * Uses cheerio for HTML parsing (lightweight jQuery-like HTML parser)
 */

const fs = require('fs');
const path = require('path');
const { net } = require('electron');

let cheerio;
try {
  cheerio = require('cheerio');
} catch (e) {
  console.warn('[DataService] cheerio not installed. Web scraping will return raw HTML.');
}

class DataService {
  constructor(store) {
    this.store = store;
  }

  // ========================================
  // WEB SCRAPING
  // ========================================

  /**
   * Fetch and extract data from a URL
   * Returns structured data: title, description, text, links, images, og metadata
   */
  async scrapeUrl(url) {
    try {
      // Normalize URL
      let targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      // Fetch HTML using Electron's net module
      const html = await this._fetchHtml(targetUrl);

      if (!html) {
        return { success: false, error: 'Could not fetch the page. It may be offline or blocking requests.' };
      }

      // Parse with cheerio if available, otherwise return raw
      if (cheerio) {
        const result = this._parseHtml(html, targetUrl);
        
        // Save to history
        this._saveToHistory(targetUrl, result);
        
        return { success: true, data: result };
      } else {
        // Fallback: return raw HTML snippet
        const snippet = html.substring(0, 5000);
        const result = {
          url: targetUrl,
          title: this._extractBetween(html, '<title>', '</title>') || targetUrl,
          description: '',
          textContent: snippet,
          links: [],
          images: [],
          ogData: {},
          fetchedAt: new Date().toISOString()
        };
        this._saveToHistory(targetUrl, result);
        return { success: true, data: result };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch HTML content from a URL using Electron's net module
   */
  _fetchHtml(url) {
    return new Promise((resolve, reject) => {
      try {
        const request = net.request({
          url: url,
          method: 'GET'
        });

        // Set a user-agent to avoid being blocked
        request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        request.setHeader('Accept-Language', 'en-US,en;q=0.5');

        let body = '';
        let timedOut = false;

        // Set timeout
        const timeout = setTimeout(() => {
          timedOut = true;
          request.abort();
          reject(new Error('Request timed out after 15 seconds'));
        }, 15000);

        request.on('response', (response) => {
          response.on('data', (chunk) => {
            body += chunk.toString();
            // Limit body size to 2MB
            if (body.length > 2 * 1024 * 1024) {
              clearTimeout(timeout);
              request.abort();
              resolve(body);
            }
          });

          response.on('end', () => {
            if (!timedOut) {
              clearTimeout(timeout);
              resolve(body);
            }
          });

          response.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        request.on('error', (err) => {
          if (!timedOut) {
            clearTimeout(timeout);
            reject(err);
          }
        });

        request.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Parse HTML using cheerio and extract structured data
   */
  _parseHtml(html, sourceUrl) {
    const $ = cheerio.load(html);

    // Extract title
    const title = $('title').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') ||
                  $('h1').first().text().trim() ||
                  sourceUrl;

    // Extract description
    const description = $('meta[name="description"]').attr('content') ||
                        $('meta[property="og:description"]').attr('content') ||
                        $('p').first().text().trim().substring(0, 300) ||
                        '';

    // Extract main text content (clean up scripts, styles, nav, etc.)
    $('script, style, nav, header, footer, iframe, noscript').remove();
    const textContent = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000); // Limit to 10k chars

    // Extract links (up to 50)
    const links = [];
    $('a[href]').each((i, el) => {
      if (links.length >= 50) return false;
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        let absoluteUrl = href;
        try {
          absoluteUrl = new URL(href, sourceUrl).href;
        } catch (e) {}
        links.push({ url: absoluteUrl, text: text || absoluteUrl });
      }
    });

    // Extract images (up to 20)
    const images = [];
    $('img[src]').each((i, el) => {
      if (images.length >= 20) return false;
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || '';
      if (src) {
        let absoluteSrc = src;
        try {
          absoluteSrc = new URL(src, sourceUrl).href;
        } catch (e) {}
        images.push({ src: absoluteSrc, alt });
      }
    });

    // Extract Open Graph metadata
    const ogData = {};
    $('meta[property^="og:"]').each((i, el) => {
      const property = $(el).attr('property').replace('og:', '');
      ogData[property] = $(el).attr('content') || '';
    });

    // Extract headings structure
    const headings = [];
    $('h1, h2, h3').each((i, el) => {
      if (headings.length >= 20) return false;
      headings.push({
        level: el.tagName,
        text: $(el).text().trim()
      });
    });

    return {
      url: sourceUrl,
      title,
      description,
      textContent,
      links,
      images,
      headings,
      ogData,
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Simple string extraction helper (fallback when cheerio not available)
   */
  _extractBetween(str, start, end) {
    const startIdx = str.indexOf(start);
    if (startIdx === -1) return '';
    const contentStart = startIdx + start.length;
    const endIdx = str.indexOf(end, contentStart);
    if (endIdx === -1) return '';
    return str.substring(contentStart, endIdx).trim();
  }

  /**
   * Save scrape result to history
   */
  _saveToHistory(url, data) {
    try {
      const history = this.store.get('scrapedDataHistory') || [];
      history.unshift({
        id: Date.now().toString(),
        url,
        title: data.title,
        description: data.description,
        textPreview: (data.textContent || '').substring(0, 200),
        linksCount: (data.links || []).length,
        imagesCount: (data.images || []).length,
        fetchedAt: data.fetchedAt
      });

      // Keep only last 50 entries
      if (history.length > 50) {
        history.splice(50);
      }

      this.store.set('scrapedDataHistory', history);
    } catch (e) {
      console.error('[DataService] Failed to save to history:', e);
    }
  }

  /**
   * Get scrape history
   */
  getHistory() {
    return this.store.get('scrapedDataHistory') || [];
  }

  /**
   * Clear scrape history
   */
  clearHistory() {
    this.store.set('scrapedDataHistory', []);
  }

  // ========================================
  // LOCAL FILE READER
  // ========================================

  /**
   * Read a text file from the local filesystem
   * Supports: .txt, .csv, .json, .md, .log, .xml, .html, .css, .js, .py, etc.
   */
  readFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found: ' + filePath };
      }

      const stats = fs.statSync(filePath);
      
      // Limit to 5MB files
      if (stats.size > 5 * 1024 * 1024) {
        return { success: false, error: 'File too large (max 5MB). File size: ' + (stats.size / (1024 * 1024)).toFixed(2) + 'MB' };
      }

      const ext = path.extname(filePath).toLowerCase();
      const textExtensions = ['.txt', '.csv', '.json', '.md', '.log', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.go', '.rs', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bat', '.ps1', '.sql'];

      if (!textExtensions.includes(ext)) {
        return {
          success: true,
          data: {
            path: filePath,
            name: path.basename(filePath),
            extension: ext,
            size: stats.size,
            sizeFormatted: this._formatFileSize(stats.size),
            modified: stats.mtime.toISOString(),
            type: 'binary',
            content: `[Binary file — ${this._formatFileSize(stats.size)}. Cannot display content.]`
          }
        };
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      return {
        success: true,
        data: {
          path: filePath,
          name: path.basename(filePath),
          extension: ext,
          size: stats.size,
          sizeFormatted: this._formatFileSize(stats.size),
          modified: stats.mtime.toISOString(),
          type: 'text',
          content: content,
          lineCount: content.split('\n').length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List contents of a directory
   */
  listDirectory(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        return { success: false, error: 'Directory not found: ' + dirPath };
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory: ' + dirPath };
      }

      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const entries = items.map(item => {
        const fullPath = path.join(dirPath, item.name);
        try {
          const itemStats = fs.statSync(fullPath);
          return {
            name: item.name,
            path: fullPath,
            isDirectory: item.isDirectory(),
            size: item.isFile() ? itemStats.size : null,
            sizeFormatted: item.isFile() ? this._formatFileSize(itemStats.size) : null,
            modified: itemStats.mtime.toISOString(),
            extension: item.isFile() ? path.extname(item.name).toLowerCase() : null
          };
        } catch (e) {
          return {
            name: item.name,
            path: fullPath,
            isDirectory: item.isDirectory(),
            error: 'Access denied'
          };
        }
      });

      // Sort: directories first, then files, alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        data: {
          path: dirPath,
          name: path.basename(dirPath),
          entries,
          totalItems: entries.length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get file metadata without reading content
   */
  getFileInfo(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found.' };
      }

      const stats = fs.statSync(filePath);
      return {
        success: true,
        data: {
          path: filePath,
          name: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
          size: stats.size,
          sizeFormatted: this._formatFileSize(stats.size),
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          accessed: stats.atime.toISOString()
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Format file size to human-readable string
   */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }
}

module.exports = DataService;
