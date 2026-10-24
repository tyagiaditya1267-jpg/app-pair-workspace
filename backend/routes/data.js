/**
 * routes/data.js — Web Scraping and Local File Access APIs
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function registerDataRoutes(router, db, broadcast, dataService) {
  // ---- Web Scraping ----
  router.post('/api/scrape', async (req, res) => {
    const { url: targetUrl } = req.body;
    if (!targetUrl) return res.error('URL is required', 400);

    try {
      if (dataService && typeof dataService.scrapeUrl === 'function') {
        const result = await dataService.scrapeUrl(targetUrl);
        if (result.success) {
          db.insert('scrapeHistory', {
            url: targetUrl,
            title: result.data.title,
            description: result.data.description,
            textPreview: (result.data.textContent || '').substring(0, 200),
            linksCount: (result.data.links || []).length,
            imagesCount: (result.data.images || []).length
          });
          return res.success(result.data, 'Scrape successful');
        } else {
          return res.error(result.error || 'Scraping failed', 502);
        }
      }

      // Standalone fallback scraper using Node built-in https
      const scraped = await fetchSimpleMetadata(targetUrl);
      db.insert('scrapeHistory', scraped);
      res.success(scraped, 'Page metadata fetched');
    } catch (e) {
      res.error(e.message, 500);
    }
  });

  // ---- Scrape History ----
  router.get('/api/scrape/history', (req, res) => {
    res.success(db.getCollection('scrapeHistory'));
  });

  router.delete('/api/scrape/history', (req, res) => {
    db.setCollectionData('scrapeHistory', []);
    res.success([], 'History cleared');
  });

  // ---- Local File Reader ----
  router.get('/api/files/read', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.error('Query parameter "path" is required', 400);

    try {
      if (!fs.existsSync(filePath)) return res.error('File not found', 404);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return res.error('Path is a directory, not a file', 400);
      if (stat.size > 5 * 1024 * 1024) return res.error('File exceeds 5MB size limit', 413);

      const content = fs.readFileSync(filePath, 'utf-8');
      res.success({
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        content
      });
    } catch (e) {
      res.error(e.message, 500);
    }
  });

  // ---- Local Directory Listing ----
  router.get('/api/files/list', (req, res) => {
    const dirPath = req.query.path || process.cwd();
    try {
      if (!fs.existsSync(dirPath)) return res.error('Directory not found', 404);
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return res.error('Path is not a directory', 400);

      const items = fs.readdirSync(dirPath, { withFileTypes: true }).map(entry => {
        const full = path.join(dirPath, entry.name);
        let size = null;
        try {
          if (entry.isFile()) size = fs.statSync(full).size;
        } catch (e) {}
        return {
          name: entry.name,
          path: full,
          isDirectory: entry.isDirectory(),
          size
        };
      });

      res.success({ path: dirPath, items });
    } catch (e) {
      res.error(e.message, 500);
    }
  });
}

function fetchSimpleMetadata(urlStr) {
  return new Promise((resolve, reject) => {
    let target = urlStr.trim();
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

    const parsed = new URL(target);
    const client = parsed.protocol === 'http:' ? http : https;

    client.get(target, { headers: { 'User-Agent': 'AppPairWorkspace/2.0' }, timeout: 10000 }, resp => {
      let data = '';
      resp.on('data', chunk => {
        data += chunk;
        if (data.length > 500000) resp.destroy(); // 500KB cap
      });
      resp.on('end', () => {
        const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = data.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
        resolve({
          url: target,
          title: titleMatch ? titleMatch[1].trim() : target,
          description: descMatch ? descMatch[1].trim() : '',
          fetchedAt: new Date().toISOString()
        });
      });
      resp.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = registerDataRoutes;
